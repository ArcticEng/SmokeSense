/*
 * SmokeSense — ESP32 Firmware with MQTT Cloud Integration
 * Arctic Engineering (Rigard) — v1.3.0 — April 2026
 * Board: ESP32 DevKit (30/38 pin) — Framework: Arduino via PlatformIO
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <FastLED.h>
#include <DHT.h>
#include <Preferences.h>
#include "config.h"

char g_device_id[20];
char g_hostname[32];
char TOPIC_TELEMETRY[80], TOPIC_EVENT[80], TOPIC_STATUS[80];
char TOPIC_HEARTBEAT[80], TOPIC_CMD[80], TOPIC_CONFIG[80], TOPIC_BROADCAST[80];

struct SensorData {
    uint16_t pd_fwd_ir, pd_fwd_blue, pd_back_ir, pd_back_blue, mq2;
    float temperature, humidity;
} g_sensor = {};

struct DetectionResult {
    float scatter_delta, ir_blue_ratio, fwd_back_ratio;
    uint8_t severity, prev_severity;
    bool is_smoke, is_smouldering, mq2_alarm;
    const char* stage_name;
} g_result = {};

struct Baseline {
    float pd_fwd_ir, pd_back_ir, mq2;
    unsigned long last_update;
    uint32_t sample_count;
    float acc_fwd, acc_back, acc_mq2;
} g_baseline = {};

struct Thresholds {
    uint16_t alert, action, fire1, fire2, mq2;
} g_thresh = { THRESH_ALERT, THRESH_ACTION, THRESH_FIRE1, THRESH_FIRE2, THRESH_MQ2 };

bool g_alarm_silenced = false;
unsigned long g_silence_time = 0;
unsigned long g_last_telemetry = 0, g_last_heartbeat = 0, g_last_sample = 0, g_last_reconnect = 0;
uint32_t g_msg_count = 0;
unsigned long g_boot_time = 0;
bool g_wifi_connected = false, g_ap_mode = false;

CRGB leds[NUM_LEDS];
DHT dht(PIN_DHT, DHT11);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
WebServer httpServer(80);
Preferences prefs;

static const char* STAGE_NAMES[] = { "clear", "alert", "action", "fire1", "fire2" };
static const char* STAGE_LABELS[] = { "Clear", "Alert", "Action", "Fire 1", "Fire 2" };

void setup_device_identity();
void setup_wifi();
void setup_mqtt();
void setup_ota();
void setup_http();
void read_sensors();
void process_detection();
void update_outputs();
void update_baseline();
void mqtt_connect();
void mqtt_publish_telemetry();
void mqtt_publish_event(uint8_t old_sev, uint8_t new_sev);
void mqtt_publish_heartbeat();
void mqtt_callback(char* topic, byte* payload, unsigned int length);
void mqtt_handle_command(JsonDocument& doc);
void mqtt_handle_config(JsonDocument& doc);
void self_test();
void warmup_and_calibrate();
uint16_t read_adc_oversampled(uint8_t pin);
void handle_http_root();
void handle_http_api_status();
void print_debug();

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=======================================");
    Serial.println("  SmokeSense v" FIRMWARE_VERSION);
    Serial.println("  Arctic Engineering");
    Serial.println("=======================================");
    g_boot_time = millis();

    pinMode(PIN_LED_IR, OUTPUT);
    pinMode(PIN_LED_BLUE, OUTPUT);
    pinMode(PIN_PD_FWD, INPUT);
    pinMode(PIN_PD_BACK, INPUT);
    pinMode(PIN_MQ2, INPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_BUTTON, INPUT_PULLUP);
    pinMode(PIN_STATUS, OUTPUT);
    digitalWrite(PIN_LED_IR, LOW);
    digitalWrite(PIN_LED_BLUE, LOW);
    digitalWrite(PIN_BUZZER, LOW);

    analogSetAttenuation(ADC_11db);
    analogReadResolution(12);

    FastLED.addLeds<WS2812B, PIN_LEDS, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(LED_BRIGHTNESS);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    dht.begin();
    setup_device_identity();

    prefs.begin("smoke", true);
    g_baseline.pd_fwd_ir = prefs.getFloat("bl_fwd", 0);
    g_baseline.pd_back_ir = prefs.getFloat("bl_back", 0);
    g_baseline.mq2 = prefs.getFloat("bl_mq2", 0);
    prefs.end();

    if (g_baseline.pd_fwd_ir == 0) warmup_and_calibrate();

    setup_wifi();
    setup_mqtt();
    setup_ota();
    setup_http();

    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CRGB::Green;
        FastLED.show();
        delay(60);
    }
    delay(200);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    Serial.println("[BOOT] Ready.");
    Serial.printf("[BOOT] Device: %s\n", g_device_id);
    Serial.printf("[BOOT] Baseline: fwd=%.0f back=%.0f mq2=%.0f\n",
                  g_baseline.pd_fwd_ir, g_baseline.pd_back_ir, g_baseline.mq2);
}

void setup_device_identity() {
#ifdef DEVICE_ID_OVERRIDE
    strncpy(g_device_id, DEVICE_ID_OVERRIDE, sizeof(g_device_id));
#else
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(g_device_id, sizeof(g_device_id), "SS-%02X%02X%02X%02X", mac[2], mac[3], mac[4], mac[5]);
#endif
    snprintf(g_hostname, sizeof(g_hostname), "%s%s", OTA_HOSTNAME_PREFIX, g_device_id);
    snprintf(TOPIC_TELEMETRY, sizeof(TOPIC_TELEMETRY), "smokesense/%s/%s/telemetry", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_EVENT, sizeof(TOPIC_EVENT), "smokesense/%s/%s/event", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_STATUS, sizeof(TOPIC_STATUS), "smokesense/%s/%s/status", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_HEARTBEAT, sizeof(TOPIC_HEARTBEAT), "smokesense/%s/%s/heartbeat", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_CMD, sizeof(TOPIC_CMD), "smokesense/%s/%s/cmd", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_CONFIG, sizeof(TOPIC_CONFIG), "smokesense/%s/%s/config", MQTT_ORG_ID, g_device_id);
    snprintf(TOPIC_BROADCAST, sizeof(TOPIC_BROADCAST), "smokesense/%s/broadcast/cmd", MQTT_ORG_ID);
    Serial.printf("[ID] Device: %s  Org: %s\n", g_device_id, MQTT_ORG_ID);
}

void setup_wifi() {
    Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(g_hostname);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS));
        if (millis() - start > WIFI_CONNECT_TIMEOUT) {
            Serial.println("\n[WIFI] STA failed - starting AP fallback");
            WiFi.mode(WIFI_AP_STA);
            char ap_ssid[32];
            snprintf(ap_ssid, sizeof(ap_ssid), "%s%s", AP_SSID_PREFIX, &g_device_id[strlen(g_device_id) - 4]);
            WiFi.softAP(ap_ssid, AP_PASS);
            Serial.printf("[WIFI] AP: %s @ %s\n", ap_ssid, WiFi.softAPIP().toString().c_str());
            g_ap_mode = true;
            return;
        }
    }
    g_wifi_connected = true;
    Serial.printf("\n[WIFI] Connected. IP: %s  RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

void setup_mqtt() {
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(mqtt_callback);
    mqtt.setKeepAlive(MQTT_KEEPALIVE);
    mqtt.setBufferSize(1024);
    if (g_wifi_connected) mqtt_connect();
}

void mqtt_connect() {
    if (mqtt.connected()) return;
    if (millis() - g_last_reconnect < 5000) return;
    g_last_reconnect = millis();
    Serial.printf("[MQTT] Connecting to %s:%d as %s...\n", MQTT_HOST, MQTT_PORT, g_device_id);

    bool connected;
    if (strlen(MQTT_USER) > 0) {
        connected = mqtt.connect(g_device_id, MQTT_USER, MQTT_PASS, TOPIC_STATUS, MQTT_QOS_EVENTS, true, "{\"status\":\"offline\"}");
    } else {
        connected = mqtt.connect(g_device_id, NULL, NULL, TOPIC_STATUS, MQTT_QOS_EVENTS, true, "{\"status\":\"offline\"}");
    }

    if (connected) {
        Serial.println("[MQTT] Connected.");
        JsonDocument statusDoc;
        statusDoc["status"] = "online";
        statusDoc["device"] = g_device_id;
        statusDoc["firmware"] = FIRMWARE_VERSION;
        statusDoc["ip"] = WiFi.localIP().toString();
        statusDoc["rssi"] = WiFi.RSSI();
        char statusBuf[200];
        serializeJson(statusDoc, statusBuf);
        mqtt.publish(TOPIC_STATUS, statusBuf, true);
        mqtt.subscribe(TOPIC_CMD, MQTT_QOS_COMMANDS);
        mqtt.subscribe(TOPIC_CONFIG, MQTT_QOS_COMMANDS);
        mqtt.subscribe(TOPIC_BROADCAST, MQTT_QOS_COMMANDS);
        Serial.printf("[MQTT] Subscribed: %s\n", TOPIC_CMD);
        Serial.printf("[MQTT] Subscribed: %s\n", TOPIC_CONFIG);
        Serial.printf("[MQTT] Subscribed: %s\n", TOPIC_BROADCAST);
    } else {
        Serial.printf("[MQTT] Failed, rc=%d. Retry in 5s.\n", mqtt.state());
    }
}

void mqtt_publish_telemetry() {
    if (!mqtt.connected()) return;
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["fw"] = FIRMWARE_VERSION;
    doc["uptime"] = (millis() - g_boot_time) / 1000;
    doc["sev"] = g_result.severity;
    doc["stage"] = g_result.stage_name;
    doc["smoke"] = g_result.is_smoke;
    doc["smoulder"] = g_result.is_smouldering;
    doc["mq2_alm"] = g_result.mq2_alarm;
    doc["silenced"] = g_alarm_silenced;
    doc["delta"] = round(g_result.scatter_delta);
    doc["ir_blue"] = round(g_result.ir_blue_ratio * 100) / 100.0;
    doc["fwd_back"] = round(g_result.fwd_back_ratio * 100) / 100.0;
    JsonObject raw = doc["raw"].to<JsonObject>();
    raw["fwd_ir"] = g_sensor.pd_fwd_ir;
    raw["fwd_blu"] = g_sensor.pd_fwd_blue;
    raw["bck_ir"] = g_sensor.pd_back_ir;
    raw["bck_blu"] = g_sensor.pd_back_blue;
    raw["mq2"] = g_sensor.mq2;
    raw["temp"] = round(g_sensor.temperature * 10) / 10.0;
    raw["hum"] = round(g_sensor.humidity);
    JsonObject bl = doc["baseline"].to<JsonObject>();
    bl["fwd"] = round(g_baseline.pd_fwd_ir);
    bl["back"] = round(g_baseline.pd_back_ir);
    bl["mq2"] = round(g_baseline.mq2);
    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();
    char buf[700];
    serializeJson(doc, buf);
    if (mqtt.publish(TOPIC_TELEMETRY, buf, false)) g_msg_count++;
}

void mqtt_publish_event(uint8_t old_sev, uint8_t new_sev) {
    if (!mqtt.connected()) return;
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["type"] = new_sev > old_sev ? "escalation" : "de-escalation";
    doc["from_stage"] = STAGE_NAMES[old_sev];
    doc["to_stage"] = STAGE_NAMES[min((int)new_sev, 4)];
    doc["severity"] = new_sev;
    doc["delta"] = round(g_result.scatter_delta);
    doc["ir_blue"] = round(g_result.ir_blue_ratio * 100) / 100.0;
    doc["is_smoke"] = g_result.is_smoke;
    doc["temp"] = round(g_sensor.temperature * 10) / 10.0;
    doc["hum"] = round(g_sensor.humidity);
    doc["mq2"] = g_sensor.mq2;
    char buf[400];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_EVENT, buf, false);
    Serial.printf("[EVENT] %s -> %s (delta=%.0f)\n", STAGE_NAMES[old_sev], STAGE_NAMES[min((int)new_sev, 4)], g_result.scatter_delta);
}

void mqtt_publish_heartbeat() {
    if (!mqtt.connected()) return;
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["ts"] = millis();
    doc["uptime"] = (millis() - g_boot_time) / 1000;
    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();
    doc["msgs"] = g_msg_count;
    doc["sev"] = g_result.severity;
    doc["fw"] = FIRMWARE_VERSION;
    char buf[200];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_HEARTBEAT, buf, false);
}

void mqtt_callback(char* topic, byte* payload, unsigned int length) {
    if (length > 512) return;
    char msg[513];
    memcpy(msg, payload, length);
    msg[length] = '\0';
    Serial.printf("[MQTT] Received on %s: %s\n", topic, msg);
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, msg);
    if (err) { Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str()); return; }
    if (strstr(topic, "/cmd")) mqtt_handle_command(doc);
    else if (strstr(topic, "/config")) mqtt_handle_config(doc);
}

void mqtt_handle_command(JsonDocument& doc) {
    const char* cmd = doc["cmd"];
    if (!cmd) return;
    if (strcmp(cmd, "silence") == 0) {
        g_alarm_silenced = true;
        g_silence_time = millis();
        noTone(PIN_BUZZER);
        Serial.println("[CMD] Alarm silenced remotely.");
        mqtt.publish(TOPIC_EVENT, "{\"type\":\"cmd_ack\",\"cmd\":\"silence\",\"result\":\"ok\"}", false);
    } else if (strcmp(cmd, "test") == 0) {
        Serial.println("[CMD] Remote self-test triggered.");
        self_test();
        mqtt.publish(TOPIC_EVENT, "{\"type\":\"cmd_ack\",\"cmd\":\"test\",\"result\":\"ok\"}", false);
    } else if (strcmp(cmd, "recalibrate") == 0) {
        Serial.println("[CMD] Remote recalibration triggered.");
        warmup_and_calibrate();
        char ack[150];
        snprintf(ack, sizeof(ack), "{\"type\":\"cmd_ack\",\"cmd\":\"recalibrate\",\"baseline_fwd\":%.0f,\"baseline_back\":%.0f,\"baseline_mq2\":%.0f}",
            g_baseline.pd_fwd_ir, g_baseline.pd_back_ir, g_baseline.mq2);
        mqtt.publish(TOPIC_EVENT, ack, false);
    } else if (strcmp(cmd, "reboot") == 0) {
        Serial.println("[CMD] Remote reboot requested.");
        mqtt.publish(TOPIC_EVENT, "{\"type\":\"cmd_ack\",\"cmd\":\"reboot\",\"result\":\"rebooting\"}", false);
        delay(500);
        ESP.restart();
    } else if (strcmp(cmd, "identify") == 0) {
        Serial.println("[CMD] Identify - flashing LEDs.");
        for (int j = 0; j < 6; j++) {
            fill_solid(leds, NUM_LEDS, (j % 2) ? CRGB::Blue : CRGB::Black);
            FastLED.show();
            delay(300);
        }
        fill_solid(leds, NUM_LEDS, CRGB::Black);
        FastLED.show();
    } else {
        Serial.printf("[CMD] Unknown command: %s\n", cmd);
    }
}

void mqtt_handle_config(JsonDocument& doc) {
    bool changed = false;
    if (doc.containsKey("alert"))  { g_thresh.alert = doc["alert"]; changed = true; }
    if (doc.containsKey("action")) { g_thresh.action = doc["action"]; changed = true; }
    if (doc.containsKey("fire1"))  { g_thresh.fire1 = doc["fire1"]; changed = true; }
    if (doc.containsKey("fire2"))  { g_thresh.fire2 = doc["fire2"]; changed = true; }
    if (doc.containsKey("mq2"))    { g_thresh.mq2 = doc["mq2"]; changed = true; }
    if (changed) {
        Serial.printf("[CONFIG] Thresholds updated: alert=%d action=%d fire1=%d fire2=%d mq2=%d\n",
                      g_thresh.alert, g_thresh.action, g_thresh.fire1, g_thresh.fire2, g_thresh.mq2);
        prefs.begin("smoke", false);
        prefs.putUShort("t_alert", g_thresh.alert);
        prefs.putUShort("t_action", g_thresh.action);
        prefs.putUShort("t_fire1", g_thresh.fire1);
        prefs.putUShort("t_fire2", g_thresh.fire2);
        prefs.putUShort("t_mq2", g_thresh.mq2);
        prefs.end();
        mqtt.publish(TOPIC_EVENT, "{\"type\":\"config_ack\",\"result\":\"thresholds_updated\"}", false);
    }
}

void setup_ota() {
    ArduinoOTA.setHostname(g_hostname);
    ArduinoOTA.onStart([]() { Serial.println("[OTA] Update starting..."); fill_solid(leds, NUM_LEDS, CRGB(0,0,40)); FastLED.show(); noTone(PIN_BUZZER); });
    ArduinoOTA.onEnd([]() { Serial.println("\n[OTA] Complete. Rebooting."); fill_solid(leds, NUM_LEDS, CRGB(0,40,0)); FastLED.show(); });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        int pct = progress / (total / 100); int lit = pct * NUM_LEDS / 100;
        fill_solid(leds, NUM_LEDS, CRGB::Black); for (int i = 0; i < lit; i++) leds[i] = CRGB(0,0,80); FastLED.show();
    });
    ArduinoOTA.onError([](ota_error_t error) { Serial.printf("[OTA] Error[%u]\n", error); fill_solid(leds, NUM_LEDS, CRGB(60,0,0)); FastLED.show(); });
    ArduinoOTA.begin();
    Serial.printf("[OTA] Hostname: %s\n", g_hostname);
}

void setup_http() {
    httpServer.on("/", handle_http_root);
    httpServer.on("/api/status", handle_http_api_status);
    httpServer.begin();
    Serial.println("[HTTP] Server started on port 80");
}

void handle_http_root() {
    String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>SmokeSense - " + String(g_device_id) + "</title>"
        "<style>body{font-family:system-ui;background:#0f1117;color:#e4e4e7;padding:16px}"
        ".c{background:#1c1e26;border-radius:12px;padding:16px;margin:8px 0;border:1px solid #2a2d38}"
        ".v{font-size:24px;font-weight:600}.l{font-size:12px;color:#71717a}"
        ".g{display:grid;grid-template-columns:1fr 1fr;gap:8px}</style></head><body>"
        "<h2>SmokeSense " + String(g_device_id) + "</h2>"
        "<div class='c' id='status'>Loading...</div>"
        "<div class='g'>"
        "<div class='c'><div class='l'>Scatter delta</div><div class='v' id='delta'>-</div></div>"
        "<div class='c'><div class='l'>Severity</div><div class='v' id='sev'>-</div></div>"
        "<div class='c'><div class='l'>Temperature</div><div class='v' id='temp'>-</div></div>"
        "<div class='c'><div class='l'>Humidity</div><div class='v' id='hum'>-</div></div>"
        "<div class='c'><div class='l'>MQ-2</div><div class='v' id='mq2'>-</div></div>"
        "<div class='c'><div class='l'>MQTT</div><div class='v' id='mqtt'>-</div></div>"
        "</div>"
        "<div style='font-size:11px;color:#52525b;margin-top:12px'>"
        "FW: " FIRMWARE_VERSION " | MQTT: " MQTT_HOST "</div>"
        "<script>setInterval(()=>fetch('/api/status').then(r=>r.json()).then(d=>{"
        "document.getElementById('delta').textContent=Math.round(d.delta);"
        "document.getElementById('sev').textContent=d.stage;"
        "document.getElementById('temp').textContent=d.temp.toFixed(1)+'C';"
        "document.getElementById('hum').textContent=Math.round(d.hum)+'%';"
        "document.getElementById('mq2').textContent=d.mq2;"
        "document.getElementById('mqtt').textContent=d.mqtt_connected?'Connected':'Disconnected';"
        "document.getElementById('status').textContent=d.stage+' - '+d.stage_label;"
        "}).catch(()=>{}),2000)</script></body></html>";
    httpServer.send(200, "text/html", html);
}

void handle_http_api_status() {
    JsonDocument doc;
    doc["dev"] = g_device_id;
    doc["delta"] = g_result.scatter_delta;
    doc["severity"] = g_result.severity;
    doc["stage"] = g_result.stage_name;
    doc["stage_label"] = STAGE_LABELS[min((int)g_result.severity, 4)];
    doc["smoke"] = g_result.is_smoke;
    doc["ir_blue"] = g_result.ir_blue_ratio;
    doc["fwd_back"] = g_result.fwd_back_ratio;
    doc["mq2"] = g_sensor.mq2;
    doc["temp"] = g_sensor.temperature;
    doc["hum"] = g_sensor.humidity;
    doc["mqtt_connected"] = mqtt.connected();
    doc["rssi"] = WiFi.RSSI();
    doc["uptime"] = (millis() - g_boot_time) / 1000;
    doc["msgs"] = g_msg_count;
    char buf[400];
    serializeJson(doc, buf);
    httpServer.send(200, "application/json", buf);
}

uint16_t read_adc_oversampled(uint8_t pin) {
    uint32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) { sum += analogRead(pin); delayMicroseconds(50); }
    return sum / ADC_SAMPLES;
}

void read_sensors() {
    uint16_t amb_fwd = read_adc_oversampled(PIN_PD_FWD);
    uint16_t amb_back = read_adc_oversampled(PIN_PD_BACK);
    digitalWrite(PIN_LED_IR, HIGH);
    delayMicroseconds(PULSE_DURATION_US);
    g_sensor.pd_fwd_ir = read_adc_oversampled(PIN_PD_FWD) - amb_fwd;
    g_sensor.pd_back_ir = read_adc_oversampled(PIN_PD_BACK) - amb_back;
    digitalWrite(PIN_LED_IR, LOW);
    delay(2);
    digitalWrite(PIN_LED_BLUE, HIGH);
    delayMicroseconds(PULSE_DURATION_US);
    g_sensor.pd_fwd_blue = read_adc_oversampled(PIN_PD_FWD) - amb_fwd;
    g_sensor.pd_back_blue = read_adc_oversampled(PIN_PD_BACK) - amb_back;
    digitalWrite(PIN_LED_BLUE, LOW);
    g_sensor.mq2 = read_adc_oversampled(PIN_MQ2);
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) g_sensor.temperature = t;
    if (!isnan(h)) g_sensor.humidity = h;
}

void process_detection() {
    g_result.prev_severity = g_result.severity;
    float delta_fwd = max(0.0f, (float)g_sensor.pd_fwd_ir - g_baseline.pd_fwd_ir);
    float delta_back = max(0.0f, (float)g_sensor.pd_back_ir - g_baseline.pd_back_ir);
    g_result.scatter_delta = delta_fwd;
    g_result.ir_blue_ratio = (g_sensor.pd_fwd_blue > 10) ? (float)g_sensor.pd_fwd_ir / (float)g_sensor.pd_fwd_blue : 99.0f;
    g_result.is_smoke = (g_result.ir_blue_ratio >= RATIO_SMOKE_MIN);
    g_result.fwd_back_ratio = (delta_back > 5) ? delta_fwd / delta_back : (delta_fwd > 10 ? 10.0f : 1.0f);
    g_result.is_smouldering = (g_result.fwd_back_ratio > FB_SMOULDER_MIN);
    float mult = (g_sensor.humidity > HUMIDITY_THRESHOLD) ? HUMIDITY_FACTOR : 1.0f;
    float t_alert = g_thresh.alert * mult;
    float t_action = g_thresh.action * mult;
    float t_fire1 = g_thresh.fire1 * mult;
    float t_fire2 = g_thresh.fire2 * mult;
    if (g_result.scatter_delta >= t_fire2 && g_result.is_smoke) g_result.severity = 4;
    else if (g_result.scatter_delta >= t_fire1 && g_result.is_smoke) g_result.severity = 3;
    else if (g_result.scatter_delta >= t_action && g_result.is_smoke) g_result.severity = 2;
    else if (g_result.scatter_delta >= t_alert) g_result.severity = 1;
    else g_result.severity = 0;
    float mq2_delta = (float)g_sensor.mq2 - g_baseline.mq2;
    g_result.mq2_alarm = (mq2_delta > g_thresh.mq2);
    if (g_result.mq2_alarm && g_result.severity < 3) g_result.severity = 3;
    g_result.stage_name = STAGE_NAMES[min((int)g_result.severity, 4)];
    if (g_result.severity != g_result.prev_severity) mqtt_publish_event(g_result.prev_severity, g_result.severity);
}

void update_outputs() {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    switch (g_result.severity) {
        case 0: leds[0] = CRGB(0,30,0); break;
        case 1: leds[0]=leds[1]=CRGB(0,80,0); leds[2]=leds[3]=CRGB(80,80,0); break;
        case 2: for(int i=0;i<3;i++) leds[i]=CRGB(0,100,0); leds[3]=leds[4]=CRGB(120,120,0); leds[5]=CRGB(200,100,0); break;
        case 3: { bool fl=(millis()/500)%2; leds[0]=CRGB(0,120,0); leds[1]=CRGB(80,120,0); leds[2]=leds[3]=CRGB(180,180,0); leds[4]=leds[5]=CRGB(220,100,0); leds[6]=leds[7]=fl?CRGB(255,0,0):CRGB(80,0,0); } break;
        case 4: { bool fl=(millis()/250)%2; CRGB c=fl?CRGB(255,0,0):CRGB(60,0,0); fill_solid(leds,NUM_LEDS,c);
            if(fl){leds[0]=CRGB(0,200,0);leds[1]=CRGB(80,200,0);leds[2]=CRGB(180,180,0);leds[3]=CRGB(220,120,0);leds[4]=CRGB(255,80,0);leds[5]=CRGB(255,40,0);leds[6]=leds[7]=CRGB(255,0,0);} } break;
    }
    FastLED.show();
    if (g_result.severity >= 4 && !g_alarm_silenced) { (millis()/200)%2 ? tone(PIN_BUZZER,BUZZER_FREQ_ALARM) : noTone(PIN_BUZZER); }
    else if (g_result.severity == 3 && !g_alarm_silenced) { (millis()/500)%2 ? tone(PIN_BUZZER,BUZZER_FREQ_ALARM) : noTone(PIN_BUZZER); }
    else if (g_result.severity == 2) { if((millis()/3000)%2==0 && (millis()%3000)<100) tone(PIN_BUZZER,BUZZER_FREQ_WARN,100); }
    else { noTone(PIN_BUZZER); }
}

void update_baseline() {
    if (g_result.severity > 0) return;
    g_baseline.acc_fwd += g_sensor.pd_fwd_ir;
    g_baseline.acc_back += g_sensor.pd_back_ir;
    g_baseline.acc_mq2 += g_sensor.mq2;
    g_baseline.sample_count++;
    if (millis() - g_baseline.last_update > DRIFT_WINDOW) {
        if (g_baseline.sample_count > 10) {
            g_baseline.pd_fwd_ir = g_baseline.acc_fwd / g_baseline.sample_count;
            g_baseline.pd_back_ir = g_baseline.acc_back / g_baseline.sample_count;
            g_baseline.mq2 = g_baseline.acc_mq2 / g_baseline.sample_count;
        }
        g_baseline.acc_fwd = g_baseline.acc_back = g_baseline.acc_mq2 = 0;
        g_baseline.sample_count = 0;
        g_baseline.last_update = millis();
        prefs.begin("smoke", false);
        prefs.putFloat("bl_fwd", g_baseline.pd_fwd_ir);
        prefs.putFloat("bl_back", g_baseline.pd_back_ir);
        prefs.putFloat("bl_mq2", g_baseline.mq2);
        prefs.end();
        Serial.printf("[DRIFT] Baseline updated: fwd=%.0f back=%.0f mq2=%.0f\n", g_baseline.pd_fwd_ir, g_baseline.pd_back_ir, g_baseline.mq2);
    }
}

void warmup_and_calibrate() {
    Serial.println("[CAL] Warming up MQ-2 (60s)...");
    for (int i = 0; i < 30; i++) { delay(2000); Serial.print("."); digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS)); }
    Serial.println();
    float s_fwd=0, s_back=0, s_mq2=0; int n=20;
    for (int i = 0; i < n; i++) {
        digitalWrite(PIN_LED_IR, HIGH); delayMicroseconds(PULSE_DURATION_US);
        s_fwd += read_adc_oversampled(PIN_PD_FWD); s_back += read_adc_oversampled(PIN_PD_BACK);
        digitalWrite(PIN_LED_IR, LOW); s_mq2 += read_adc_oversampled(PIN_MQ2); delay(200);
    }
    g_baseline.pd_fwd_ir = s_fwd/n; g_baseline.pd_back_ir = s_back/n; g_baseline.mq2 = s_mq2/n;
    g_baseline.last_update = millis();
    prefs.begin("smoke", false);
    prefs.putFloat("bl_fwd", g_baseline.pd_fwd_ir);
    prefs.putFloat("bl_back", g_baseline.pd_back_ir);
    prefs.putFloat("bl_mq2", g_baseline.mq2);
    prefs.end();
    Serial.printf("[CAL] Done. fwd=%.0f back=%.0f mq2=%.0f\n", g_baseline.pd_fwd_ir, g_baseline.pd_back_ir, g_baseline.mq2);
}

void self_test() {
    Serial.println("[TEST] Running...");
    for (int i = 0; i < NUM_LEDS; i++) { fill_solid(leds,NUM_LEDS,CRGB::Black); leds[i]=CRGB::Blue; FastLED.show(); delay(80); }
    tone(PIN_BUZZER,2500,150); delay(200); tone(PIN_BUZZER,3000,150); delay(200);
    read_sensors();
    bool ir_ok=g_sensor.pd_fwd_ir>5, blue_ok=g_sensor.pd_fwd_blue>5, mq2_ok=g_sensor.mq2>50;
    bool dht_ok=!isnan(g_sensor.temperature), wifi_ok=WiFi.status()==WL_CONNECTED, mqtt_ok=mqtt.connected();
    Serial.printf("[TEST] IR:%s Blue:%s MQ2:%s DHT:%s WiFi:%s MQTT:%s\n",
        ir_ok?"OK":"FAIL", blue_ok?"OK":"FAIL", mq2_ok?"OK":"FAIL", dht_ok?"OK":"FAIL", wifi_ok?"OK":"FAIL", mqtt_ok?"OK":"FAIL");
    bool all_ok = ir_ok && blue_ok && mq2_ok && dht_ok && wifi_ok && mqtt_ok;
    fill_solid(leds, NUM_LEDS, all_ok ? CRGB(0,50,0) : CRGB(50,0,0)); FastLED.show();
    if (mqtt_ok) {
        char buf[200];
        snprintf(buf, sizeof(buf), "{\"type\":\"self_test\",\"ir\":%s,\"blue\":%s,\"mq2\":%s,\"dht\":%s,\"wifi\":%s,\"mqtt\":%s,\"pass\":%s}",
            ir_ok?"true":"false", blue_ok?"true":"false", mq2_ok?"true":"false", dht_ok?"true":"false", wifi_ok?"true":"false", mqtt_ok?"true":"false", all_ok?"true":"false");
        mqtt.publish(TOPIC_EVENT, buf, false);
    }
    delay(1500);
}

void print_debug() {
    Serial.printf("[%5s] sev=%d delta=%.0f ir/blu=%.2f f/b=%.2f mq2=%d T=%.1f H=%.0f%% mqtt=%s msgs=%u\n",
        g_result.stage_name, g_result.severity, g_result.scatter_delta, g_result.ir_blue_ratio,
        g_result.fwd_back_ratio, g_sensor.mq2, g_sensor.temperature, g_sensor.humidity,
        mqtt.connected() ? "OK" : "DISC", g_msg_count);
}

void loop() {
    ArduinoOTA.handle();
    httpServer.handleClient();
    if (g_wifi_connected && !mqtt.connected()) mqtt_connect();
    mqtt.loop();

    if (!g_ap_mode && WiFi.status() != WL_CONNECTED) {
        g_wifi_connected = false;
        static unsigned long last_wifi_retry = 0;
        if (millis() - last_wifi_retry > 30000) { last_wifi_retry = millis(); Serial.println("[WIFI] Reconnecting..."); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
    } else if (!g_ap_mode && WiFi.status() == WL_CONNECTED && !g_wifi_connected) {
        g_wifi_connected = true; Serial.printf("[WIFI] Reconnected. IP: %s\n", WiFi.localIP().toString().c_str());
    }

    if (digitalRead(PIN_BUTTON) == LOW) {
        delay(50);
        if (digitalRead(PIN_BUTTON) == LOW) {
            if (g_result.severity >= 3) { g_alarm_silenced=true; g_silence_time=millis(); noTone(PIN_BUZZER); Serial.println("[BTN] Alarm silenced."); }
            else { self_test(); }
            while (digitalRead(PIN_BUTTON) == LOW) delay(10);
        }
    }

    if (g_alarm_silenced && (millis() - g_silence_time > ALARM_COOLDOWN)) g_alarm_silenced = false;

    if (millis() - g_last_sample >= TELEMETRY_INTERVAL) {
        g_last_sample = millis();
        read_sensors(); process_detection(); update_outputs(); update_baseline(); print_debug();
        if (mqtt.connected()) mqtt_publish_telemetry();
        digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS));
    }

    if (millis() - g_last_heartbeat >= HEARTBEAT_INTERVAL) {
        g_last_heartbeat = millis();
        mqtt_publish_heartbeat();
    }
}
