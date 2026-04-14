-- ═══════════════════════════════════════════════════════════
--  SmokeSense — Supabase Schema Migration
--  Arctic Engineering — April 2026
-- ═══════════════════════════════════════════════════════════
--
--  Run this in Supabase Dashboard → SQL Editor → New Query
--  Or via CLI: supabase db push
--
--  Tables:
--    organizations  — multi-tenant: one per customer/building
--    org_members    — user ↔ org membership with roles
--    devices        — registered sensor nodes
--    telemetry      — time-series sensor readings (high volume)
--    events         — alarm stage changes + command acks
--    thresholds     — per-device configurable alarm thresholds


-- ═══════════════════════════════════════════════════════════
--  1. ORGANIZATIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,           -- used as MQTT org_id
    address     TEXT,
    city        TEXT,
    country     TEXT DEFAULT 'ZA',
    plan        TEXT DEFAULT 'starter'           -- starter | commercial | enterprise
                CHECK (plan IN ('starter', 'commercial', 'enterprise')),
    max_devices INT DEFAULT 5,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_org_slug ON organizations(slug);


-- ═══════════════════════════════════════════════════════════
--  2. ORG MEMBERS (links auth.users to orgs)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('owner', 'admin', 'technician', 'viewer')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, user_id)
);

CREATE INDEX idx_orgmem_user ON org_members(user_id);
CREATE INDEX idx_orgmem_org  ON org_members(org_id);


-- ═══════════════════════════════════════════════════════════
--  3. DEVICES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id       TEXT NOT NULL UNIQUE,        -- e.g. "SS-A1B2C3D4" from ESP32 MAC
    name            TEXT NOT NULL,               -- human label: "Lobby entrance"
    zone            TEXT,                        -- "Ground floor", "Basement", etc.
    firmware        TEXT,                        -- last reported firmware version
    ip_address      TEXT,
    rssi            INT,                         -- WiFi signal strength
    is_online       BOOLEAN DEFAULT false,
    last_seen       TIMESTAMPTZ,
    last_severity   INT DEFAULT 0,               -- 0-4, mirrors alarm stage
    battery_pct     REAL,
    baseline_fwd    REAL,
    baseline_back   REAL,
    baseline_mq2    REAL,
    meta            JSONB DEFAULT '{}',          -- extensible metadata
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dev_org     ON devices(org_id);
CREATE INDEX idx_dev_devid   ON devices(device_id);
CREATE INDEX idx_dev_online  ON devices(is_online);
CREATE INDEX idx_dev_sev     ON devices(last_severity);


-- ═══════════════════════════════════════════════════════════
--  4. TELEMETRY (time-series, high volume)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS telemetry (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       TEXT NOT NULL,               -- FK by value, not constraint (perf)
    org_id          UUID NOT NULL,

    -- Alarm state
    severity        SMALLINT NOT NULL DEFAULT 0,
    stage           TEXT,
    is_smoke        BOOLEAN DEFAULT false,
    is_smouldering  BOOLEAN DEFAULT false,
    mq2_alarm       BOOLEAN DEFAULT false,

    -- Processed values
    scatter_delta   REAL,
    ir_blue_ratio   REAL,
    fwd_back_ratio  REAL,

    -- Raw sensor
    pd_fwd_ir       INT,
    pd_fwd_blue     INT,
    pd_back_ir      INT,
    pd_back_blue    INT,
    mq2             INT,
    temperature     REAL,
    humidity        REAL,

    -- Baselines
    baseline_fwd    REAL,
    baseline_back   REAL,
    baseline_mq2    REAL,

    -- Device health
    rssi            INT,
    heap            INT,
    uptime_s        INT,

    recorded_at     TIMESTAMPTZ DEFAULT now()
);

-- Partition-friendly index for time-range queries
CREATE INDEX idx_telem_dev_time ON telemetry(device_id, recorded_at DESC);
CREATE INDEX idx_telem_org_time ON telemetry(org_id, recorded_at DESC);
CREATE INDEX idx_telem_sev      ON telemetry(severity) WHERE severity > 0;


-- ═══════════════════════════════════════════════════════════
--  5. EVENTS (alarm changes, commands, acks)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       TEXT NOT NULL,
    org_id          UUID NOT NULL,
    event_type      TEXT NOT NULL,               -- escalation | de-escalation | cmd_ack | self_test | config_ack
    from_stage      TEXT,
    to_stage        TEXT,
    severity        SMALLINT,
    scatter_delta   REAL,
    ir_blue_ratio   REAL,
    is_smoke        BOOLEAN,
    temperature     REAL,
    humidity        REAL,
    mq2             INT,
    payload         JSONB DEFAULT '{}',          -- full original MQTT message
    acknowledged    BOOLEAN DEFAULT false,        -- has a human reviewed this?
    acknowledged_by UUID REFERENCES auth.users(id),
    acknowledged_at TIMESTAMPTZ,
    recorded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_dev_time ON events(device_id, recorded_at DESC);
