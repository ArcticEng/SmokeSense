-- ════════════════════════════════════════════════════════════════
--  SmokeSense — ONE-SHOT telemetry fix
--  Arctic Engineering
--
--  WHY: the firmware/bridge write many columns (gas, classifier, env,
--  suppression, rate-of-rise, particle detail) that the telemetry table
--  doesn't have yet. A single missing column makes the WHOLE batch insert
--  fail, so every live reading shows 0 on the dashboard even though the
--  device is online and publishing correctly.
--
--  HOW: open Supabase → SQL Editor → New query → paste this whole file →
--  Run. All statements are IF NOT EXISTS, so it's safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- ── 1. classifier + gas + optical columns ───────────────────────────
ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS fire_type      text,
  ADD COLUMN IF NOT EXISTS fire_label     text,
  ADD COLUMN IF NOT EXISTS confidence     real,
  ADD COLUMN IF NOT EXISTS action         text,
  ADD COLUMN IF NOT EXISTS sensors_active smallint,
  ADD COLUMN IF NOT EXISTS confirmed      boolean,
  ADD COLUMN IF NOT EXISTS h2_ppm    real,
  ADD COLUMN IF NOT EXISTS co_ppm    real,
  ADD COLUMN IF NOT EXISTS voc_ppb   real,
  ADD COLUMN IF NOT EXISTS temp_rtd  real,
  ADD COLUMN IF NOT EXISTS vesda_pct real,
  ADD COLUMN IF NOT EXISTS vesda_present boolean,
  ADD COLUMN IF NOT EXISTS optical_pct real,
  ADD COLUMN IF NOT EXISTS smoke_source text,
  ADD COLUMN IF NOT EXISTS supp_pct  real,
  ADD COLUMN IF NOT EXISTS pm2_5     real,
  ADD COLUMN IF NOT EXISTS pm_ratio  real;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source     text,
  ADD COLUMN IF NOT EXISTS fire_type  text,
  ADD COLUMN IF NOT EXISTS fire_label text,
  ADD COLUMN IF NOT EXISTS confidence real,
  ADD COLUMN IF NOT EXISTS action     text,
  ADD COLUMN IF NOT EXISTS h2_ppm     real,
  ADD COLUMN IF NOT EXISTS co_ppm     real,
  ADD COLUMN IF NOT EXISTS humidity   real,
  ADD COLUMN IF NOT EXISTS mq2        real;

CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded
  ON telemetry (device_id, recorded_at DESC);

-- ── 2. suppression / rate-of-rise / scores / particle detail ─────────
ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS supp_pressure_bar real,
  ADD COLUMN IF NOT EXISTS supp_pressure_low boolean,
  ADD COLUMN IF NOT EXISTS supp_discharged   boolean,
  ADD COLUMN IF NOT EXISTS supp_door_open    boolean,
  ADD COLUMN IF NOT EXISTS silenced     boolean,
  ADD COLUMN IF NOT EXISTS alarm_source text,
  ADD COLUMN IF NOT EXISTS panel_alarm  boolean,
  ADD COLUMN IF NOT EXISTS h2_rate   real,
  ADD COLUMN IF NOT EXISTS co_rate   real,
  ADD COLUMN IF NOT EXISTS temp_rate real,
  ADD COLUMN IF NOT EXISTS h2_score         real,
  ADD COLUMN IF NOT EXISTS co_score         real,
  ADD COLUMN IF NOT EXISTS voc_score        real,
  ADD COLUMN IF NOT EXISTS temp_score       real,
  ADD COLUMN IF NOT EXISTS vesda_score      real,
  ADD COLUMN IF NOT EXISTS action_label     text,
  ADD COLUMN IF NOT EXISTS sensors_agreeing boolean,  -- firmware sends bool (2+ sensors correlate)
  ADD COLUMN IF NOT EXISTS sustained_ms     int,
  ADD COLUMN IF NOT EXISTS pm1_0              real,
  ADD COLUMN IF NOT EXISTS pm10               real,
  ADD COLUMN IF NOT EXISTS particle_density   real,
  ADD COLUMN IF NOT EXISTS particle_fire_hint smallint;

-- ── 3. device_config table (per-device tuning dashboard) ─────────────
CREATE TABLE IF NOT EXISTS device_config (
  device_id  text PRIMARY KEY,
  org_id     uuid,
  config     jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE device_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_config_select ON device_config;
CREATE POLICY device_config_select ON device_config
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
