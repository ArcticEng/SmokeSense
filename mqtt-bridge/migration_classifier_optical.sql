-- ════════════════════════════════════════════════════════════════
--  SmokeSense — migration: surface fire classifier + gas + optical
--  Arctic Engineering
--  Run once in the Supabase SQL editor (or via supabase db push).
--  Adds the columns the firmware already publishes but that the
--  bridge previously dropped. All IF NOT EXISTS — safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- ── telemetry table ──────────────────────────────────────────────
ALTER TABLE telemetry
  -- fire classifier
  ADD COLUMN IF NOT EXISTS fire_type      text,
  ADD COLUMN IF NOT EXISTS fire_label     text,
  ADD COLUMN IF NOT EXISTS confidence     real,
  ADD COLUMN IF NOT EXISTS action         text,
  ADD COLUMN IF NOT EXISTS sensors_active smallint,
  ADD COLUMN IF NOT EXISTS confirmed      boolean,
  -- gas + smoke + particles
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

-- ── events table ─────────────────────────────────────────────────
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

-- ── helpful index for the dashboard's latest-telemetry query ──────
CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded
  ON telemetry (device_id, recorded_at DESC);

-- ── device_config: per-device runtime config (superadmin tuning) ─────
CREATE TABLE IF NOT EXISTS device_config (
  device_id  text PRIMARY KEY,
  org_id     uuid,
  config     jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE device_config ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read config for devices in their org.
DROP POLICY IF EXISTS device_config_select ON device_config;
CREATE POLICY device_config_select ON device_config
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
-- Writes go through the service-role API (bridge + Next.js), which bypasses RLS.
