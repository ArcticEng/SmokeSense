/*
 * runtime_config.h — Live-tunable device configuration
 * Arctic Engineering — DataGuard v2.0
 *
 * Holds every parameter the superadmin dashboard can change at runtime:
 * feature toggles, gas alert thresholds, classifier sensitivities, and
 * optical beam sensitivity. Defaults come from the compile-time #defines,
 * are overridden by values stored in NVS, and can be patched live over the
 * MQTT config topic without reflashing.
 *
 * Protocol: the dashboard publishes a JSON object of ONLY the keys it wants
 * to change to smokesense/{org}/{device}/config. The device merges, persists
 * to NVS, applies live, and republishes its full config (retained) to
 * smokesense/{org}/{device}/confstate so the dashboard reflects actual state.
 */

#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "dataguard_config.h"
#include "fire_classifier.h"
#include "chamber_lightsensor.h"   // TSL2591 commodity scatter chamber (drop-in for adpd4101.h)

struct RuntimeConfig {
    // features
    bool  vesda_present, use_adpd, use_pms;
    // gas alert thresholds
    float h2_alert, co_alert, voc_alert;
    float h2_critical, co_critical, h2_emergency, co_emergency;
    float h2_rate_critical, temp_rate_critical;
    // classifier sensitivities
    float thr_h2_low, thr_h2_high, thr_co_low, thr_co_high, thr_voc_low, thr_voc_high;
    float thr_temprate_low, thr_temprate_high, thr_vesda_low, thr_vesda_high, thr_humidity_high;
    // classification confidence -> action cutoffs (%)
    float conf_alert, conf_prealarm, conf_critical, conf_emergency;
    // optical / beam sensitivity
    float adpd_fullscale, adpd_smoke_thresh;
    float irblue_small, irblue_large, fwdback_small, fwdback_large;
    // timing
    uint32_t poll_ms;
};

inline void config_set_defaults(RuntimeConfig& c) {
    c.vesda_present = VESDA_PRESENT; c.use_adpd = USE_ADPD4101; c.use_pms = USE_PMS5003;
    c.h2_alert = H2_ALERT; c.co_alert = CO_ALERT; c.voc_alert = VOC_ALERT;
    c.h2_critical = H2_CRITICAL; c.co_critical = CO_CRITICAL;
    c.h2_emergency = H2_EMERGENCY; c.co_emergency = CO_EMERGENCY;
    c.h2_rate_critical = H2_RATE_CRITICAL; c.temp_rate_critical = TEMP_RATE_CRITICAL;
    c.thr_h2_low = THRESH_H2_LOW; c.thr_h2_high = THRESH_H2_HIGH;
    c.thr_co_low = THRESH_CO_LOW; c.thr_co_high = THRESH_CO_HIGH;
    c.thr_voc_low = THRESH_VOC_LOW; c.thr_voc_high = THRESH_VOC_HIGH;
    c.thr_temprate_low = THRESH_TEMP_RATE_LOW; c.thr_temprate_high = THRESH_TEMP_RATE_HIGH;
    c.thr_vesda_low = THRESH_VESDA_LOW; c.thr_vesda_high = THRESH_VESDA_HIGH;
    c.thr_humidity_high = THRESH_HUMIDITY_HIGH;
    c.conf_alert = 30.0f; c.conf_prealarm = 55.0f; c.conf_critical = 75.0f; c.conf_emergency = 90.0f;
    c.adpd_fullscale = ADPD_SMOKE_FULLSCALE; c.adpd_smoke_thresh = ADPD_SMOKE_THRESH_PCT;
    c.irblue_small = 1.6f; c.irblue_large = 1.0f; c.fwdback_small = 0.9f; c.fwdback_large = 1.5f;
    c.poll_ms = POLL_INTERVAL_MS;
}

