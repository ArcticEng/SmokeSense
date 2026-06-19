/*
 * SmokeSense DataGuard — Module-Based Zero-Solder Build
 * Arctic Engineering — v1.2.0 — April 2026
 *
 * HARDWARE: ESP32 on screw terminal breakout
 *   Gas:   Alphasense H2-AF + CO-AF on ISB boards → ADS1115 (I2C)
 *   VOC:   BME680 (I2C) — also provides temp, humidity, pressure
 *   Temp:  MAX31865 (SPI) + PT100 RTD probe
 *   VESDA: 4-20mA via 165R shunt → ESP32 ADC (GPIO 36)
 *   Supp:  4-20mA via 165R shunt → ESP32 ADC (GPIO 39)
 *   Relay: 4x GPIO with pull-ups (buttons or opto-isolator)
 *   Out:   WS2812B strip, active buzzer module, relay module
 *
 * LIBRARIES (add to platformio.ini lib_deps):
 *   adafruit/Adafruit ADS1X15
 *   adafruit/Adafruit BME680 Library
 *   adafruit/Adafruit MAX31865 library
 *   adafruit/Adafruit Unified Sensor
 *   fastled/FastLED
 *   knolleary/PubSubClient
 *   bblanchon/ArduinoJson
 */

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <FastLED.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_BME680.h>
#include <Adafruit_MAX31865.h>
#include "dataguard_config.h"
#include "fire_classifier.h"
#include "pms5003.h"
#include "adpd4101.h"
#include "runtime_config.h"

// ═══════════════════════════════════════════════════
//  HARDWARE OBJECTS
// ═══════════════════════════════════════════════════

Adafruit_ADS1115 ads;
Adafruit_BME680 bme;
Adafruit_MAX31865 rtd(PIN_MAX_CS);

CRGB leds[NUM_LEDS];
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
WebServer httpServer(80);
Preferences prefs;
FireClassifier classifier;
PMS5003 pms;
bool g_pms_ok = false;
ADPD4101 adpd;
bool g_adpd_ok = false;
RuntimeConfig g_cfg;

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════

char g_device_id[20];
char g_hostname[32];
char TOPIC_TELEMETRY[80], TOPIC_EVENT[80], TOPIC_STATUS[80];
char TOPIC_HEARTBEAT[80], TOPIC_CMD[80], TOPIC_CONFIG[80], TOPIC_CONFSTATE[80];

struct GasData {
    float h2_ppm, co_ppm, voc_ppb;
    float h2_baseline, co_baseline, voc_baseline;
    float h2_delta, co_delta, voc_delta;
    float h2_rate, co_rate, voc_rate;
    float h2_prev, co_prev, voc_prev;
    int16_t h2_we_raw, h2_ae_raw, co_we_raw, co_ae_raw;
    float h2_we_mv, co_we_mv;
    unsigned long last_rate_calc;
} g_gas = {};

struct EnvData {
    float temperature;
    float humidity;
    float pressure;
    float voc_resistance;
    float temp_rtd;
    float temp_rate;
    float temp_prev;
} g_env = {};

struct VesdaData {
    float ma_value, smoke_pct;
    uint8_t severity;
} g_vesda = {};

// Optical chamber / particle smoke source — kept separate from the
// external VESDA channel so both can be monitored independently.
struct ChamberData {
    float smoke_pct;
    uint8_t severity;
    const char* source;   // "adpd" | "pms" | "none"
} g_chamber = { 0.0f, 0, "none" };

struct SuppressionData {
    float cylinder_pressure_bar, cylinder_pct;
    bool discharge_detected, door_open, manual_release, pressure_low;
} g_supp = {};

bool g_panel_alarm = false;
uint8_t g_severity = 0, g_prev_severity = 0;
const char* g_alarm_source = "none";
bool g_alarm_silenced = false;
unsigned long g_silence_time = 0, g_boot_time = 0;
unsigned long g_last_sample = 0, g_last_heartbeat = 0, g_last_reconnect = 0;
uint32_t g_msg_count = 0;
bool g_wifi_connected = false, g_ap_mode = false;
bool g_ads_ok = false, g_bme_ok = false, g_rtd_ok = false;

static const char* STAGE_NAMES[] = {"normal","early_warning","pre_alarm","critical","emergency"};
static const char* STAGE_LABELS[] = {"Normal","Early Warning","Pre-Alarm","Critical","EMERGENCY"};

// ═══════════════════════════════════════════════════
//  RUNTIME CONFIG — apply live values + publish state
// ═══════════════════════════════════════════════════

void apply_config() {
    // Classifier sensitivities
    classifier.thr.h2_low = g_cfg.thr_h2_low;       classifier.thr.h2_high = g_cfg.thr_h2_high;
    classifier.thr.co_low = g_cfg.thr_co_low;       classifier.thr.co_high = g_cfg.thr_co_high;
    classifier.thr.voc_low = g_cfg.thr_voc_low;     classifier.thr.voc_high = g_cfg.thr_voc_high;
    classifier.thr.temprate_low = g_cfg.thr_temprate_low; classifier.thr.temprate_high = g_cfg.thr_temprate_high;
    classifier.thr.vesda_low = g_cfg.thr_vesda_low; classifier.thr.vesda_high = g_cfg.thr_vesda_high;
    classifier.thr.humidity_high = g_cfg.thr_humidity_high;
    classifier.thr.conf_alert = g_cfg.conf_alert;       classifier.thr.conf_prealarm = g_cfg.conf_prealarm;
    classifier.thr.conf_critical = g_cfg.conf_critical; classifier.thr.conf_emergency = g_cfg.conf_emergency;
    // Optical beam sensitivity
    adpd.smoke_fullscale = g_cfg.adpd_fullscale;    adpd.smoke_thresh_pct = g_cfg.adpd_smoke_thresh;
    adpd.irblue_small = g_cfg.irblue_small;         adpd.irblue_large = g_cfg.irblue_large;
    adpd.fwdback_small = g_cfg.fwdback_small;       adpd.fwdback_large = g_cfg.fwdback_large;
}

