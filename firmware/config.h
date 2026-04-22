/*
 * config.h — SmokeSense device configuration
 * Arctic Engineering — April 2026
 *
 * Change these values per deployment site.
 * For production, these will be stored in NVS
 * and provisioned via BLE or the local AP portal.
 */

#pragma once

// ─── WIFI ────────────────────────────────────────
#define WIFI_SSID           "YourSiteWiFi"
#define WIFI_PASS           "YourPassword"
#define WIFI_CONNECT_TIMEOUT 15000

// Fallback AP — for local config / provisioning
#define AP_SSID_PREFIX      "SmokeSense-"
#define AP_PASS             "arctic2026"

// ─── MQTT BROKER ─────────────────────────────────
#define MQTT_HOST           "broker.hivemq.com"
#define MQTT_PORT           1883
#define MQTT_USER           ""
#define MQTT_PASS           ""
#define MQTT_KEEPALIVE      30
#define MQTT_QOS_TELEMETRY  0
#define MQTT_QOS_EVENTS     1
#define MQTT_QOS_COMMANDS   1

// ─── TOPIC STRUCTURE ─────────────────────────────
#define MQTT_ORG_ID         "default"

// ─── PIN MAP ─────────────────────────────────────
#define PIN_LED_IR           4
#define PIN_LED_BLUE        16
#define PIN_PD_FWD          34
#define PIN_PD_BACK         35
#define PIN_MQ2             32
#define PIN_DHT             33
#define PIN_LEDS            25
#define PIN_BUZZER          26
#define PIN_BUTTON          27
#define PIN_STATUS           2

// ─── LED STRIP ───────────────────────────────────
#define NUM_LEDS             8
#define LED_BRIGHTNESS      60

// ─── SAMPLING ────────────────────────────────────
#define ADC_SAMPLES         16
#define PULSE_DURATION_US  200
#define TELEMETRY_INTERVAL 2000
#define HEARTBEAT_INTERVAL 30000
#define DRIFT_WINDOW       3600000UL

// ─── ALARM THRESHOLDS (VESDA-equivalent) ─────────
#define THRESH_ALERT        80
#define THRESH_ACTION      200
#define THRESH_FIRE1       400
#define THRESH_FIRE2       700
#define THRESH_MQ2         600

// ─── PARTICLE CLASSIFICATION ─────────────────────
#define RATIO_STEAM_MAX    0.8f
#define RATIO_SMOKE_MIN    1.2f
#define FB_SMOULDER_MIN    2.0f

// ─── HUMIDITY COMPENSATION ───────────────────────
#define HUMIDITY_THRESHOLD 75.0f
#define HUMIDITY_FACTOR    1.5f

// ─── ALARM BEHAVIOR ──────────────────────────────
#define ALARM_COOLDOWN     30000
#define BUZZER_FREQ_ALARM  3000
#define BUZZER_FREQ_WARN   2000

// ─── OTA ─────────────────────────────────────────
#define OTA_HOSTNAME_PREFIX "smokesense-"
#define FIRMWARE_VERSION    "1.3.0"