CREATE INDEX idx_events_org_type ON events(org_id, event_type, recorded_at DESC);
CREATE INDEX idx_events_unacked  ON events(acknowledged) WHERE acknowledged = false;


-- ═══════════════════════════════════════════════════════════
--  6. THRESHOLDS (per-device, remotely configurable)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS thresholds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   TEXT NOT NULL UNIQUE REFERENCES devices(device_id) ON DELETE CASCADE,
    alert       INT DEFAULT 80,
    action      INT DEFAULT 200,
    fire1       INT DEFAULT 400,
    fire2       INT DEFAULT 700,
    mq2         INT DEFAULT 600,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    pushed_at   TIMESTAMPTZ                      -- when last sent to device via MQTT
);


-- ═══════════════════════════════════════════════════════════
--  7. HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- Get user's org IDs (used in RLS policies)
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT org_id FROM org_members WHERE user_id = auth.uid();
$$;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_updated
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_dev_updated
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_thresh_updated
    BEFORE UPDATE ON thresholds
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();


-- ═══════════════════════════════════════════════════════════
--  8. TELEMETRY CLEANUP (auto-delete old data)
-- ═══════════════════════════════════════════════════════════

-- Call this daily via Supabase Edge Function or pg_cron
CREATE OR REPLACE FUNCTION cleanup_old_telemetry(retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    deleted INT;
BEGIN
    DELETE FROM telemetry
    WHERE recorded_at < now() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;


-- ═══════════════════════════════════════════════════════════
--  9. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry      ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE thresholds     ENABLE ROW LEVEL SECURITY;

-- Organizations: members can read their own orgs
CREATE POLICY "org_read" ON organizations
    FOR SELECT USING (id IN (SELECT user_org_ids()));

-- Org members: users see their own memberships
CREATE POLICY "orgmem_read" ON org_members
    FOR SELECT USING (user_id = auth.uid());

-- Devices: members see devices in their orgs
CREATE POLICY "dev_read" ON devices
    FOR SELECT USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "dev_update" ON devices
    FOR UPDATE USING (org_id IN (SELECT user_org_ids()))
    WITH CHECK (org_id IN (SELECT user_org_ids()));

-- Telemetry: members see their org's telemetry
CREATE POLICY "telem_read" ON telemetry
    FOR SELECT USING (org_id IN (SELECT user_org_ids()));

-- Events: members see their org's events
CREATE POLICY "events_read" ON events
    FOR SELECT USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "events_ack" ON events
    FOR UPDATE USING (org_id IN (SELECT user_org_ids()))
    WITH CHECK (org_id IN (SELECT user_org_ids()));

-- Thresholds: members can read, admins+ can update
CREATE POLICY "thresh_read" ON thresholds
    FOR SELECT USING (
        device_id IN (
            SELECT d.device_id FROM devices d
            WHERE d.org_id IN (SELECT user_org_ids())
        )
    );

CREATE POLICY "thresh_update" ON thresholds
    FOR UPDATE USING (
        device_id IN (
            SELECT d.device_id FROM devices d
            JOIN org_members om ON om.org_id = d.org_id
            WHERE om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'technician')
        )
    );

-- Service role bypass (for MQTT bridge server)
-- The bridge uses the service_role key, which bypasses RLS automatically.


-- ═══════════════════════════════════════════════════════════
--  10. REALTIME — enable for live dashboard
-- ═══════════════════════════════════════════════════════════

-- Enable Supabase Realtime on key tables
-- (Do this in Dashboard → Database → Replication, or:)
ALTER PUBLICATION supabase_realtime ADD TABLE devices;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
-- Note: don't add telemetry to realtime — too high volume.
-- Instead, the bridge broadcasts to a Supabase channel directly.


-- ═══════════════════════════════════════════════════════════
--  11. SEED DATA (for development)
-- ═══════════════════════════════════════════════════════════

-- Uncomment to insert a test org and device:
/*
INSERT INTO organizations (name, slug, address, city, plan, max_devices) VALUES
    ('Demo Building', 'demo', '123 Main Rd', 'Cape Town', 'commercial', 50);

INSERT INTO devices (org_id, device_id, name, zone) VALUES
    ((SELECT id FROM organizations WHERE slug = 'demo'), 'SS-A1B2C3D4', 'Lobby entrance', 'Ground floor'),
    ((SELECT id FROM organizations WHERE slug = 'demo'), 'SS-E5F6G7H8', 'Server room', 'Basement');
*/