void publish_confstate() {
    if (!mqtt.connected()) return;
    JsonDocument d;
    JsonObject o = d.to<JsonObject>();
    o["dev"] = g_device_id;
    JsonObject cfg = o["config"].to<JsonObject>();
    config_to_json(g_cfg, cfg);
    char buf[1024]; serializeJson(d, buf);
    mqtt.publish(TOPIC_CONFSTATE, buf, true); // retained so dashboard always sees current state
}

// ═══════════════════════════════════════════════════
//  OFFLINE DATA BUFFER (LittleFS)
//  Stores telemetry when MQTT is disconnected.
//  Flushes to cloud when connection resumes.
//  ~2MB flash = ~8 hours of readings at 2s intervals.
// ═══════════════════════════════════════════════════

#define BUFFER_DIR "/buf"
#define BUFFER_MAX_FILES 2000
#define BUFFER_FLUSH_BATCH 10

bool g_littlefs_ok = false;
uint32_t g_buffered_count = 0;
uint32_t g_flushed_count = 0;

void buffer_init() {
    g_littlefs_ok = LittleFS.begin(true); // true = format on first use
    if (g_littlefs_ok) {
        if (!LittleFS.exists(BUFFER_DIR)) LittleFS.mkdir(BUFFER_DIR);
        // Count existing buffered files
        File dir = LittleFS.open(BUFFER_DIR);
        if (dir && dir.isDirectory()) {
            File f;
            while ((f = dir.openNextFile())) { g_buffered_count++; f.close(); }
        }
        Serial.printf("[BUFFER] LittleFS ready. %u buffered readings pending.\n", g_buffered_count);
    } else {
        Serial.println("[BUFFER] LittleFS FAILED");
    }
}

void buffer_store(const char* json) {
    if (!g_littlefs_ok) return;
    if (g_buffered_count >= BUFFER_MAX_FILES) {
        // Delete oldest file to make room
        File dir = LittleFS.open(BUFFER_DIR);
        if (dir) {
            File oldest = dir.openNextFile();
            if (oldest) {
                String path = String(BUFFER_DIR) + "/" + oldest.name();
                oldest.close();
                LittleFS.remove(path);
                g_buffered_count--;
            }
        }
    }
    char fname[40];
    snprintf(fname, sizeof(fname), "%s/%lu.json", BUFFER_DIR, millis());
    File f = LittleFS.open(fname, "w");
    if (f) {
        f.print(json);
        f.close();
        g_buffered_count++;
    }
}

void buffer_flush() {
    if (!g_littlefs_ok || !mqtt.connected() || g_buffered_count == 0) return;

    File dir = LittleFS.open(BUFFER_DIR);
    if (!dir || !dir.isDirectory()) return;

    uint32_t flushed = 0;
    File f;
    while ((f = dir.openNextFile()) && flushed < BUFFER_FLUSH_BATCH) {
        String path = String(BUFFER_DIR) + "/" + f.name();
        size_t len = f.size();
        if (len > 0 && len < 2560) {
            char buf[2560];
            f.readBytes(buf, len);
            buf[len] = 0;
            f.close();
            if (mqtt.publish(TOPIC_TELEMETRY, buf, false)) {
                LittleFS.remove(path);
                flushed++;
                g_buffered_count--;
                g_flushed_count++;
            }
        } else {
            f.close();
            LittleFS.remove(path); // corrupt or empty
            g_buffered_count--;
        }
    }
    if (flushed > 0) {
        Serial.printf("[BUFFER] Flushed %u readings. %u remaining.\n", flushed, g_buffered_count);
    }
}

// ═══════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=======================================");
    Serial.println("  DataGuard v" DG_FIRMWARE_VERSION " (module build)");
    Serial.println("  Arctic Engineering");
    Serial.println("=======================================");
    g_boot_time = millis();

    // Load persisted runtime config (defaults from #defines, NVS overrides)
    config_load(g_cfg);
    apply_config();

    // I2C bus
    Wire.begin(PIN_SDA, PIN_SCL);

    // ADS1115 16-bit ADC
    g_ads_ok = ads.begin(ADS1115_ADDR);
    if (g_ads_ok) {
        ads.setGain(GAIN_ONE); // ±4.096V range, 0.125mV/bit
        Serial.println("[ADS1115] OK at 0x48");
    } else {
        Serial.println("[ADS1115] FAILED — check I2C wiring");
    }

    // BME680 environment sensor
    g_bme_ok = bme.begin(BME680_ADDR);
    if (g_bme_ok) {
        bme.setTemperatureOversampling(BME680_OS_8X);
        bme.setHumidityOversampling(BME680_OS_2X);
        bme.setPressureOversampling(BME680_OS_4X);
        bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
        bme.setGasHeater(320, 150); // 320C for 150ms
        Serial.println("[BME680] OK at 0x77");
    } else {
        Serial.println("[BME680] FAILED — check I2C wiring");
    }

    // MAX31865 RTD amplifier
    rtd.begin(MAX31865_3WIRE);
    float test_temp = rtd.temperature(RTD_NOMINAL, RTD_REF_RESISTOR);
    g_rtd_ok = (test_temp > -50 && test_temp < 200);
    Serial.printf("[MAX31865] %s — %.1fC\n", g_rtd_ok ? "OK" : "FAILED", test_temp);

    // Direct ADC for VESDA and suppression (still use ESP32 ADC for these)
    pinMode(PIN_VESDA, INPUT);
    pinMode(PIN_SUPP_PRESSURE, INPUT);
    analogSetAttenuation(ADC_11db);
    analogReadResolution(12);

    // Relay inputs
    pinMode(PIN_PANEL_ALARM, INPUT_PULLUP);
    pinMode(PIN_SUPP_DISCHARGE, INPUT_PULLUP);
    pinMode(PIN_DOOR, INPUT_PULLUP);
    pinMode(PIN_MANUAL_RELEASE, INPUT_PULLUP);

    // Outputs
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_STATUS, OUTPUT);
    pinMode(PIN_RELAY_OUT, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_RELAY_OUT, LOW);

    // LED strip
    FastLED.addLeds<WS2812B, PIN_LEDS, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(LED_BRIGHTNESS);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    // PMS5003 particle sensor (optional)
    if (g_cfg.use_pms) {
        pms.begin(Serial2, PIN_PMS_RX, PIN_PMS_TX);
        delay(1000); // Allow sensor to wake up
        g_pms_ok = true; // Will be validated on first read
        Serial.println("[PMS5003] Initialised on Serial2");
    } else {
        Serial.println("[PMS5003] Disabled (USE_PMS5003=false)");
    }

    // ADPD4101 optical scatter chamber (optional, shares I2C bus @0x24)
    if (g_cfg.use_adpd) {
        g_adpd_ok = adpd.begin(Wire);
        Serial.printf("[ADPD4101] %s\n", g_adpd_ok ? "OK @0x24" : "FAILED");
    } else {
        Serial.println("[ADPD4101] Disabled (USE_ADPD4101=false)");
    }

    // Device identity
    setup_identity();

    // Load baselines
    prefs.begin("dg", true);
    g_gas.h2_baseline = prefs.getFloat("bl_h2", H2_BASELINE_DEFAULT);
    g_gas.co_baseline = prefs.getFloat("bl_co", CO_BASELINE_DEFAULT);
    g_gas.voc_baseline = prefs.getFloat("bl_voc", VOC_BASELINE_DEFAULT);
    prefs.end();

    // Networking
    setup_wifi();
    setup_mqtt();
    setup_ota();
    setup_http();
    buffer_init();

    // Startup sweep
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = g_ads_ok ? CRGB(0,0,60) : CRGB(60,0,0);
        FastLED.show(); delay(50);
    }
    delay(200);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();

    g_gas.last_rate_calc = millis();
    Serial.printf("[BOOT] Device: %s | ADS:%s BME:%s RTD:%s PMS:%s BUF:%s\n",
        g_device_id, g_ads_ok?"OK":"FAIL", g_bme_ok?"OK":"FAIL", g_rtd_ok?"OK":"FAIL",
        (g_cfg.use_pms && g_pms_ok)?"OK":"OFF", g_littlefs_ok?"OK":"FAIL");
}

