/*
 * fire_classifier.h — Multi-Sensor Fire Classification Engine
 * Arctic Engineering — DataGuard v2.0
 *
 * Compares live sensor readings against known fire signatures.
 * Outputs: fire_type, confidence (0-100%), recommended_action.
 * 
 * KEY PRINCIPLE: No single sensor triggers evacuation.
 * Multiple independent sensors must agree before escalation.
 */

#pragma once
#include <Arduino.h>

// ═══════════════════════════════════════════════════
//  FIRE TYPES
// ═══════════════════════════════════════════════════

enum FireType {
    FIRE_NONE          = 0,  // Clean air, all sensors normal
    FIRE_NUISANCE      = 1,  // Single sensor spike — dust, steam, aerosol
    FIRE_BATTERY_EARLY = 2,  // H2 rising, early off-gas (5-30 min warning)
    FIRE_BATTERY_RUNAWAY=3,  // H2 + VOC + CO + temp — active thermal runaway
    FIRE_SMOULDERING   = 4,  // CO dominant, large particles, slow temp rise
    FIRE_FLAMING       = 5,  // Rapid temp rise, VOC high, VESDA active
    FIRE_ELECTRICAL    = 6,  // VOC spike (insulation), CO moderate, no H2
    FIRE_TYPE_COUNT    = 7
};

static const char* FIRE_TYPE_NAMES[] = {
    "none", "nuisance", "battery_early", "battery_runaway",
    "smouldering", "flaming", "electrical"
};

static const char* FIRE_TYPE_LABELS[] = {
    "Normal", "Nuisance (false alarm)", "Battery off-gas (early)",
    "Battery thermal runaway", "Smouldering fire",
    "Flaming fire", "Electrical fault"
};

// ═══════════════════════════════════════════════════
//  ACTION LEVELS (based on confidence)
// ═══════════════════════════════════════════════════

enum ActionLevel {
    ACTION_MONITOR    = 0,  // <30%  — log only
    ACTION_ALERT      = 1,  // 30-55% — notify operators
    ACTION_PREALARM   = 2,  // 55-75% — prepare response
    ACTION_CRITICAL   = 3,  // 75-90% — activate suppression
    ACTION_EMERGENCY  = 4   // >90%  — full evacuation
};

static const char* ACTION_NAMES[] = {
    "monitor", "alert", "pre_alarm", "critical", "emergency"
};

static const char* ACTION_LABELS[] = {
    "Monitoring", "Alert — investigate", "Pre-alarm — prepare",
    "Critical — suppression", "Emergency — evacuate"
};

// ═══════════════════════════════════════════════════
//  SENSOR THRESHOLDS (per-sensor abnormal detection)
// ═══════════════════════════════════════════════════

// Each sensor has a LOW and HIGH threshold
// Below LOW = normal, above LOW = elevated, above HIGH = critical

#define THRESH_H2_LOW        10.0f   // ppm — early detection
#define THRESH_H2_HIGH       50.0f   // ppm — critical level
#define THRESH_CO_LOW        10.0f   // ppm — early detection  
#define THRESH_CO_HIGH       35.0f   // ppm — OSHA 8hr TWA
#define THRESH_VOC_LOW       200.0f  // ppb — above typical indoor
#define THRESH_VOC_HIGH      500.0f  // ppb — significant off-gassing
#define THRESH_TEMP_RATE_LOW 0.5f    // °C/min — noticeable rise
#define THRESH_TEMP_RATE_HIGH 2.0f   // °C/min — rapid rise
#define THRESH_VESDA_LOW     5.0f    // % — early smoke detection
#define THRESH_VESDA_HIGH    25.0f   // % — confirmed smoke
#define THRESH_HUMIDITY_HIGH 80.0f   // % — steam risk (reduces confidence)

// ═══════════════════════════════════════════════════
//  FIRE SIGNATURE PROFILES
//  Each fire type has an expected sensor pattern.
//  Values 0.0-1.0 represent how much each sensor
//  contributes to that fire type's signature.
// ═══════════════════════════════════════════════════

struct FireSignature {
    float h2_weight;      // How important H2 is for this fire type
    float co_weight;      // How important CO is
    float voc_weight;     // How important VOC is
    float temp_rate_weight;// How important temp rise rate is
    float vesda_weight;   // How important VESDA/smoke is
};

