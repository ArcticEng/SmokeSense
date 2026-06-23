/*
 * SmokeSense Gateway — ESP32 Firmware for Existing Fire System Monitoring
 * Arctic Engineering (Rigard) — v1.0.0 — April 2026
 *
 * PRODUCT: SmokeSense Gateway
 * Monitors existing fire detection systems (VESDA, conventional panels,
 * addressable panels) by reading their relay outputs and/or 4-20mA analog
 * loops, then publishes to the same SmokeSense MQTT/Supabase cloud platform.
 *
 * INPUT MODES (select via config.h):
 *   MODE_RELAY    — 4x dry contact relay inputs (zone alarm monitoring)
 *   MODE_ANALOG   — 2x 4-20mA current loop inputs (VESDA smoke level)
 *   MODE_HYBRID   — 2x relay + 1x 4-20mA (most common setup)
 *   MODE_MODBUS   — RS485 Modbus RTU (modern addressable panels)
 *
 * Same MQTT topic structure as SmokeSense Node — dashboard doesn't
 * know or care whether data comes from our sensor or an existing panel.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <FastLED.h>
#include <Preferences.h>
#include "gateway_config.h"

// ═══════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════

char g_device_id[20];
char g_hostname[32];
char TOPIC_TELEMETRY[80], TOPIC_EVENT[80], TOPIC_STATUS[80];
char TOPIC_HEARTBEAT[80], TOPIC_CMD[80], TOPIC_CONFIG[80];

// Zone state — up to 4 monitored zones
struct ZoneState {
    const char* name;         // "Zone 1", "VESDA Loop A", etc.
    uint8_t     gpio;         // input pin
    uint8_t     mode;         // 0=relay, 1=analog_4_20mA
    uint8_t     severity;     // 0-4 mapped from input
    uint8_t     prev_severity;
    bool        is_alarm;
    float       raw_value;    // 0-4095 for ADC, 0/1 for relay
    float       ma_value;     // converted mA (4-20mA mode only)
    float       smoke_pct;    // 0-100% obscuration (4-20mA mode)
} g_zones[MAX_ZONES];

uint8_t g_max_severity = 0;  // highest severity across all zones
bool g_alarm_silenced = false;
unsigned long g_silence_time = 0;
unsigned long g_boot_time = 0;
unsigned long g_last_sample = 0;
unsigned long g_last_heartbeat = 0;
unsigned long g_last_reconnect = 0;
uint32_t g_msg_count = 0;
bool g_wifi_connected = false;
bool g_ap_mode = false;

CRGB leds[NUM_LEDS];
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
WebServer httpServer(80);
Preferences prefs;

static const char* STAGE_NAMES[] = { "clear", "alert", "action", "fire1", "fire2" };

// Forward declarations
void setup_device_identity();
void setup_wifi();
void setup_mqtt();
void setup_ota();
void mqtt_connect();
void mqtt_publish_telemetry();
void mqtt_publish_event(uint8_t zone, uint8_t old_sev, uint8_t new_sev);
void mqtt_publish_heartbeat();
void mqtt_callback(char* topic, byte* payload, unsigned int length);
void read_zones();
void process_zones();
void update_outputs();

// ═══════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=======================================");
    Serial.println("  SmokeSense Gateway v" GW_FIRMWARE_VERSION);
    Serial.println("  Arctic Engineering");
    Serial.println("=======================================");
    g_boot_time = millis();

    // Configure zone inputs
    for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
        g_zones[i].name = ZONE_NAMES[i];
        g_zones[i].gpio = ZONE_PINS[i];
        g_zones[i].mode = ZONE_MODES[i];
        g_zones[i].severity = 0;
        g_zones[i].prev_severity = 0;

        if (g_zones[i].mode == MODE_RELAY_INPUT) {
            pinMode(g_zones[i].gpio, INPUT_PULLUP);
        } else {
            pinMode(g_zones[i].gpio, INPUT);
        }
    }

    // Status LED
    pinMode(PIN_STATUS, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);

    // ADC config (for 4-20mA inputs)
    analogSetAttenuation(ADC_11db);
    analogReadResolution(12);

    // Status LED strip
    FastLED.addLeds<WS2812B, PIN_LEDS, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(LED_BRIGHTNESS);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    // Device identity + networking
    setup_device_identity();
    setup_wifi();
    setup_mqtt();
    setup_ota();

    // Startup sweep
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CRGB(0, 0, 60);
        FastLED.show();
        delay(60);
    }
    delay(200);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    Serial.printf("[BOOT] Ready. %d zones configured.\n", NUM_ACTIVE_ZONES);
    for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
        Serial.printf("[ZONE %d] %s — GPIO %d — %s\n", i,
            g_zones[i].name, g_zones[i].gpio,
            g_zones[i].mode == MODE_RELAY_INPUT ? "RELAY" : "4-20mA");
    }
}

// ═══════════════════════════════════════════════════
//  DEVICE IDENTITY (same as Node firmware)
// ═══════════════════════════════════════════════════

void setup_device_identity() {
#ifdef DEVICE_ID_OVERRIDE
    strncpy(g_device_id, DEVICE_ID_OVERRIDE, sizeof(g_device_id));
#else
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(g_device_id, sizeof(g_device_id), "GW-%02X%02X%02X%02X", mac[2], mac[3], mac[4], mac[5]);
#endif
    snprintf(g_hostname, sizeof(g_hostname), "smokesense-%s", g_device_id);
    snprintf(TOPIC_TELEMETRY, sizeof(TOPIC_TELEMETRY), "smokesense/%s/%s/telemetry", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_EVENT, sizeof(TOPIC_EVENT), "smokesense/%s/%s/event", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_STATUS, sizeof(TOPIC_STATUS), "smokesense/%s/%s/status", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_HEARTBEAT, sizeof(TOPIC_HEARTBEAT), "smokesense/%s/%s/heartbeat", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_CMD, sizeof(TOPIC_CMD), "smokesense/%s/%s/cmd", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_CONFIG, sizeof(TOPIC_CONFIG), "smokesense/%s/%s/config", MQTT_ORG_ID, g_device_id);
    Serial.printf("[ID] Gateway: %s  Org: %s\n", g_device_id, MQTT_ORG_ID);
}

// ═══════════════════════════════════════════════════
//  WIFI (same as Node)
// ═══════════════════════════════════════════════════

void setup_wifi() {
    Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(g_hostname);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500); Serial.print(".");
        digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS));
        if (millis() - start > WIFI_CONNECT_TIMEOUT) {
            Serial.println("\n[WIFI] STA failed - AP fallback");
            WiFi.mode(WIFI_AP_STA);
            char ap_ssid[32];
            snprintf(ap_ssid, sizeof(ap_ssid), "SmokeSense-GW-%s", &g_device_id[strlen(g_device_id) - 4]);
            WiFi.softAP(ap_ssid, AP_PASS);
            g_ap_mode = true;
            return;
        }
    }
    g_wifi_connected = true;
    Serial.printf("\n[WIFI] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
}

// ═══════════════════════════════════════════════════
//  MQTT (same protocol as Node)
// ═══════════════════════════════════════════════════

void setup_mqtt() {
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(mqtt_callback);
    mqtt.setKeepAlive(30);
    mqtt.setBufferSize(1024);
    if (g_wifi_connected) mqtt_connect();
}

void mqtt_connect() {
    if (mqtt.connected()) return;
    if (millis() - g_last_reconnect < 5000) return;
    g_last_reconnect = millis();

    bool connected = (strlen(MQTT_USER) > 0)
        ? mqtt.connect(g_device_id, MQTT_USER, MQTT_PASS, TOPIC_STATUS, 1, true, "{\"status\":\"offline\"}")
        : mqtt.connect(g_device_id, NULL, NULL, TOPIC_STATUS, 1, true, "{\"status\":\"offline\"}");

    if (connected) {
        Serial.println("[MQTT] Connected.");
        JsonDocument doc;
        doc["status"] = "online";
        doc["device"] = g_device_id;
        doc["firmware"] = GW_FIRMWARE_VERSION;
        doc["type"] = "gateway";
        doc["zones"] = NUM_ACTIVE_ZONES;
        doc["ip"] = WiFi.localIP().toString();
        char buf[250];
        serializeJson(doc, buf);
        mqtt.publish(TOPIC_STATUS, buf, true);
        mqtt.subscribe(TOPIC_CMD, 1);
        mqtt.subscribe(TOPIC_CONFIG, 1);
    }
}

void mqtt_callback(char* topic, byte* payload, unsigned int length) {
    if (length > 512) return;
    char msg[513];
    memcpy(msg, payload, length); msg[length] = '\0';
    Serial.printf("[MQTT] CMD: %s\n", msg);

    JsonDocument doc;
    if (deserializeJson(doc, msg)) return;
    const char* cmd = doc["cmd"];
    if (!cmd) return;

    if (strcmp(cmd, "silence") == 0) {
        g_alarm_silenced = true;
        g_silence_time = millis();
        noTone(PIN_BUZZER);
    } else if (strcmp(cmd, "reboot") == 0) {
        delay(500); ESP.restart();
    } else if (strcmp(cmd, "identify") == 0) {
        for (int j = 0; j < 6; j++) {
            fill_solid(leds, NUM_LEDS, (j % 2) ? CRGB::Blue : CRGB::Black);
            FastLED.show(); delay(300);
        }
    }
}

// ═══════════════════════════════════════════════════
//  ZONE READING — relay and 4-20mA inputs
// ═══════════════════════════════════════════════════

void read_zones() {
    for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
        ZoneState& z = g_zones[i];

        if (z.mode == MODE_RELAY_INPUT) {
            // Relay: normally closed = HIGH (pulled up), alarm = LOW (relay opens)
            // Invert if your panel uses normally open relays
            bool pin_state = digitalRead(z.gpio);
            z.is_alarm = RELAY_ACTIVE_LOW ? (pin_state == LOW) : (pin_state == HIGH);
            z.raw_value = z.is_alarm ? 1.0 : 0.0;
            z.ma_value = 0;
            z.smoke_pct = z.is_alarm ? 100.0 : 0.0;
        }
        else if (z.mode == MODE_ANALOG_4_20MA) {
            // 4-20mA through 250Ω shunt = 1.0V - 5.0V
            // ESP32 ADC at 11dB attenuation: 0-3.3V mapped to 0-4095
            // With voltage divider for 5V range, or direct if loop is 4-20mA into 165Ω = 0.66-3.3V
            uint32_t sum = 0;
            for (int s = 0; s < 16; s++) { sum += analogRead(z.gpio); delayMicroseconds(100); }
            z.raw_value = sum / 16.0;

            // Convert ADC to mA: ADC_raw → voltage → current
            // With 165Ω shunt: V = I × 165Ω, so at 4mA → 0.66V, at 20mA → 3.3V
            float voltage = (z.raw_value / 4095.0) * 3.3;
            z.ma_value = voltage / SHUNT_RESISTANCE * 1000.0;  // mA

            // Clamp and convert to percentage (4mA = 0%, 20mA = 100%)
            z.ma_value = constrain(z.ma_value, 4.0, 20.0);
            z.smoke_pct = ((z.ma_value - 4.0) / 16.0) * 100.0;
            z.is_alarm = z.smoke_pct > ANALOG_ALARM_PCT;
        }
    }
}

// ═══════════════════════════════════════════════════
//  ZONE PROCESSING — map to 5-stage severity
// ═══════════════════════════════════════════════════

void process_zones() {
    g_max_severity = 0;

    for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
        ZoneState& z = g_zones[i];
        z.prev_severity = z.severity;

        if (z.mode == MODE_RELAY_INPUT) {
            // Simple: relay open = fire alarm
            z.severity = z.is_alarm ? RELAY_ALARM_SEVERITY : 0;
        }
        else if (z.mode == MODE_ANALOG_4_20MA) {
            // VESDA-style graduated thresholds on smoke percentage
            if      (z.smoke_pct >= ANALOG_FIRE2_PCT)  z.severity = 4;
            else if (z.smoke_pct >= ANALOG_FIRE1_PCT)  z.severity = 3;
            else if (z.smoke_pct >= ANALOG_ACTION_PCT) z.severity = 2;
            else if (z.smoke_pct >= ANALOG_ALERT_PCT)  z.severity = 1;
            else                                        z.severity = 0;
        }

        // Publish event on change
        if (z.severity != z.prev_severity) {
            mqtt_publish_event(i, z.prev_severity, z.severity);
        }

        if (z.severity > g_max_severity) g_max_severity = z.severity;
    }
}

// ═══════════════════════════════════════════════════
//  MQTT PUBLISHING — same format as Node
// ═══════════════════════════════════════════════════

void mqtt_publish_telemetry() {
    if (!mqtt.connected()) return;

    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["fw"] = GW_FIRMWARE_VERSION;
    doc["type"] = "gateway";
    doc["uptime"] = (millis() - g_boot_time) / 1000;
    doc["sev"] = g_max_severity;
    doc["stage"] = STAGE_NAMES[min((int)g_max_severity, 4)];
    doc["smoke"] = g_max_severity >= 1;
    doc["smoulder"] = false;
    doc["mq2_alm"] = false;
    doc["silenced"] = g_alarm_silenced;
    doc["delta"] = 0;  // not applicable for gateway
    doc["ir_blue"] = 0;
    doc["fwd_back"] = 0;

    // Zone details
    JsonArray zones = doc["zones"].to<JsonArray>();
    for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
        JsonObject z = zones.add<JsonObject>();
        z["name"] = g_zones[i].name;
        z["mode"] = g_zones[i].mode == MODE_RELAY_INPUT ? "relay" : "4-20mA";
        z["sev"] = g_zones[i].severity;
        z["alarm"] = g_zones[i].is_alarm;
        z["raw"] = round(g_zones[i].raw_value);
        z["ma"] = round(g_zones[i].ma_value * 10) / 10.0;
        z["smoke_pct"] = round(g_zones[i].smoke_pct * 10) / 10.0;
    }

    // Dummy raw fields for dashboard compatibility
    JsonObject raw = doc["raw"].to<JsonObject>();
    raw["fwd_ir"] = 0;
    raw["fwd_blu"] = 0;
    raw["bck_ir"] = 0;
    raw["bck_blu"] = 0;
    raw["mq2"] = 0;
    raw["temp"] = 0;
    raw["hum"] = 0;

    JsonObject bl = doc["baseline"].to<JsonObject>();
    bl["fwd"] = 0; bl["back"] = 0; bl["mq2"] = 0;

    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();

    char buf[900];
    serializeJson(doc, buf);
    if (mqtt.publish(TOPIC_TELEMETRY, buf, false)) g_msg_count++;
}

void mqtt_publish_event(uint8_t zone, uint8_t old_sev, uint8_t new_sev) {
    if (!mqtt.connected()) return;
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["type"] = new_sev > old_sev ? "escalation" : "de-escalation";
    doc["from_stage"] = STAGE_NAMES[old_sev];
    doc["to_stage"] = STAGE_NAMES[min((int)new_sev, 4)];
    doc["severity"] = new_sev;
    doc["zone"] = g_zones[zone].name;
    doc["zone_idx"] = zone;
    doc["source"] = g_zones[zone].mode == MODE_RELAY_INPUT ? "relay" : "4-20mA";
    doc["smoke_pct"] = g_zones[zone].smoke_pct;
    doc["is_smoke"] = new_sev >= 1;
    doc["delta"] = 0;
    doc["ir_blue"] = 0;
    doc["temp"] = 0;
    doc["hum"] = 0;
    doc["mq2"] = 0;
    char buf[400];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_EVENT, buf, false);
    Serial.printf("[EVENT] Zone %d (%s): %s -> %s\n", zone, g_zones[zone].name,
        STAGE_NAMES[old_sev], STAGE_NAMES[min((int)new_sev, 4)]);
}

void mqtt_publish_heartbeat() {
    if (!mqtt.connected()) return;
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["type"] = "gateway";
    doc["uptime"] = (millis() - g_boot_time) / 1000;
    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();
    doc["msgs"] = g_msg_count;
    doc["sev"] = g_max_severity;
    doc["fw"] = GW_FIRMWARE_VERSION;
    doc["zones"] = NUM_ACTIVE_ZONES;
    char buf[250];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_HEARTBEAT, buf, false);
}

// ═══════════════════════════════════════════════════
//  OUTPUTS — LED bar + buzzer
// ═══════════════════════════════════════════════════

void update_outputs() {
    fill_solid(leds, NUM_LEDS, CRGB::Black);

    // Show per-zone status on LED strip (2 LEDs per zone)
    for (int i = 0; i < min((int)NUM_ACTIVE_ZONES, 4); i++) {
        CRGB color;
        switch (g_zones[i].severity) {
            case 0: color = CRGB(0, 30, 0); break;
            case 1: color = CRGB(80, 80, 0); break;
            case 2: color = CRGB(200, 100, 0); break;
            case 3: color = (millis() / 500) % 2 ? CRGB(255, 0, 0) : CRGB(80, 0, 0); break;
            case 4: color = (millis() / 250) % 2 ? CRGB(255, 0, 0) : CRGB(60, 0, 0); break;
            default: color = CRGB::Black;
        }
        leds[i * 2] = color;
        leds[i * 2 + 1] = color;
    }
    FastLED.show();

    // Buzzer
    if (g_max_severity >= 4 && !g_alarm_silenced) {
        (millis() / 200) % 2 ? tone(PIN_BUZZER, 3000) : noTone(PIN_BUZZER);
    } else if (g_max_severity >= 3 && !g_alarm_silenced) {
        (millis() / 500) % 2 ? tone(PIN_BUZZER, 3000) : noTone(PIN_BUZZER);
    } else {
        noTone(PIN_BUZZER);
    }
}

// ═══════════════════════════════════════════════════
//  OTA
// ═══════════════════════════════════════════════════

void setup_ota() {
    ArduinoOTA.setHostname(g_hostname);
    ArduinoOTA.onStart([]() { noTone(PIN_BUZZER); });
    ArduinoOTA.begin();
}

// ═══════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════

void loop() {
    ArduinoOTA.handle();
    httpServer.handleClient();

    if (g_wifi_connected && !mqtt.connected()) mqtt_connect();
    mqtt.loop();

    // WiFi reconnect
    if (!g_ap_mode && WiFi.status() != WL_CONNECTED) {
        g_wifi_connected = false;
        static unsigned long last_retry = 0;
        if (millis() - last_retry > 30000) {
            last_retry = millis();
            WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS);
        }
    } else if (!g_ap_mode && WiFi.status() == WL_CONNECTED && !g_wifi_connected) {
        g_wifi_connected = true;
    }

    // Un-silence after cooldown
    if (g_alarm_silenced && (millis() - g_silence_time > 30000)) g_alarm_silenced = false;

    // Main loop — read zones, process, publish
    if (millis() - g_last_sample >= POLL_INTERVAL_MS) {
        g_last_sample = millis();
        read_zones();
        process_zones();
        update_outputs();

        // Debug
        for (int i = 0; i < NUM_ACTIVE_ZONES; i++) {
            Serial.printf("[Z%d %6s] sev=%d %s raw=%.0f",
                i, g_zones[i].name, g_zones[i].severity,
                g_zones[i].is_alarm ? "ALARM" : "ok   ",
                g_zones[i].raw_value);
            if (g_zones[i].mode == MODE_ANALOG_4_20MA)
                Serial.printf(" %.1fmA %.1f%%", g_zones[i].ma_value, g_zones[i].smoke_pct);
            Serial.println();
        }

        if (mqtt.connected()) mqtt_publish_telemetry();
        digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS));
    }

    // Heartbeat
    if (millis() - g_last_heartbeat >= 30000) {
        g_last_heartbeat = millis();
        mqtt_publish_heartbeat();
    }
}