// ═══════════════════════════════════════════════════
//  IDENTITY + NETWORKING (same patterns)
// ═══════════════════════════════════════════════════

void setup_identity() {
#ifdef DEVICE_ID_OVERRIDE
    strncpy(g_device_id, DEVICE_ID_OVERRIDE, sizeof(g_device_id));
#else
    uint8_t mac[6]; WiFi.macAddress(mac);
    snprintf(g_device_id, sizeof(g_device_id), "DG-%02X%02X%02X%02X", mac[2],mac[3],mac[4],mac[5]);
#endif
    snprintf(g_hostname, sizeof(g_hostname), "dataguard-%s", g_device_id);
    snprintf(TOPIC_TELEMETRY,80,"smokesense/%s/%s/telemetry",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_EVENT,80,"smokesense/%s/%s/event",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_STATUS,80,"smokesense/%s/%s/status",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_HEARTBEAT,80,"smokesense/%s/%s/heartbeat",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_CMD,80,"smokesense/%s/%s/cmd",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_CONFIG,80,"smokesense/%s/%s/config",MQTT_ORG_ID,g_device_id);
    snprintf(TOPIC_CONFSTATE,80,"smokesense/%s/%s/confstate",MQTT_ORG_ID,g_device_id);
}

void setup_wifi() {
    WiFi.mode(WIFI_STA); WiFi.setHostname(g_hostname); WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long s = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500); Serial.print(".");
        if (millis()-s > WIFI_CONNECT_TIMEOUT) {
            WiFi.mode(WIFI_AP_STA);
            char ap[32]; snprintf(ap,32,"DataGuard-%s",&g_device_id[strlen(g_device_id)-4]);
            WiFi.softAP(ap, AP_PASS); g_ap_mode=true; return;
        }
    }
    g_wifi_connected = true;
    Serial.printf("\n[WIFI] IP: %s\n", WiFi.localIP().toString().c_str());
}

void setup_mqtt() {
    mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(mqtt_cb);
    mqtt.setKeepAlive(30); mqtt.setBufferSize(2560);
    if (g_wifi_connected) mqtt_connect();
}

void mqtt_connect() {
    if (mqtt.connected()) return;
    if (millis()-g_last_reconnect < 5000) return;
    g_last_reconnect = millis();
    bool ok = (strlen(MQTT_USER)>0)
        ? mqtt.connect(g_device_id,MQTT_USER,MQTT_PASS,TOPIC_STATUS,1,true,"{\"status\":\"offline\"}")
        : mqtt.connect(g_device_id,NULL,NULL,TOPIC_STATUS,1,true,"{\"status\":\"offline\"}");
    if (ok) {
        JsonDocument d; d["status"]="online"; d["device"]=g_device_id;
        d["firmware"]=DG_FIRMWARE_VERSION; d["type"]="dataguard";
        d["ip"]=WiFi.localIP().toString();
        d["ads1115"]=g_ads_ok; d["bme680"]=g_bme_ok; d["max31865"]=g_rtd_ok;
        char b[300]; serializeJson(d,b);
        mqtt.publish(TOPIC_STATUS,b,true);
        mqtt.subscribe(TOPIC_CMD,1); mqtt.subscribe(TOPIC_CONFIG,1);
        publish_confstate();
        Serial.println("[MQTT] Connected.");
    }
}

