-- ════════════════════════════════════════════════════════════════
--  SmokeSense — one-off cleanup of stale test devices & alarm badges
--  Run in the Supabase SQL editor. Review the device_id lists first.
--
--  Removes the old simulator devices (DG-SIMULATOR, SS-SIMULATOR) and
--  clears the stale "Emergency"/severity badge left on real devices that
--  went offline mid-state. Keeps the active DG-SIM-001 and all real,
--  currently-online devices untouched.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Delete the leftover simulator devices and their data.
--    Edit this list if your stale device ids differ. Do NOT add real
--    devices or the active DG-SIM-001.
DELETE FROM telemetry     WHERE device_id IN ('DG-SIMULATOR', 'SS-SIMULATOR');
DELETE FROM events        WHERE device_id IN ('DG-SIMULATOR', 'SS-SIMULATOR');
DELETE FROM device_config WHERE device_id IN ('DG-SIMULATOR', 'SS-SIMULATOR');
DELETE FROM devices       WHERE device_id IN ('DG-SIMULATOR', 'SS-SIMULATOR');

-- 2. Clear stale alarm badges on devices that are currently OFFLINE.
--    (An offline device keeps its last-reported severity; this resets the
--    badge to Monitor so the fleet view isn't showing a phantom alarm.)
--    Online devices are left exactly as-is.
UPDATE devices
   SET last_severity = 0
 WHERE is_online = false
   AND last_severity > 0;

-- 3. (Optional) sanity check — review what remains before committing.
--    SELECT device_id, name, is_online, last_severity, last_seen FROM devices ORDER BY last_seen DESC;

COMMIT;
