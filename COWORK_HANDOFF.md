# DataGuard DG-100 — Engineering Handoff (for Claude Cowork)

**Project owner:** Rigard Venter, Arctic Engineering (Cape Town)
**Product:** DataGuard DG-100 — multi-sensor fire detection + classification IoT platform, targeting data-centre clients.
**Repo:** `ArcticEng/SmokeSense` · **Local:** `/Users/rigard/Desktop/smokesense/`
**Purpose of this doc:** Give a fresh session enough context to continue without re-reading the whole codebase. Read this first, then `git status`/`git diff` (files have been edited across multiple sessions — verify nothing is mid-flight before building).

---

## 1. System architecture

```
ESP32 device (firmware/)                      Cloud
┌────────────────────────┐   MQTT      ┌──────────────┐   ┌──────────────────┐
│ Sensors → classifier   │──topics────▶│ Mosquitto    │──▶│ Node bridge      │
│ runtime config (NVS)   │◀──config────│ (Railway)    │   │ mqtt_bridge.js   │
└────────────────────────┘  (retained) └──────────────┘   │ (Railway)        │
                                                            └───────┬──────────┘
                                              writes telemetry/events/devices/
                                              device_config + realtime broadcast
                                                                    ▼
                                              Supabase (Postgres + Auth + Realtime)
                                                                    ▼
                                              Next.js dashboard (Vercel)
                                              /dashboard  +  /dashboard/admin (superadmin)
```

**MQTT topics** (prefix `smokesense/{orgSlug}/{deviceId}/…`): `telemetry`, `event`, `status` (LWT), `heartbeat`, `cmd`, `config` (retained, dashboard→device), `confstate` (retained, device→dashboard echo of applied config).

**Config flow:** dashboard → `POST /api/devices/[id]/config` (superadmin-gated) → merges patch onto last-known config in `device_config` table → publishes full merged config retained on `…/config` → device merges into `RuntimeConfig`, persists to NVS, applies live, echoes `confstate`.

---

## 2. Hardware / sensors

| Channel | Part | Interface | Notes |
|---|---|---|---|
| Gas (H₂, CO) | Alphasense H2-AF + CO-AF on ISB → **ADS1115** | I²C 0x48 | WE−AE differential |
| VOC + temp/humidity/pressure | **BME680** | I²C 0x77 | VOC ppb is a rough linearisation (uncalibrated) |
| Precision temp | **MAX31865** + PT100 | SPI | |
| External smoke | **VESDA** aspirating detector | 4–20 mA / pot → ADC GPIO36 | Own channel; optional (`vesda_present`) |
| Optical smoke (custom) | **ADPD4101** dual-wavelength scatter chamber | I²C 0x24 | NEW. 65 mm PETG chamber: IR LED 0°, Blue LED 340°, fwd PD 25°, back PD 135° |
| Particles (optional) | **PMS5003** | UART2 | Particle classification |
| Suppression / panel | pressure 4–20 mA + relay inputs | ADC/GPIO | |

**Optical chamber BOM (to order):** `EVAL-ADPD4101-ARDZ` breakout (DigiKey `505-EVAL-ADPD4101-ARDZ-ND`, ~US$59) · 2× clear Si photodiode `Vishay BPW34` (or `ams-OSRAM SFH 203 P`) · 470 nm 5 mm blue LED · 850 nm 5 mm IR LED (`ams-OSRAM SFH 4544`). LEDs/PDs press into existing 5 mm bores; AFE shares the I²C bus (no GPIO conflict).

---

## 3. What the recent workstream built (state: DONE in code, NOT yet compiled/deployed)

1. **Optical chamber driver** `firmware/adpd4101.h` — drives LEDs, reads PDs via the ADPD4101 (on-chip TIA+ADC+ambient rejection), computes scatter delta, smoke %, Blue/IR + Fwd/Back ratios, and a particle fire-hint. **Runtime-tunable members** (`smoke_fullscale`, `smoke_thresh_pct`, `irblue_small/large`, `fwdback_small/large`).
   - ⚠️ **Needs Wavetool work before it returns real data:** wire the chamber to the breakout, configure 2 time-slots (IR/Blue) × 2 inputs (fwd/back) in ADI Wavetool, tune LED currents, export the register set into `ADPD_INIT[]`, and verify the FIFO unpack order in `readResultSet()`. Registers marked `VERIFY` must be confirmed against the ADPD4101 datasheet.

