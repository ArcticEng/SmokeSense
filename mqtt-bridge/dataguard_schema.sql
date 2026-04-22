-- ═══════════════════════════════════════════════════════════
--  SmokeSense DataGuard — Supabase Schema Extension
--  Arctic Engineering — April 2026
-- ═══════════════════════════════════════════════════════════
--  Run AFTER the base smokesense schema.
--  Adds data centre specific tables for gas detection,
--  suppression monitoring, and battery bank tracking.

-- ═══════════════════════════════════════════════════════════
--  1. DATA CENTRES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS data_centres (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                -- "London DC-01"
    code            TEXT NOT NULL,                -- "LDN-01" (short code)
    address         TEXT,
    city            TEXT,
    country         TEXT DEFAULT 'GB',
    tier            TEXT DEFAULT 'Tier 3',        -- Tier 1-4
    total_racks     INT,
    total_kw        INT,                          -- total power capacity
    suppression_type TEXT DEFAULT 'novec_1230',   -- novec_1230, fm200, ig541, water_mist
    status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'decommissioned')),
    meta            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dc_org ON data_centres(org_id);

-- ═══════════════════════════════════════════════════════════
--  2. BATTERY BANKS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS battery_banks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dc_id           UUID NOT NULL REFERENCES data_centres(id) ON DELETE CASCADE,
    device_id       TEXT REFERENCES devices(device_id),  -- DataGuard unit monitoring this bank
    name            TEXT NOT NULL,                -- "UPS Bank A"
    location        TEXT,                         -- "Battery Room 1, Rack B3"
    chemistry       TEXT DEFAULT 'li_ion',        -- li_ion, lifepo4, vrla
    cell_count      INT,
    nominal_voltage REAL,                         -- total bank voltage
    capacity_kwh    REAL,
    install_date    DATE,
    last_inspection DATE,
    status          TEXT DEFAULT 'normal' CHECK (status IN ('normal', 'warning', 'critical', 'offline', 'replaced')),
    meta            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bb_dc ON battery_banks(dc_id);
CREATE INDEX idx_bb_device ON battery_banks(device_id);

