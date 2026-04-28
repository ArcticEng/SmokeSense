/*
 * dataguard_config.h — Zero-Solder Module Build
 * Arctic Engineering — April 2026
 *
 * All sensors via I2C/SPI modules with pre-soldered headers.
 * ESP32 on screw terminal breakout board.
 * No soldering required.
 */

#pragma once

#define DG_FIRMWARE_VERSION  "1.2.0"

// ─── WIFI ────────────────────────────────────────
#define WIFI_SSID            "YourWiFi"
#define WIFI_PASS            "YourPassword"
#define WIFI_CONNECT_TIMEOUT 15000
#define AP_PASS              "dataguard2026"

// ─── MQTT ────────────────────────────────────────
#define MQTT_HOST            "broker.hivemq.com"
#define MQTT_PORT            1883
#define MQTT_USER            ""
#define MQTT_PASS            ""
#define MQTT_ORG_ID          "default"

// #define DEVICE_ID_OVERRIDE "dc-batt-room-a"

// ═══════════════════════════════════════════════════
//  HARDWARE MODE — MODULE-BASED (zero solder)
// ═══════════════════════════════════════════════════
//
// Gas sensors:   Alphasense H2-AF + CO-AF on ISB boards
//                → ISB analog outputs to ADS1115 (I2C)
//                Fallback: MQ-8 + MQ-7 to ADS1115
//
// VOC + env:     BME680 module (I2C) — VOC + temp + humidity + pressure
//
// Temperature:   MAX31865 module (SPI) + PT100 RTD probe
//
// VESDA:         165R shunt or 10K pot → ESP32 ADC (GPIO 36)
// Suppression:   165R shunt or 10K pot → ESP32 ADC (GPIO 39)
//
// Relay inputs:  Buttons or opto-isolator → GPIO with pull-up
// Outputs:       LED strip, active buzzer module, relay module

// ═══════════════════════════════════════════════════
//  I2C BUS (shared SDA/SCL)
// ═══════════════════════════════════════════════════
#define PIN_SDA              21    // I2C data  — ADS1115 + BME680
#define PIN_SCL              22    // I2C clock — ADS1115 + BME680

// ADS1115 I2C address (ADDR pin to GND)
#define ADS1115_ADDR         0x48
// BME680 I2C address (default)
#define BME680_ADDR          0x77

// ADS1115 channel mapping:
//   CH0 = Alphasense H2 ISB WE output (or MQ-8 A0)
//   CH1 = Alphasense H2 ISB AE output (baseline ref)
//   CH2 = Alphasense CO ISB WE output (or MQ-7 A0)
//   CH3 = Alphasense CO ISB AE output (baseline ref)
#define ADS_CH_H2_WE         0
#define ADS_CH_H2_AE         1
#define ADS_CH_CO_WE         2
#define ADS_CH_CO_AE         3

// ═══════════════════════════════════════════════════
//  SPI BUS (MAX31865 for PT100)
// ═══════════════════════════════════════════════════
#define PIN_SPI_CLK          18
#define PIN_SPI_MISO         19
#define PIN_SPI_MOSI         23
#define PIN_MAX_CS           5     // chip select for MAX31865

// PT100 config
#define RTD_NOMINAL          100.0  // PT100 = 100 ohms at 0C
#define RTD_REF_RESISTOR     430.0  // reference resistor on MAX31865 board
#define RTD_WIRES            3      // 2, 3, or 4 wire

// ═══════════════════════════════════════════════════
//  ANALOG INPUTS (direct ESP32 ADC — for VESDA + suppression)
// ═══════════════════════════════════════════════════
#define PIN_VESDA            36    // SVP — 4-20mA via 165R shunt or pot
#define PIN_SUPP_PRESSURE    39    // SVN — 4-20mA via 165R shunt or pot

#define VESDA_SHUNT          0.165
#define SUPP_SHUNT           0.165

// ═══════════════════════════════════════════════════
//  RELAY INPUTS (buttons for demo, opto-isolator for production)
// ═══════════════════════════════════════════════════
#define PIN_PANEL_ALARM      27
#define PIN_SUPP_DISCHARGE   26
#define PIN_DOOR             14
#define PIN_MANUAL_RELEASE   12

// ═══════════════════════════════════════════════════
//  OUTPUTS
// ═══════════════════════════════════════════════════
#define PIN_LEDS             25    // WS2812B data (via 470R if possible, works without for short runs)
#define PIN_BUZZER           13    // Active buzzer MODULE — just HIGH/LOW, no transistor
#define PIN_STATUS           2     // Onboard LED
#define PIN_RELAY_OUT        15    // Relay module signal pin

#define NUM_LEDS             8
#define LED_BRIGHTNESS       60

// ═══════════════════════════════════════════════════
//  GAS CALIBRATION
// ═══════════════════════════════════════════════════

// For Alphasense ISB boards: output is ~200-500mV at zero gas
// ADS1115 at gain 1 (default): 1 bit = 0.125 mV
// Conversion: ppm = (WE_mV - AE_mV - offset) * sensitivity
// These values are from the ISB calibration certificate
// UPDATE THESE from your specific ISB calibration data
#define H2_ISB_SENSITIVITY   1.8    // nA/ppm (from H2-AF datasheet, varies per unit)
#define H2_ISB_WE_ZERO_MV    230.0  // WE voltage at zero gas (from ISB cal cert)
#define CO_ISB_SENSITIVITY   3.5    // nA/ppm (from CO-AF datasheet)
#define CO_ISB_WE_ZERO_MV    350.0  // WE voltage at zero gas

// For MQ hobby sensor fallback (if using MQ-8/MQ-7 on ADS1115):
#define USE_MQ_FALLBACK      false  // set true if using MQ sensors instead of Alphasense
#define MQ_H2_SCALE          0.5    // ADC_voltage * scale = approx ppm
#define MQ_CO_SCALE           0.25

// VOC from BME680: gas resistance in kOhms
// Lower resistance = more VOCs
// Clean air baseline: ~50-200 kOhm
// VOC present: drops to 5-50 kOhm
#define BME_VOC_BASELINE_KOHM 100.0

// Default baselines
#define H2_BASELINE_DEFAULT  5.0
#define CO_BASELINE_DEFAULT  2.0
#define VOC_BASELINE_DEFAULT 50.0

// ═══════════════════════════════════════════════════
//  ALARM THRESHOLDS (same as before)
// ═══════════════════════════════════════════════════
#define H2_ALERT             15.0
#define CO_ALERT             10.0
#define VOC_ALERT            200.0
#define H2_CRITICAL          50.0
#define CO_CRITICAL          30.0
#define H2_EMERGENCY         150.0
#define CO_EMERGENCY         80.0
#define H2_RATE_CRITICAL     20.0
#define CO_RATE_CRITICAL     10.0
#define TEMP_RATE_CRITICAL   2.0

// ═══════════════════════════════════════════════════
//  SUPPRESSION
// ═══════════════════════════════════════════════════
#define SUPP_MAX_PRESSURE_BAR  42.0
#define SUPP_NOMINAL_PRESSURE  25.0
#define SUPP_LOW_PCT           80.0

// ═══════════════════════════════════════════════════
//  TIMING
// ═══════════════════════════════════════════════════
#define POLL_INTERVAL_MS     2000
#define SILENCE_DURATION     60000