void mqtt_cb(char* topic, byte* payload, unsigned int len) {
    if (len>1024) return;
    char m[1025]; memcpy(m,payload,len); m[len]=0;
    JsonDocument d; if (deserializeJson(d,m)) return;

    // ── Config topic: merge + persist + apply runtime config ──
    if (strcmp(topic, TOPIC_CONFIG)==0) {
        bool prev_adpd = g_cfg.use_adpd, prev_pms = g_cfg.use_pms;
        if (config_merge_json(g_cfg, d.as<JsonObjectConst>())) {
            // Newly enabled sensors — initialise on the fly
            if (g_cfg.use_adpd && !prev_adpd && !g_adpd_ok) g_adpd_ok = adpd.begin(Wire);
            if (g_cfg.use_pms && !prev_pms) { pms.begin(Serial2, PIN_PMS_RX, PIN_PMS_TX); g_pms_ok = true; }
            apply_config();
            config_save(g_cfg);
            publish_confstate();
            Serial.println("[CONFIG] Updated, saved, applied.");
        }
        return;
    }

    // ── Command topic ──
    const char* cmd = d["cmd"];
    if (!cmd) return;
    if (strcmp(cmd,"silence")==0) { g_alarm_silenced=true; g_silence_time=millis(); digitalWrite(PIN_BUZZER,LOW); }
    else if (strcmp(cmd,"recalibrate")==0) {
        g_gas.h2_baseline=g_gas.h2_ppm; g_gas.co_baseline=g_gas.co_ppm; g_gas.voc_baseline=g_gas.voc_ppb;
        prefs.begin("dg",false);
        prefs.putFloat("bl_h2",g_gas.h2_baseline); prefs.putFloat("bl_co",g_gas.co_baseline);
        prefs.putFloat("bl_voc",g_gas.voc_baseline); prefs.end();
        if (g_cfg.use_adpd) adpd.recalibrate();
        Serial.printf("[CAL] H2=%.1f CO=%.1f VOC=%.1f\n",g_gas.h2_baseline,g_gas.co_baseline,g_gas.voc_baseline);
    }
    else if (strcmp(cmd,"reboot")==0) { delay(500); ESP.restart(); }
    else if (strcmp(cmd,"identify")==0) {
        for (int j=0;j<8;j++) { fill_solid(leds,NUM_LEDS,(j%2)?CRGB::Blue:CRGB::Black); FastLED.show(); delay(250); }
    }
    else if (strcmp(cmd,"get_config")==0) { publish_confstate(); }
    else if (strcmp(cmd,"reset_config")==0) {
        config_set_defaults(g_cfg); apply_config(); config_save(g_cfg); publish_confstate();
        Serial.println("[CONFIG] Reset to defaults.");
    }
}

void setup_ota() { ArduinoOTA.setHostname(g_hostname); ArduinoOTA.begin(); }

void setup_http() {
    httpServer.on("/api/status", []() {
        JsonDocument d;
        d["dev"]=g_device_id; d["sev"]=g_severity; d["stage"]=STAGE_LABELS[min((int)g_severity,4)];
        d["source"]=g_alarm_source;
        d["h2"]=g_gas.h2_ppm; d["co"]=g_gas.co_ppm; d["voc"]=g_gas.voc_ppb;
        d["temp_bme"]=g_env.temperature; d["temp_rtd"]=g_env.temp_rtd;
        d["humidity"]=g_env.humidity; d["pressure"]=g_env.pressure;
        d["voc_kohm"]=g_env.voc_resistance/1000.0;
        d["vesda_pct"]=g_vesda.smoke_pct; d["supp_bar"]=g_supp.cylinder_pressure_bar;
        d["discharged"]=g_supp.discharge_detected; d["door"]=g_supp.door_open;
        d["panel"]=g_panel_alarm;
        d["ads_ok"]=g_ads_ok; d["bme_ok"]=g_bme_ok; d["rtd_ok"]=g_rtd_ok;
        char b[500]; serializeJson(d,b);
        httpServer.send(200,"application/json",b);
    });
    httpServer.begin();
}

// ═══════════════════════════════════════════════════
//  SENSOR READING — via I2C/SPI modules
// ═══════════════════════════════════════════════════

void read_gas_sensors() {
    g_gas.h2_prev = g_gas.h2_ppm;
    g_gas.co_prev = g_gas.co_ppm;
    g_gas.voc_prev = g_gas.voc_ppb;

    if (g_ads_ok) {
        // Read all 4 ADS1115 channels
        g_gas.h2_we_raw = ads.readADC_SingleEnded(ADS_CH_H2_WE);
        g_gas.h2_ae_raw = ads.readADC_SingleEnded(ADS_CH_H2_AE);
        g_gas.co_we_raw = ads.readADC_SingleEnded(ADS_CH_CO_WE);
        g_gas.co_ae_raw = ads.readADC_SingleEnded(ADS_CH_CO_AE);

        // Convert to millivolts (at GAIN_ONE: 0.125 mV per bit)
        g_gas.h2_we_mv = g_gas.h2_we_raw * 0.125;
        g_gas.co_we_mv = g_gas.co_we_raw * 0.125;
        float h2_ae_mv = g_gas.h2_ae_raw * 0.125;
        float co_ae_mv = g_gas.co_ae_raw * 0.125;

        if (USE_MQ_FALLBACK) {
            // MQ hobby sensors: simple voltage-to-ppm approximation
            g_gas.h2_ppm = (g_gas.h2_we_mv / 1000.0) * MQ_H2_SCALE * 1000.0;
            g_gas.co_ppm = (g_gas.co_we_mv / 1000.0) * MQ_CO_SCALE * 1000.0;
        } else {
            // Alphasense ISB: compensated WE - AE differential
            float h2_diff = g_gas.h2_we_mv - h2_ae_mv;
            float co_diff = g_gas.co_we_mv - co_ae_mv;
            // ISB output: each mV above zero corresponds to gas concentration
            // ppm = (WE_mV - AE_mV) / (sensitivity_nA_per_ppm * transimpedance_gain)
            // ISB transimpedance is typically ~100 kOhm, so 1 nA = 0.1 mV
            g_gas.h2_ppm = max(0.0f, h2_diff / (H2_ISB_SENSITIVITY * 0.1f));
            g_gas.co_ppm = max(0.0f, co_diff / (CO_ISB_SENSITIVITY * 0.1f));
        }
    }

    // Deltas
    g_gas.h2_delta = max(0.0f, g_gas.h2_ppm - g_gas.h2_baseline);
    g_gas.co_delta = max(0.0f, g_gas.co_ppm - g_gas.co_baseline);

    // Rates
    unsigned long now = millis();
    float dt = (now - g_gas.last_rate_calc) / 60000.0;
    if (dt > 0.08) {
        g_gas.h2_rate = (g_gas.h2_ppm - g_gas.h2_prev) / dt;
        g_gas.co_rate = (g_gas.co_ppm - g_gas.co_prev) / dt;
        g_gas.last_rate_calc = now;
    }
}