2. **Pipeline fix (was silently broken):** the fire classifier + gas + particle data were computed on-device but **dropped by the MQTT bridge**. Added the mappings in `mqtt-bridge/mqtt_bridge.js` (`handleTelemetry`/`handleEvent`) + columns via `migration_classifier_optical.sql`. Also fixed the Supabase realtime broadcast (was publishing on an unsubscribed channel → persistent channels now), unified stage labels, widened MQTT buffers (telemetry JSON grew).

3. **VESDA + chamber as independent channels:** VESDA is always-on when `vesda_present`; the optical chamber/PMS form a separate `chamber` channel. Effective smoke fed to the classifier = `max(vesda, chamber)` when VESDA present, chamber alone when absent. Dashboard smoke bar adapts (`vesda_pct` vs `optical_pct`, labelled by source).

4. **Runtime config + superadmin tuning:** every tunable parameter is NVS-persisted and patchable live over MQTT — **no reflashing to tune during testing.** Superadmin dashboard at `/dashboard/admin`: fleet list across all orgs + feature toggles + grouped parameter editors (beam sensitivity, classification thresholds, confidence→action cutoffs, gas alarm levels, timing). Gated by `SUPERADMIN_EMAILS` env allowlist.

---

## 4. Runtime config schema (`firmware/runtime_config.h` ↔ admin UI ↔ `device_config.config` JSON)

All keys are flat in the config JSON. Defaults come from `#define`s; NVS overrides; MQTT patches merge.

- **Features (bool):** `vesda_present`, `use_adpd`, `use_pms`
- **Gas alarm levels:** `h2_alert`, `co_alert`, `voc_alert`, `h2_critical`, `co_critical`, `h2_emergency`, `co_emergency`, `h2_rate_critical`, `temp_rate_critical`
- **Classifier sensitivities:** `thr_h2_low/high`, `thr_co_low/high`, `thr_voc_low/high`, `thr_temprate_low/high`, `thr_vesda_low/high`, `thr_humidity_high`
- **Confidence→action cutoffs (%):** `conf_alert`, `conf_prealarm`, `conf_critical`, `conf_emergency`
- **Optical/beam sensitivity:** `adpd_fullscale` (↓ = more sensitive), `adpd_smoke_thresh`, `irblue_small/large`, `fwdback_small/large`
- **Timing:** `poll_ms`

Patch = only the keys you change. The API stores the *merged* result so the retained message is always complete (a reconnecting device gets full state).

---

## 5. Telemetry JSON contract (device → bridge → DB)

Top level: `dev, ts, fw, type, uptime, sev (0–4), stage, source, silenced, panel_alarm, smoke, rssi, heap, buffered`.
Nested objects: `gas{h2_ppm,co_ppm,voc_ppb,…}`, `env{temp_rtd,humidity,…}`, `vesda{present,smoke_pct,ma,sev}`, `chamber{smoke_pct,sev,source}`, `suppression{…}`, `classifier{fire_type,fire_label,confidence,action,sensors_active,confirmed,…scores}`, `particles{pm2_5,ratio,…}` (if PMS), plus legacy flat optical keys `delta, ir_blue, fwd_back, raw{fwd_ir,fwd_blu,bck_ir,bck_blu}, baseline{fwd,back}`.

Bridge maps these into `telemetry` / `events` rows; dashboard reads `telemetry` (latest via 3 s poll + realtime).

---

## 6. File map