// Signature weights for each fire type (must sum to ~1.0 per type)
static const FireSignature SIGNATURES[FIRE_TYPE_COUNT] = {
    // FIRE_NONE          — all zeros, no detection
    { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },
    // FIRE_NUISANCE      — single sensor, low weight
    { 0.1f, 0.1f, 0.2f, 0.1f, 0.5f },
    // FIRE_BATTERY_EARLY — H2 dominant, VOC secondary
    { 0.55f, 0.05f, 0.25f, 0.10f, 0.05f },
    // FIRE_BATTERY_RUNAWAY — H2 + VOC + CO all high
    { 0.30f, 0.20f, 0.25f, 0.15f, 0.10f },
    // FIRE_SMOULDERING   — CO dominant, VESDA high
    { 0.05f, 0.35f, 0.15f, 0.10f, 0.35f },
    // FIRE_FLAMING       — temp rate + VESDA dominant
    { 0.05f, 0.15f, 0.20f, 0.30f, 0.30f },
    // FIRE_ELECTRICAL    — VOC spike dominant, some CO
    { 0.05f, 0.20f, 0.45f, 0.15f, 0.15f },
};

// ═══════════════════════════════════════════════════
//  CLASSIFIER STATE
// ═══════════════════════════════════════════════════

struct ClassifierResult {
    FireType    fire_type;
    float       confidence;          // 0-100%
    ActionLevel action;
    float       match_scores[FIRE_TYPE_COUNT]; // score per fire type
    uint8_t     sensors_active;      // how many sensors above threshold
    bool        sensors_agreeing;    // 2+ sensors correlate
    uint32_t    sustained_ms;        // how long current detection held
    float       h2_score, co_score, voc_score, temp_score, vesda_score;
};

struct ClassifierState {
    ClassifierResult result;
    FireType    prev_type;
    uint32_t    detection_start;     // millis() when first detected
    float       prev_confidence;
    uint8_t     stable_count;        // readings at same fire type
    bool        confirmed;           // sustained > 60s
};

// ═══════════════════════════════════════════════════
//  CLASSIFIER ENGINE
// ═══════════════════════════════════════════════════

// Runtime-tunable thresholds (default to the compile-time values above).
// The superadmin dashboard overrides these live via the config topic.
struct ClassifierThresholds {
    float h2_low = THRESH_H2_LOW, h2_high = THRESH_H2_HIGH;
    float co_low = THRESH_CO_LOW, co_high = THRESH_CO_HIGH;
    float voc_low = THRESH_VOC_LOW, voc_high = THRESH_VOC_HIGH;
    float temprate_low = THRESH_TEMP_RATE_LOW, temprate_high = THRESH_TEMP_RATE_HIGH;
    float vesda_low = THRESH_VESDA_LOW, vesda_high = THRESH_VESDA_HIGH;
    float humidity_high = THRESH_HUMIDITY_HIGH;
    float conf_alert = 30.0f, conf_prealarm = 55.0f, conf_critical = 75.0f, conf_emergency = 90.0f;
};

class FireClassifier {
public:
    ClassifierState state = {};
    ClassifierThresholds thr;   // live-tunable via runtime config