void read_environment() {
    g_env.temp_prev = g_env.temperature;

    // BME680: temp + humidity + pressure + VOC gas resistance
    if (g_bme_ok && bme.performReading()) {
        g_env.temperature = bme.temperature;
        g_env.humidity = bme.humidity;
        g_env.pressure = bme.pressure / 100.0; // Pa to hPa
        g_env.voc_resistance = bme.gas_resistance; // ohms

        // Convert gas resistance to VOC ppb estimate
        // Higher resistance = cleaner air. Resistance drops with VOCs.
        float ratio = BME_VOC_BASELINE_KOHM / (g_env.voc_resistance / 1000.0);
        g_gas.voc_ppb = max(0.0f, (ratio - 1.0f) * 500.0f); // rough linearization
        g_gas.voc_delta = max(0.0f, g_gas.voc_ppb - g_gas.voc_baseline);
    }

    // MAX31865: precision RTD temperature
    if (g_rtd_ok) {
        g_env.temp_rtd = rtd.temperature(RTD_NOMINAL, RTD_REF_RESISTOR);
        // Check for faults
        uint8_t fault = rtd.readFault();
        if (fault) {
            Serial.printf("[RTD] Fault: 0x%02X\n", fault);
            rtd.clearFault();
        }
    }

    // Temperature rate of change
    static unsigned long last_tr = 0;
    float dt = (millis() - last_tr) / 60000.0;
    if (dt > 0.08) {
        g_env.temp_rate = (g_env.temp_rtd - g_env.temp_prev) / dt;
        last_tr = millis();
    }
}

void read_vesda() {
    if (!g_cfg.vesda_present) {
        // No external VESDA system connected — channel inactive.
        g_vesda.ma_value = 0; g_vesda.smoke_pct = 0; g_vesda.severity = 0;
        return;
    }
    uint32_t sum = 0;
    for (int i=0; i<16; i++) { sum += analogRead(PIN_VESDA); delayMicroseconds(100); }
    float raw = sum / 16.0;

    if (VESDA_USE_POT) {
        // Prototype mode: pot gives 0-3.3V directly = 0-100%
        g_vesda.smoke_pct = (raw / 4095.0) * 100.0;
        g_vesda.ma_value = 4.0 + (g_vesda.smoke_pct / 100.0) * 16.0; // simulated mA
    } else {
        // Production mode: 4-20mA via shunt resistor
        float v = (raw / 4095.0) * 3.3;
        g_vesda.ma_value = constrain(v / VESDA_SHUNT * 1000.0, 4.0, 20.0);
        g_vesda.smoke_pct = ((g_vesda.ma_value - 4.0) / 16.0) * 100.0;
    }

    if (g_vesda.smoke_pct >= 60) g_vesda.severity = 4;
    else if (g_vesda.smoke_pct >= 25) g_vesda.severity = 3;
    else if (g_vesda.smoke_pct >= 8) g_vesda.severity = 2;
    else if (g_vesda.smoke_pct >= 2) g_vesda.severity = 1;
    else g_vesda.severity = 0;
}

void read_suppression() {
    uint32_t sum = 0;
    for (int i=0; i<16; i++) { sum += analogRead(PIN_SUPP_PRESSURE); delayMicroseconds(100); }
    float raw = sum / 16.0;

    if (SUPP_USE_POT) {
        // Prototype mode: wire to 3.3V = 100%, GND = 0%
        g_supp.cylinder_pct = (raw / 4095.0) * 100.0;
        g_supp.cylinder_pressure_bar = (g_supp.cylinder_pct / 100.0) * SUPP_NOMINAL_PRESSURE;
    } else {
        // Production mode: 4-20mA via shunt resistor
        float v = (raw / 4095.0) * 3.3;
        float ma = constrain(v / SUPP_SHUNT * 1000.0, 4.0, 20.0);
        g_supp.cylinder_pressure_bar = ((ma - 4.0) / 16.0) * SUPP_MAX_PRESSURE_BAR;
        g_supp.cylinder_pct = (g_supp.cylinder_pressure_bar / SUPP_NOMINAL_PRESSURE) * 100.0;
    }
    g_supp.pressure_low = g_supp.cylinder_pct < SUPP_LOW_PCT;
    g_supp.discharge_detected = (digitalRead(PIN_SUPP_DISCHARGE) == LOW);
    g_supp.door_open = (digitalRead(PIN_DOOR) == LOW);
    g_supp.manual_release = (digitalRead(PIN_MANUAL_RELEASE) == LOW);
}

void read_panel() { g_panel_alarm = (digitalRead(PIN_PANEL_ALARM) == LOW); }

// ═══════════════════════════════════════════════════
//  ALARM ENGINE (same logic as v1.0)
// ═══════════════════════════════════════════════════

void process_alarms() {
    g_prev_severity = g_severity;
    uint8_t gas_sev = 0;
    const char* src = "none";

    int gas_count = 0;
    if (g_gas.h2_delta > H2_ALERT) gas_count++;
    if (g_gas.co_delta > CO_ALERT) gas_count++;
    if (g_gas.voc_delta > VOC_ALERT) gas_count++;

    if (g_gas.h2_delta >= H2_EMERGENCY) { gas_sev=4; src="h2_emergency"; }
    else if (g_gas.h2_delta >= H2_CRITICAL) { gas_sev=3; src="h2_critical"; }
    else if (gas_count >= 2 && g_gas.h2_delta >= H2_ALERT) { gas_sev=2; src="multi_gas"; }
    else if (g_gas.h2_delta >= H2_ALERT || g_gas.co_delta >= CO_ALERT) { gas_sev=1; src="offgas_early"; }

    if (g_gas.h2_rate > H2_RATE_CRITICAL && gas_sev < 3) { gas_sev=3; src="h2_rate_rise"; }
    if (g_env.temp_rate > TEMP_RATE_CRITICAL && gas_sev < 2) { gas_sev=2; src="temp_rise"; }

    g_severity = gas_sev;
    if (g_vesda.severity > g_severity) { g_severity=g_vesda.severity; src="vesda"; }
    if (g_supp.discharge_detected) { g_severity=4; src="suppression_discharge"; }
    if (g_supp.manual_release) { g_severity=4; src="manual_release"; }
    if (g_panel_alarm && g_severity < 3) { g_severity=3; src="panel_alarm"; }
    if (g_supp.pressure_low && g_severity < 1) { g_severity=1; src="pressure_low"; }

    g_alarm_source = src;
    digitalWrite(PIN_RELAY_OUT, g_severity >= 3 ? HIGH : LOW);

    if (g_severity != g_prev_severity) publish_event(g_prev_severity, g_severity, src);
}