-- ═══════════════════════════════════════════════════════════
--  3. GAS READINGS (time-series, high volume)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gas_readings (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       TEXT NOT NULL,
    org_id          UUID NOT NULL,
    dc_id           UUID,

    -- Gas concentrations
    h2_ppm          REAL,           -- hydrogen
    co_ppm          REAL,           -- carbon monoxide
    voc_ppb         REAL,           -- volatile organic compounds

    -- Deltas above baseline
    h2_delta        REAL,
    co_delta        REAL,
    voc_delta       REAL,

    -- Rate of change
    h2_rate         REAL,           -- ppm/min
    co_rate         REAL,
    temp_rate       REAL,           -- deg C/min

    -- Baselines
    h2_baseline     REAL,
    co_baseline     REAL,
    voc_baseline    REAL,

    -- Environment
    temperature     REAL,
    humidity        REAL,

    -- VESDA
    vesda_ma        REAL,
    vesda_smoke_pct REAL,
    vesda_severity  SMALLINT,

    -- Suppression
    supp_pressure   REAL,           -- bar
    supp_pct        REAL,           -- % of nominal
    supp_low        BOOLEAN DEFAULT false,
    discharged      BOOLEAN DEFAULT false,
    door_open       BOOLEAN DEFAULT false,

    -- Panel
    panel_alarm     BOOLEAN DEFAULT false,

    -- Overall
    severity        SMALLINT DEFAULT 0,
    alarm_source    TEXT,

    recorded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gas_dev_time ON gas_readings(device_id, recorded_at DESC);
CREATE INDEX idx_gas_org_time ON gas_readings(org_id, recorded_at DESC);
CREATE INDEX idx_gas_sev ON gas_readings(severity) WHERE severity > 0;
CREATE INDEX idx_gas_dc ON gas_readings(dc_id, recorded_at DESC);

-- ═══════════════════════════════════════════════════════════
--  4. SUPPRESSION SYSTEMS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suppression_systems (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dc_id           UUID NOT NULL REFERENCES data_centres(id) ON DELETE CASCADE,
    device_id       TEXT REFERENCES devices(device_id),
    name            TEXT NOT NULL,                -- "Server Hall A Suppression"
    agent_type      TEXT DEFAULT 'novec_1230',    -- novec_1230, fm200, ig541, water_mist
    zone            TEXT,                         -- "Server Hall A"
    cylinder_count  INT DEFAULT 1,
    nominal_pressure REAL DEFAULT 25.0,           -- bar
    last_inspection DATE,
    last_discharge  TIMESTAMPTZ,
    status          TEXT DEFAULT 'armed' CHECK (status IN ('armed', 'discharged', 'maintenance', 'fault')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_supp_dc ON suppression_systems(dc_id);

-- ═══════════════════════════════════════════════════════════
--  5. SUPPRESSION EVENTS (discharge history)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suppression_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    system_id       UUID REFERENCES suppression_systems(id),
    device_id       TEXT NOT NULL,
    dc_id           UUID,
    event_type      TEXT NOT NULL,    -- discharge, pressure_drop, door_open, manual_release, pressure_restored
    pressure_bar    REAL,
    pressure_pct    REAL,
    trigger_source  TEXT,             -- automatic, manual, panel
    notes           TEXT,
    acknowledged    BOOLEAN DEFAULT false,
    acknowledged_by UUID,
    recorded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_supp_ev_dev ON suppression_events(device_id, recorded_at DESC);

-- ═══════════════════════════════════════════════════════════
--  6. COMPLIANCE INSPECTIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inspections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dc_id           UUID NOT NULL REFERENCES data_centres(id) ON DELETE CASCADE,
    inspector       TEXT,
    inspection_type TEXT,              -- annual, quarterly, post_discharge
    findings        TEXT,
    pass            BOOLEAN,
    attachments     JSONB DEFAULT '[]',
    inspected_at    TIMESTAMPTZ DEFAULT now(),
    next_due        DATE
);

-- ═══════════════════════════════════════════════════════════
--  7. RLS POLICIES (extend base schema)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE data_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE gas_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dc_read" ON data_centres FOR SELECT USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY "bb_read" ON battery_banks FOR SELECT USING (dc_id IN (SELECT id FROM data_centres WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "gas_read" ON gas_readings FOR SELECT USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY "supp_read" ON suppression_systems FOR SELECT USING (dc_id IN (SELECT id FROM data_centres WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "supp_ev_read" ON suppression_events FOR SELECT USING (dc_id IN (SELECT id FROM data_centres WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "insp_read" ON inspections FOR SELECT USING (dc_id IN (SELECT id FROM data_centres WHERE org_id IN (SELECT user_org_ids())));

-- ═══════════════════════════════════════════════════════════
--  8. REALTIME
-- ═══════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE suppression_systems;
ALTER PUBLICATION supabase_realtime ADD TABLE suppression_events;

-- ═══════════════════════════════════════════════════════════
--  9. CLEANUP FUNCTION
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cleanup_old_gas_readings(retention_days INT DEFAULT 90)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE deleted INT;
BEGIN
    DELETE FROM gas_readings WHERE recorded_at < now() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;

-- ═══════════════════════════════════════════════════════════
--  10. SEED DATA (NVIDIA UK data centres)
-- ═══════════════════════════════════════════════════════════
/*
INSERT INTO organizations (name, slug, address, city, country, plan, max_devices) VALUES
    ('NVIDIA UK Data Centres', 'nvidia-dc-uk', 'Slough Trading Estate', 'Slough', 'GB', 'enterprise', 500);

INSERT INTO data_centres (org_id, name, code, city, country, tier, total_racks, total_kw, suppression_type) VALUES
    ((SELECT id FROM organizations WHERE slug = 'nvidia-dc-uk'), 'London DC-01', 'LDN-01', 'London', 'GB', 'Tier 3', 200, 4000, 'novec_1230'),
    ((SELECT id FROM organizations WHERE slug = 'nvidia-dc-uk'), 'London DC-02', 'LDN-02', 'London', 'GB', 'Tier 3', 150, 3000, 'novec_1230'),
    ((SELECT id FROM organizations WHERE slug = 'nvidia-dc-uk'), 'Manchester DC-01', 'MAN-01', 'Manchester', 'GB', 'Tier 3', 180, 3600, 'fm200');
*/
