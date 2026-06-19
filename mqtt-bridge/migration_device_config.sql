-- ════════════════════════════════════════════════════════════════
--  SmokeSense — migration: per-device runtime config store
--  Arctic Engineering
--  Backs the superadmin dashboard. The /api/devices/[id]/config route
--  (service role) upserts here; /api/admin/devices reads it. Safe re-run.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS device_config (
  device_id  text PRIMARY KEY,
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_config_org ON device_config (org_id);

-- RLS on, no public policies: only the service role (bridge + admin API)
-- can read/write. The dashboard reaches it exclusively through the
-- superadmin-gated /api/admin endpoints, never directly from the browser.
ALTER TABLE device_config ENABLE ROW LEVEL SECURITY;