// ═══════════════════════════════════════════════════
//  OUTPUTS — active buzzer module (just HIGH/LOW)
// ═══════════════════════════════════════════════════

void update_outputs() {
    fill_solid(leds, NUM_LEDS, CRGB::Black);

    // LEDs 0-1: Gas
    CRGB gc = CRGB(0,20,0);
    if (g_gas.h2_delta > g_cfg.h2_alert) gc = CRGB(80,80,0);
    if (g_gas.h2_delta > g_cfg.h2_critical) gc = (millis()/500)%2 ? CRGB(255,0,0) : CRGB(80,0,0);
    leds[0]=leds[1]=gc;

    // LEDs 2-3: VESDA
    CRGB vc = CRGB(0,20,0);
    if (g_vesda.severity>=1) vc=CRGB(80,80,0);
    if (g_vesda.severity>=3) vc=(millis()/500)%2?CRGB(255,0,0):CRGB(80,0,0);
    leds[2]=leds[3]=vc;

    // LEDs 4-5: Suppression
    CRGB sc = CRGB(0,20,0);
    if (g_supp.pressure_low) sc=CRGB(80,80,0);
    if (g_supp.discharge_detected) sc=(millis()/250)%2?CRGB(255,0,0):CRGB(0,0,0);
    leds[4]=leds[5]=sc;

    // LEDs 6-7: Overall
    switch(g_severity) {
        case 0: leds[6]=leds[7]=CRGB(0,30,0); break;
        case 1: leds[6]=leds[7]=CRGB(80,80,0); break;
        case 2: leds[6]=leds[7]=CRGB(200,100,0); break;
        case 3: leds[6]=leds[7]=(millis()/500)%2?CRGB(255,0,0):CRGB(80,0,0); break;
        case 4: leds[6]=leds[7]=(millis()/200)%2?CRGB(255,0,0):CRGB(0,0,0); break;
    }
    FastLED.show();

    // Active buzzer module: HIGH = on, LOW = off (no tone() needed)
    if (!g_alarm_silenced) {
        if (g_severity>=4) digitalWrite(PIN_BUZZER, (millis()/150)%2);
        else if (g_severity>=3) digitalWrite(PIN_BUZZER, (millis()/400)%2);
        else if (g_severity>=2) digitalWrite(PIN_BUZZER, (millis()/3000)%2==0 && (millis()%3000)<100);
        else digitalWrite(PIN_BUZZER, LOW);
    } else digitalWrite(PIN_BUZZER, LOW);
}

// ═══════════════════════════════════════════════════
//  MQTT PUBLISH
// ═══════════════════════════════════════════════════