**Firmware** `/firmware/`
- `SmokeSense_DataGuard.ino` — main; loads config, sensor reads, classifier, MQTT, config handler in `mqtt_cb`, `apply_config()`, `publish_confstate()`.
- `runtime_config.h` — `RuntimeConfig` struct + NVS load/save + JSON merge/serialize.
- `fire_classifier.h` — classifier; runtime `thr` thresholds incl. `conf_*` cutoffs.
- `adpd4101.h` — optical chamber driver (needs Wavetool register export).
- `pms5003.h`, `dataguard_config.h` (compile-time defaults + pins), `config.h` (legacy/other build), `platformio.ini`.

**Bridge** `/mqtt-bridge/`
- `mqtt_bridge.js` — MQTT→Supabase, alerts, realtime, auto-register.
- `alerts.js` — SendGrid email + Twilio SMS on escalation.
- `migration_classifier_optical.sql`, `migration_device_config.sql` — **run both in Supabase.**

**Dashboard** `/app`, `/lib`
- `app/dashboard/page.tsx` — operator view (per-device detail, classification card, adaptive smoke bar, optical card, event log). Admin link gated on `/api/admin/me`.
- `app/dashboard/admin/page.tsx` — **superadmin tuning UI.**
- `app/dashboard/fleet/` — fleet map.
- `app/api/admin/{devices,me}/route.ts`, `app/api/devices/[deviceId]/{command,config}/route.ts`.
- `lib/auth.ts` (`SUPERADMIN_EMAILS` allowlist), `lib/hooks.ts`, `lib/supabase.ts` (types).

---

## 7. Outstanding tasks (priority order)

1. **Run migrations** in Supabase SQL editor: `migration_device_config.sql` and `migration_classifier_optical.sql`.
2. **Set Vercel env** (server-side, never `NEXT_PUBLIC_`): `SUPERADMIN_EMAILS`, `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `SUPABASE_SERVICE_KEY`. The config/command API routes publish MQTT using these.
3. **Compile-verify** (not done in the recent workstream): `cd firmware && pio run`, and `npm run build` for the dashboard.
4. **Optical chamber bring-up:** order BOM → wire to breakout → Wavetool config → paste `ADPD_INIT[]` + verify FIFO unpack in `adpd4101.h` → set `use_adpd` true from the admin UI.
5. Optional polish: move broker creds off the public-HiveMQ default; rotate the WiFi password in `config.h`; make `dataguard_sim.mjs` emit the new `classifier`/`gas`/`chamber` objects for end-to-end testing without a physical device.

## 8. Known risks / gotchas

- **Org-slug routing:** config publishes to `smokesense/{organizations.slug}/{deviceId}/config`; the device subscribes using firmware `MQTT_ORG_ID`. These **must match** or config never reaches the device. Live device `DG-F5F58F58` was provisioned under org `demo`, but committed `dataguard_config.h` has `MQTT_ORG_ID "default"`. Reconcile before testing config push.
- **Public broker default:** firmware + bridge + API routes fall back to public `broker.hivemq.com:1883` unauthenticated if `MQTT_*` env/macros aren't set. Point everything at the private Railway Mosquitto with TLS+auth.
- **Concurrent edits:** this codebase was edited across multiple sessions (firmware runtime-config layer, API routes, admin UI all appeared mid-stream). Run `git diff` before building; reconcile any overlap.
- **VOC ppb** is uncalibrated (rough linearisation) — fine for demo, don't quote absolute ppb.
- **Sensor-enable toggles** (`use_adpd`/`use_pms`): firmware initialises a newly-enabled sensor on the fly in `mqtt_cb`, so no reboot needed; disabling just stops polling.
- Build locally before flashing/deploying — the firmware/dashboard were not compiled in the recent workstream.

## 9. Conventions

- Firmware: ArduinoJson v7 (`JsonDocument`), PubSubClient (`setBufferSize(1536)`), NVS namespaces `dg` (baselines) and `dgcfg` (runtime config JSON blob).
- Severity scale 0–4 = Monitor / Alert / Pre-Alarm / Critical / Emergency (unify any stray label sets to this).
- DataGuard devices have `device_id` starting `DG-`; the dashboard branches UI on that prefix.
- Admin API uses the Supabase **service role** (bypasses RLS); never expose that key client-side.