// Merge a JSON object of overrides into c (only keys present). Returns true if any changed.
inline bool config_merge_json(RuntimeConfig& c, JsonObjectConst o) {
    bool ch = false;
    #define CFG_B(k, f) if (o[k].is<bool>())                   { c.f = o[k].as<bool>();     ch = true; }
    #define CFG_F(k, f) if (o[k].is<float>() || o[k].is<int>()){ c.f = o[k].as<float>();    ch = true; }
    #define CFG_U(k, f) if (o[k].is<int>())                    { c.f = o[k].as<uint32_t>(); ch = true; }
    CFG_B("vesda_present", vesda_present) CFG_B("use_adpd", use_adpd) CFG_B("use_pms", use_pms)
    CFG_F("h2_alert", h2_alert) CFG_F("co_alert", co_alert) CFG_F("voc_alert", voc_alert)
    CFG_F("h2_critical", h2_critical) CFG_F("co_critical", co_critical)
    CFG_F("h2_emergency", h2_emergency) CFG_F("co_emergency", co_emergency)
    CFG_F("h2_rate_critical", h2_rate_critical) CFG_F("temp_rate_critical", temp_rate_critical)
    CFG_F("thr_h2_low", thr_h2_low) CFG_F("thr_h2_high", thr_h2_high)
    CFG_F("thr_co_low", thr_co_low) CFG_F("thr_co_high", thr_co_high)
    CFG_F("thr_voc_low", thr_voc_low) CFG_F("thr_voc_high", thr_voc_high)
    CFG_F("thr_temprate_low", thr_temprate_low) CFG_F("thr_temprate_high", thr_temprate_high)
    CFG_F("thr_vesda_low", thr_vesda_low) CFG_F("thr_vesda_high", thr_vesda_high)
    CFG_F("thr_humidity_high", thr_humidity_high)
    CFG_F("conf_alert", conf_alert) CFG_F("conf_prealarm", conf_prealarm)
    CFG_F("conf_critical", conf_critical) CFG_F("conf_emergency", conf_emergency)
    CFG_F("adpd_fullscale", adpd_fullscale) CFG_F("adpd_smoke_thresh", adpd_smoke_thresh)
    CFG_F("irblue_small", irblue_small) CFG_F("irblue_large", irblue_large)
    CFG_F("fwdback_small", fwdback_small) CFG_F("fwdback_large", fwdback_large)
    CFG_U("poll_ms", poll_ms)
    #undef CFG_B
    #undef CFG_F
    #undef CFG_U
    return ch;
}

inline void config_to_json(const RuntimeConfig& c, JsonObject o) {
    o["vesda_present"] = c.vesda_present; o["use_adpd"] = c.use_adpd; o["use_pms"] = c.use_pms;
    o["h2_alert"] = c.h2_alert; o["co_alert"] = c.co_alert; o["voc_alert"] = c.voc_alert;
    o["h2_critical"] = c.h2_critical; o["co_critical"] = c.co_critical;
    o["h2_emergency"] = c.h2_emergency; o["co_emergency"] = c.co_emergency;
    o["h2_rate_critical"] = c.h2_rate_critical; o["temp_rate_critical"] = c.temp_rate_critical;
    o["thr_h2_low"] = c.thr_h2_low; o["thr_h2_high"] = c.thr_h2_high;
    o["thr_co_low"] = c.thr_co_low; o["thr_co_high"] = c.thr_co_high;
    o["thr_voc_low"] = c.thr_voc_low; o["thr_voc_high"] = c.thr_voc_high;
    o["thr_temprate_low"] = c.thr_temprate_low; o["thr_temprate_high"] = c.thr_temprate_high;
    o["thr_vesda_low"] = c.thr_vesda_low; o["thr_vesda_high"] = c.thr_vesda_high;
    o["thr_humidity_high"] = c.thr_humidity_high;
    o["conf_alert"] = c.conf_alert; o["conf_prealarm"] = c.conf_prealarm;
    o["conf_critical"] = c.conf_critical; o["conf_emergency"] = c.conf_emergency;
    o["adpd_fullscale"] = c.adpd_fullscale; o["adpd_smoke_thresh"] = c.adpd_smoke_thresh;
    o["irblue_small"] = c.irblue_small; o["irblue_large"] = c.irblue_large;
    o["fwdback_small"] = c.fwdback_small; o["fwdback_large"] = c.fwdback_large;
    o["poll_ms"] = c.poll_ms;
}

// NVS persistence — stored as a single JSON blob under namespace "dgcfg".
inline void config_save(const RuntimeConfig& c) {
    JsonDocument d; config_to_json(c, d.to<JsonObject>());
    char buf[1024]; serializeJson(d, buf, sizeof(buf));
    Preferences p; p.begin("dgcfg", false); p.putString("json", buf); p.end();
}

inline void config_load(RuntimeConfig& c) {
    config_set_defaults(c);
    Preferences p; p.begin("dgcfg", true);
    String s = p.getString("json", "");
    p.end();
    if (s.length() > 0) {
        JsonDocument d;
        if (!deserializeJson(d, s)) config_merge_json(c, d.as<JsonObjectConst>());
    }
}