void publish_telemetry() {
    // Build JSON regardless of connection state
    JsonDocument d;
    d["dev"]=g_device_id; d["ts"]=millis(); d["fw"]=DG_FIRMWARE_VERSION;
    d["type"]="dataguard"; d["uptime"]=(millis()-g_boot_time)/1000;
    d["sev"]=g_severity; d["stage"]=STAGE_NAMES[min((int)g_severity,4)];
    d["source"]=g_alarm_source; d["silenced"]=g_alarm_silenced;

    JsonObject gas=d["gas"].to<JsonObject>();
    gas["h2_ppm"]=round(g_gas.h2_ppm*10)/10.0;
    gas["co_ppm"]=round(g_gas.co_ppm*10)/10.0;
    gas["voc_ppb"]=round(g_gas.voc_ppb);
    gas["h2_delta"]=round(g_gas.h2_delta*10)/10.0;
    gas["co_delta"]=round(g_gas.co_delta*10)/10.0;
    gas["voc_delta"]=round(g_gas.voc_delta);
    gas["h2_rate"]=round(g_gas.h2_rate*10)/10.0;
    gas["co_rate"]=round(g_gas.co_rate*10)/10.0;
    gas["h2_we_mv"]=round(g_gas.h2_we_mv);
    gas["co_we_mv"]=round(g_gas.co_we_mv);
    gas["h2_bl"]=round(g_gas.h2_baseline*10)/10.0;
    gas["co_bl"]=round(g_gas.co_baseline*10)/10.0;

    JsonObject env=d["env"].to<JsonObject>();
    env["temp_bme"]=round(g_env.temperature*10)/10.0;
    env["temp_rtd"]=round(g_env.temp_rtd*10)/10.0;
    env["humidity"]=round(g_env.humidity);
    env["pressure"]=round(g_env.pressure*10)/10.0;
    env["voc_kohm"]=round(g_env.voc_resistance/100.0)/10.0;
    env["temp_rate"]=round(g_env.temp_rate*10)/10.0;

    JsonObject vs=d["vesda"].to<JsonObject>();
    vs["present"]=g_cfg.vesda_present;
    vs["ma"]=round(g_vesda.ma_value*10)/10.0;
    vs["smoke_pct"]=round(g_vesda.smoke_pct*10)/10.0;
    vs["sev"]=g_vesda.severity;

    JsonObject ch=d["chamber"].to<JsonObject>();
    ch["smoke_pct"]=round(g_chamber.smoke_pct*10)/10.0;
    ch["sev"]=g_chamber.severity;
    ch["source"]=g_chamber.source;

    JsonObject sp=d["suppression"].to<JsonObject>();
    sp["pressure_bar"]=round(g_supp.cylinder_pressure_bar*10)/10.0;
    sp["pressure_pct"]=round(g_supp.cylinder_pct);
    sp["pressure_low"]=g_supp.pressure_low;
    sp["discharged"]=g_supp.discharge_detected;
    sp["door_open"]=g_supp.door_open;

    d["panel_alarm"]=g_panel_alarm;

    // Fire classifier results
    JsonObject fc=d["classifier"].to<JsonObject>();
    fc["fire_type"]=FIRE_TYPE_NAMES[classifier.state.result.fire_type];
    fc["fire_label"]=FIRE_TYPE_LABELS[classifier.state.result.fire_type];
    fc["confidence"]=round(classifier.state.result.confidence);
    fc["action"]=ACTION_NAMES[classifier.state.result.action];
    fc["action_label"]=ACTION_LABELS[classifier.state.result.action];
    fc["sensors_active"]=classifier.state.result.sensors_active;
    fc["sensors_agreeing"]=classifier.state.result.sensors_agreeing;
    fc["confirmed"]=classifier.state.confirmed;
    fc["sustained_ms"]=classifier.state.result.sustained_ms;
    fc["h2_score"]=round(classifier.state.result.h2_score*100);
    fc["co_score"]=round(classifier.state.result.co_score*100);
    fc["voc_score"]=round(classifier.state.result.voc_score*100);
    fc["temp_score"]=round(classifier.state.result.temp_score*100);
    fc["vesda_score"]=round(classifier.state.result.vesda_score*100);

    // PMS5003 particle sensor data (if connected)
    if (g_cfg.use_pms && g_pms_ok) {
        JsonObject pm=d["particles"].to<JsonObject>();
        pm["pm1_0"]=pms.data.pm1_0_atm;
        pm["pm2_5"]=pms.data.pm2_5_atm;
        pm["pm10"]=pms.data.pm10_atm;
        pm["cnt_0_3"]=pms.data.cnt_0_3um;
        pm["cnt_1_0"]=pms.data.cnt_1_0um;
        pm["cnt_2_5"]=pms.data.cnt_2_5um;
        pm["cnt_10"]=pms.data.cnt_10um;
        pm["density"]=round(pms.data.smoke_density);
        pm["ratio"]=round(pms.data.pm1_pm10_ratio*100)/100.0;
        pm["fire_hint"]=pms.data.particle_fire_hint;
    }

    // Dashboard compatibility + optical chamber fields
    d["smoke"]=g_severity>=1; d["smoulder"]=false; d["mq2_alm"]=false;
    JsonObject raw=d["raw"].to<JsonObject>();
    JsonObject bl=d["baseline"].to<JsonObject>();
    if (g_cfg.use_adpd && g_adpd_ok) {
        // Real dual-wavelength scatter from the ADPD4101 chamber
        d["delta"]=round(adpd.data.scatter_delta);
        d["ir_blue"]=round(adpd.data.ir_blue_ratio*100)/100.0;
        d["fwd_back"]=round(adpd.data.fwd_back_ratio*100)/100.0;
        raw["fwd_ir"]=adpd.data.fwd_ir;  raw["fwd_blu"]=adpd.data.fwd_blue;
        raw["bck_ir"]=adpd.data.back_ir; raw["bck_blu"]=adpd.data.back_blue;
        bl["fwd"]=adpd.data.bl_fwd_ir;   bl["back"]=adpd.data.bl_back_ir;
    } else {
        d["delta"]=round(g_gas.h2_delta*10)/10.0; d["ir_blue"]=0; d["fwd_back"]=0;
        raw["fwd_ir"]=0;raw["fwd_blu"]=0;raw["bck_ir"]=0;raw["bck_blu"]=0;
        bl["fwd"]=0;bl["back"]=0;
    }
    raw["mq2"]=0;
    raw["temp"]=round(g_env.temp_rtd*10)/10.0; raw["hum"]=round(g_env.humidity);
    bl["mq2"]=0;

    d["rssi"]=WiFi.RSSI(); d["heap"]=ESP.getFreeHeap();
    d["buffered"]=g_buffered_count;

    char buf[2560]; serializeJson(d,buf);

    if (mqtt.connected()) {
        if (mqtt.publish(TOPIC_TELEMETRY,buf,false)) g_msg_count++;
    } else {
        // MQTT disconnected — store to flash
        buffer_store(buf);
    }
}

void publish_event(uint8_t old_s, uint8_t new_s, const char* src) {
    if (!mqtt.connected()) return;
    JsonDocument d;
    d["dev"]=g_device_id; d["ts"]=millis();
    d["type"]=new_s>old_s?"escalation":"de-escalation";
    d["from_stage"]=STAGE_NAMES[old_s]; d["to_stage"]=STAGE_NAMES[min((int)new_s,4)];
    d["severity"]=new_s; d["source"]=src;
    d["fire_type"]=FIRE_TYPE_NAMES[classifier.state.result.fire_type];
    d["fire_label"]=FIRE_TYPE_LABELS[classifier.state.result.fire_type];
    d["confidence"]=round(classifier.state.result.confidence);
    d["action"]=ACTION_NAMES[classifier.state.result.action];
    d["h2_ppm"]=g_gas.h2_ppm; d["co_ppm"]=g_gas.co_ppm;
    d["h2_rate"]=g_gas.h2_rate; d["temp"]=g_env.temp_rtd;
    d["temp_rate"]=g_env.temp_rate; d["vesda_pct"]=g_vesda.smoke_pct;
    d["discharged"]=g_supp.discharge_detected;
    d["is_smoke"]=new_s>=1; d["delta"]=g_gas.h2_delta;
    d["ir_blue"]=0; d["mq2"]=0; d["hum"]=round(g_env.humidity);
    char buf[640]; serializeJson(d,buf);
    mqtt.publish(TOPIC_EVENT,buf,false);
    Serial.printf("[EVENT] %s->%s (%s) H2=%.1f CO=%.1f\n",
        STAGE_NAMES[old_s],STAGE_NAMES[min((int)new_s,4)],src,g_gas.h2_ppm,g_gas.co_ppm);
}

