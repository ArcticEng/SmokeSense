-- ════════════════════════════════════════════════════════════════
--  SmokeSense — migration: telemetry extras (suppression safety,
--  rate-of-rise, classifier scores, particle detail)
--  Arctic Engineering
--  Run AFTER migration_classifier_optical.sql, in the Supabase SQL
--  editor (or via supabase db push). All IF NOT EXISTS — safe to re-run.
--
--  These columns capture fields the firmware already publishes but the
--  bridge previously dropped. Ultra-granular fields that remain in the
--  MQTT payload but are intentionally NOT columnised (to keep this
--  high-volume table narrow): per-bin particle counts (cnt_*), electrode
--  millivolts (h2_we_mv/co_we_mv), gas baselines, and gas deltas
--  (scatter_delta already carries h2_delta when no optical chamber).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE telemetry
  -- suppression safety state
  ADD COLUMN IF NOT EXISTS supp_pressure_bar real,
  ADD COLUMN IF NOT EXISTS supp_pressure_low boolean,
  ADD COLUMN IF NOT EXISTS supp_discharged   boolean,
  ADD COLUMN IF NOT EXISTS supp_door_open    boolean,
  -- alarm context
  ADD COLUMN IF NOT EXISTS silenced     boolean,
  ADD COLUMN IF NOT EXISTS alarm_source text,
  ADD COLUMN IF NOT EXISTS panel_alarm  boolean,
  -- rate-of-rise
  ADD COLUMN IF NOT EXISTS h2_rate   real,
  ADD COLUMN IF NOT EXISTS co_rate   real,
  ADD COLUMN IF NOT EXISTS temp_rate real,
  -- classifier per-sensor scores + diagnostics
  ADD COLUMN IF NOT EXISTS h2_score         real,
  ADD COLUMN IF NOT EXISTS co_score         real,
  ADD COLUMN IF NOT EXISTS voc_score        real,
  ADD COLUMN IF NOT EXISTS temp_score       real,
  ADD COLUMN IF NOT EXISTS vesda_score      real,
  ADD COLUMN IF NOT EXISTS action_label     text,
  ADD COLUMN IF NOT EXISTS sensors_agreeing boolean,  -- firmware sends bool (2+ sensors correlate)
  ADD COLUMN IF NOT EXISTS sustained_ms     int,
  -- particle detail
  ADD COLUMN IF NOT EXISTS pm1_0              real,
  ADD COLUMN IF NOT EXISTS pm10               real,
  ADD COLUMN IF NOT EXISTS particle_density   real,
  ADD COLUMN IF NOT EXISTS particle_fire_hint smallint;