    // Call every sample cycle with current sensor readings
    ClassifierResult classify(
        float h2_ppm,       // Hydrogen concentration
        float co_ppm,       // Carbon monoxide concentration
        float voc_ppb,      // Volatile organic compounds
        float temp_rate,    // Temperature rate of change (°C/min)
        float vesda_pct,    // VESDA smoke percentage (external or PMS5003)
        float humidity,     // Relative humidity (for steam detection)
        bool  panel_alarm,  // External fire panel input
        bool  discharged,   // Suppression discharged
        float pm1_pm10_ratio = -1.0f, // PMS5003 particle ratio (-1 = no sensor)
        uint8_t particle_hint = 0     // PMS5003 fire type hint
    ) {
        ClassifierResult r = {};

        // ─── Step 1: Normalize each sensor to 0-1 score ───
        r.h2_score    = normalize(h2_ppm, thr.h2_low, thr.h2_high);
        r.co_score    = normalize(co_ppm, thr.co_low, thr.co_high);
        r.voc_score   = normalize(voc_ppb, thr.voc_low, thr.voc_high);
        r.temp_score  = normalize(temp_rate, thr.temprate_low, thr.temprate_high);
        r.vesda_score = normalize(vesda_pct, thr.vesda_low, thr.vesda_high);

        // ─── Step 2: Count active sensors ───
        r.sensors_active = 0;
        if (r.h2_score > 0.1f)    r.sensors_active++;
        if (r.co_score > 0.1f)    r.sensors_active++;
        if (r.voc_score > 0.1f)   r.sensors_active++;
        if (r.temp_score > 0.1f)  r.sensors_active++;
        if (r.vesda_score > 0.1f) r.sensors_active++;
        r.sensors_agreeing = (r.sensors_active >= 2);

        // ─── Step 3: Score each fire type against its signature ───
        float best_score = 0;
        FireType best_type = FIRE_NONE;

        for (int i = 1; i < FIRE_TYPE_COUNT; i++) {
            const FireSignature& sig = SIGNATURES[i];
            float score = 
                r.h2_score    * sig.h2_weight +
                r.co_score    * sig.co_weight +
                r.voc_score   * sig.voc_weight +
                r.temp_score  * sig.temp_rate_weight +
                r.vesda_score * sig.vesda_weight;

            r.match_scores[i] = score * 100.0f;

            if (score > best_score) {
                best_score = score;
                best_type = (FireType)i;
            }
        }

        // ─── Step 4: Calculate raw confidence ───
        float raw_confidence = best_score * 100.0f;

        // ─── Step 4b: PMS5003 particle ratio boost ───
        // If PMS5003 is connected, use particle size ratio to
        // boost or reduce confidence for specific fire types
        if (pm1_pm10_ratio >= 0.0f && vesda_pct > 5.0f) {
            // Smouldering: particles confirm large particle dominance
            if (particle_hint == 1 && (best_type == FIRE_SMOULDERING || best_type == FIRE_NUISANCE)) {
                raw_confidence += 15.0f;
                if (best_type == FIRE_NUISANCE) best_type = FIRE_SMOULDERING;
            }
            // Flaming: particles confirm small particle dominance
            if (particle_hint == 2 && (best_type == FIRE_FLAMING || best_type == FIRE_NUISANCE)) {
                raw_confidence += 15.0f;
                if (best_type == FIRE_NUISANCE) best_type = FIRE_FLAMING;
            }
            // Battery events: particles don't help much (mostly gas)
            // but smoke presence adds an extra sensor vote
            if (particle_hint > 0) r.sensors_active++;
        }

        // ─── Step 5: Apply sensor agreement multiplier ───
        // This is the KEY false-alarm prevention mechanism
        float agreement_mult = 1.0f;
        switch (r.sensors_active) {
            case 0: agreement_mult = 0.0f; break;  // No detection
            case 1: agreement_mult = 0.35f; break;  // Single sensor — cap at 35%
            case 2: agreement_mult = 0.65f; break;  // Two sensors — moderate
            case 3: agreement_mult = 0.85f; break;  // Three sensors — high
            case 4: agreement_mult = 0.95f; break;  // Four sensors — very high
            case 5: agreement_mult = 1.0f; break;   // All sensors — maximum
            default: agreement_mult = 1.0f; break;   // 6+ (incl. particle vote) — maximum
        }
        float confidence = raw_confidence * agreement_mult;

        // ─── Step 6: Apply confidence modifiers ───

        // Sustained detection boosts confidence
        if (best_type == state.prev_type && best_type != FIRE_NONE) {
            state.stable_count++;
            r.sustained_ms = millis() - state.detection_start;
            
            // After 30 seconds of same type: +10%
            if (r.sustained_ms > 30000) confidence += 10.0f;
            // After 60 seconds: +20% and mark as confirmed
            if (r.sustained_ms > 60000) {
                confidence += 20.0f;
                state.confirmed = true;
            }
        } else {
            // Type changed — reset sustained counter
            state.detection_start = millis();
            state.stable_count = 0;
            state.confirmed = false;
        }

        // Humidity spike reduces confidence (steam, not smoke)
        if (humidity > thr.humidity_high && r.vesda_score > 0.3f) {
            confidence *= 0.6f;  // 40% reduction when high humidity + VESDA
        }

        // Panel alarm provides external confirmation
        if (panel_alarm && confidence > 20.0f) {
            confidence = fmaxf(confidence, 75.0f);  // Floor at 75% if panel confirms
        }

        // Suppression discharge = maximum urgency
        if (discharged) {
            confidence = 100.0f;
            best_type = (best_type == FIRE_NONE) ? FIRE_BATTERY_RUNAWAY : best_type;
        }

        // Clamp to 0-100
        confidence = fminf(fmaxf(confidence, 0.0f), 100.0f);

        // ─── Step 7: Determine action level ───
        ActionLevel action;
        if (confidence < thr.conf_alert)          action = ACTION_MONITOR;
        else if (confidence < thr.conf_prealarm)  action = ACTION_ALERT;
        else if (confidence < thr.conf_critical)  action = ACTION_PREALARM;
        else if (confidence < thr.conf_emergency) action = ACTION_CRITICAL;
        else                          action = ACTION_EMERGENCY;

        // Nuisance override: if only 1 sensor and type is nuisance,
        // cap action at ALERT regardless of score
        if (r.sensors_active <= 1 && best_type == FIRE_NUISANCE) {
            if (action > ACTION_ALERT) action = ACTION_ALERT;
        }

        // ─── Step 8: Store result ───
        r.fire_type = (confidence < 10.0f) ? FIRE_NONE : best_type;
        r.confidence = confidence;
        r.action = action;

        state.prev_type = r.fire_type;
        state.prev_confidence = confidence;
        state.result = r;

        return r;
    }

private:
    // Normalize a sensor value to 0-1 range between low and high thresholds
    float normalize(float value, float low, float high) {
        if (value <= 0.0f) return 0.0f;
        if (value <= low)  return 0.0f;
        if (value >= high) return 1.0f;
        return (value - low) / (high - low);
    }
};