void publish_heartbeat() {
    if (!mqtt.connected()) return;
    JsonDocument d;
    d["dev"]=g_device_id; d["ts"]=millis(); d["type"]="dataguard";
    d["uptime"]=(millis()-g_boot_time)/1000; d["rssi"]=WiFi.RSSI();
    d["heap"]=ESP.getFreeHeap(); d["msgs"]=g_msg_count; d["sev"]=g_severity;
    d["fw"]=DG_FIRMWARE_VERSION; d["supp_pct"]=round(g_supp.cylinder_pct);
    d["ads_ok"]=g_ads_ok; d["bme_ok"]=g_bme_ok; d["rtd_ok"]=g_rtd_ok;
    char buf[300]; serializeJson(d,buf);
    mqtt.publish(TOPIC_HEARTBEAT,buf,false);
}

// ═══════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════

void loop() {
    ArduinoOTA.handle();
    httpServer.handleClient();
    if (g_wifi_connected && !mqtt.connected()) mqtt_connect();
    mqtt.loop();

    if (!g_ap_mode && WiFi.status()!=WL_CONNECTED) {
        g_wifi_connected=false;
        static unsigned long lr=0;
        if (millis()-lr>30000) { lr=millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID,WIFI_PASS); }
    } else if (!g_ap_mode && WiFi.status()==WL_CONNECTED && !g_wifi_connected) g_wifi_connected=true;

    if (g_alarm_silenced && (millis()-g_silence_time>SILENCE_DURATION)) g_alarm_silenced=false;

    if (millis()-g_last_sample >= g_cfg.poll_ms) {
        g_last_sample = millis();
        read_gas_sensors();
        read_environment();
        read_vesda();
        read_suppression();
        read_panel();

        // PMS5003 particle sensor update (particle classification source)
        if (g_cfg.use_pms) {
            pms.update();
            g_pms_ok = pms.isConnected();
        }

        // ADPD4101 optical chamber update (smoke + particle classification)
        if (g_cfg.use_adpd) {
            adpd.update();
            g_adpd_ok = adpd.isConnected();
        }

        // ── Smoke source resolution ────────────────────────
        // External VESDA (read in read_vesda) is its own channel. The
        // optical chamber / PMS5003 form the separate "chamber" channel.
        g_chamber.smoke_pct = 0.0f; g_chamber.source = "none";
        if (g_cfg.use_adpd && g_adpd_ok) {
            g_chamber.smoke_pct = adpd.data.smoke_pct; g_chamber.source = "adpd";
        } else if (g_cfg.use_pms && g_pms_ok) {
            g_chamber.smoke_pct = pms.data.smoke_density; g_chamber.source = "pms";
        }
        if      (g_chamber.smoke_pct >= 60) g_chamber.severity = 4;
        else if (g_chamber.smoke_pct >= 25) g_chamber.severity = 3;
        else if (g_chamber.smoke_pct >= 8)  g_chamber.severity = 2;
        else if (g_chamber.smoke_pct >= 2)  g_chamber.severity = 1;
        else                                g_chamber.severity = 0;

        // Effective smoke % fed to the classifier:
        //   VESDA present -> max(VESDA, chamber) so either can escalate
        //   VESDA absent  -> the chamber is the smoke detector
        float smoke_pct = g_cfg.vesda_present
            ? fmaxf(g_vesda.smoke_pct, g_chamber.smoke_pct)
            : g_chamber.smoke_pct;

        // Fire classification — multi-sensor fusion
        ClassifierResult fire = classifier.classify(
            g_gas.h2_delta,          // H2 delta above baseline
            g_gas.co_delta,          // CO delta above baseline  
            g_gas.voc_ppb,           // VOC concentration
            g_env.temp_rate,         // Temperature rate of change
            smoke_pct,               // Effective smoke % (VESDA and/or chamber)
            g_env.humidity,          // Humidity (steam detection)
            g_panel_alarm,           // External fire panel
            g_supp.discharge_detected, // Suppression discharged
            g_adpd_ok ? adpd.data.fwd_back_ratio
                      : (g_pms_ok ? pms.data.pm1_pm10_ratio : -1.0f),  // Optical/particle ratio
            g_adpd_ok ? adpd.data.particle_fire_hint
                      : (g_pms_ok ? pms.data.particle_fire_hint : 0)    // Optical/particle fire hint
        );

        // Use classifier action level as severity
        g_severity = (uint8_t)fire.action;
        g_alarm_source = FIRE_TYPE_NAMES[fire.fire_type];
        if (g_severity != g_prev_severity) {
            publish_event(g_prev_severity, g_severity, g_alarm_source);
        }
        g_prev_severity = g_severity;

        // Relay activates at CRITICAL or higher
        digitalWrite(PIN_RELAY_OUT, g_severity >= 3 ? HIGH : LOW);
        update_outputs();

        Serial.printf("[%8s] H2=%.1f(+%.1f) CO=%.1f(+%.1f) VOC=%.0f T=%.1f/%.1fC VESDA=%.0f%% Supp=%.0f%%%s%s\n",
            STAGE_LABELS[min((int)g_severity,4)],
            g_gas.h2_ppm,g_gas.h2_delta, g_gas.co_ppm,g_gas.co_delta,
            g_gas.voc_ppb, g_env.temperature,g_env.temp_rtd,
            g_vesda.smoke_pct, g_supp.cylinder_pct,
            g_supp.discharge_detected?" DISCHARGED":"",
            g_panel_alarm?" PANEL":"");
        Serial.printf("         [FIRE] type=%s conf=%.0f%% sensors=%d action=%s%s\n",
            FIRE_TYPE_LABELS[fire.fire_type], fire.confidence,
            fire.sensors_active, ACTION_LABELS[fire.action],
            classifier.state.confirmed ? " CONFIRMED" : "");

        publish_telemetry(); // publishes to MQTT or buffers to LittleFS
        digitalWrite(PIN_STATUS, !digitalRead(PIN_STATUS));
    }

    // Flush offline buffer when MQTT reconnects
    if (mqtt.connected() && g_buffered_count > 0) {
        buffer_flush();
    }

    if (millis()-g_last_heartbeat >= 30000) {
        g_last_heartbeat = millis();
        publish_heartbeat();
    }
}
