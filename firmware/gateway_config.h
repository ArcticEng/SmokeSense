/*
 * gateway_config.h — SmokeSense Gateway Configuration
 * Arctic Engineering — April 2026
 *
 * Configure input mode, zone pins, and thresholds per installation.
 */

#pragma once

// ─── DEVICE ──────────────────────────────────────
#define GW_FIRMWARE_VERSION  "1.0.0"

// ─── WIFI ────────────────────────────────────────
#define WIFI_SSID            "YourSiteWiFi"
#define WIFI_PASS            "YourPassword"
#define WIFI_CONNECT_TIMEOUT 15000
#define AP_PASS              "arctic2026"

// ─── MQTT BROKER ─────────────────────────────────
#define MQTT_HOST            "broker.hivemq.com"
#define MQTT_PORT            1883
#define MQTT_USER            ""
#define MQTT_PASS            ""
#define MQTT_ORG_ID          "default"

// Override device ID (otherwise auto-generated from MAC):
// #define DEVICE_ID_OVERRIDE "gw-lobby"

// ─── INPUT MODES ─────────────────────────────────
#define MODE_RELAY_INPUT     0
#define MODE_ANALOG_4_20MA   1

// ─── ZONE CONFIGURATION ─────────────────────────
// Up to 4 monitored zones. Set NUM_ACTIVE_ZONES to how many you use.
#define MAX_ZONES            4
#define NUM_ACTIVE_ZONES     4

// Zone pin assignments
// Relay inputs: use any digital GPIO with internal pull-up
// 4-20mA inputs: must use ADC1 pins (GPIO 32-39)
static const uint8_t ZONE_PINS[] = { 34, 35, 32, 33 };

// Mode per zone: MODE_RELAY_INPUT or MODE_ANALOG_4_20MA
static const uint8_t ZONE_MODES[] = {
    MODE_ANALOG_4_20MA,   // Zone 0: VESDA Loop A
    MODE_ANALOG_4_20MA,   // Zone 1: VESDA Loop B
    MODE_RELAY_INPUT,     // Zone 2: Conventional panel zone 1
    MODE_RELAY_INPUT,     // Zone 3: Conventional panel zone 2
};

// Human-readable zone names (shown on dashboard)
static const char* ZONE_NAMES[] = {
    "VESDA Loop A",
    "VESDA Loop B",
    "Panel Zone 1",
    "Panel Zone 2",
};

// ─── RELAY SETTINGS ──────────────────────────────
// Most fire panels: relay normally closed, opens on alarm
#define RELAY_ACTIVE_LOW     true    // true = LOW on GPIO = alarm
#define RELAY_ALARM_SEVERITY 4       // severity to assign when relay triggers
                                     // Set to 3 for pre-alarm, 4 for full alarm

// ─── 4-20mA ANALOG SETTINGS ─────────────────────
// Shunt resistor: 165Ω gives 0.66V at 4mA and 3.3V at 20mA
// (fits directly into ESP32 ADC range at 11dB attenuation)
// Use 250Ω with a voltage divider if running 5V loop
#define SHUNT_RESISTANCE     0.165   // ohms (165Ω = 0.165kΩ)

// VESDA smoke obscuration thresholds (as % of 4-20mA range)
// These match typical VESDA factory defaults:
//   Alert  =  0.025% obs/m  ≈  2% of range
//   Action =  0.1% obs/m    ≈  8% of range
//   Fire 1 =  0.5% obs/m    ≈  25% of range
//   Fire 2 =  2.0% obs/m    ≈  60% of range
#define ANALOG_ALERT_PCT     2.0     // severity 1
#define ANALOG_ACTION_PCT    8.0     // severity 2
#define ANALOG_FIRE1_PCT     25.0    // severity 3
#define ANALOG_FIRE2_PCT     60.0    // severity 4
#define ANALOG_ALARM_PCT     25.0    // boolean alarm flag threshold

// ─── OUTPUT PINS ─────────────────────────────────
#define PIN_LEDS             25      // WS2812B status LEDs
#define PIN_BUZZER           26      // Piezo alarm
#define PIN_STATUS           2       // Onboard LED

// ─── LED STRIP ───────────────────────────────────
#define NUM_LEDS             8
#define LED_BRIGHTNESS       60

// ─── TIMING ──────────────────────────────────────
#define POLL_INTERVAL_MS     2000    // how often to read zones
