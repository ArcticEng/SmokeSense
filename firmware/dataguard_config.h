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
#define WIFI_SSID           "2.4g-unit116-dockroad-ftta"
#define WIFI_PASS           "swifthamster79"
#define WIFI_CONNECT_TIMEOUT 15000
#define AP_PASS              "dataguard2026"

// ─── MQTT ────────────────────────────────────────
#define MQTT_HOST            "switchback.proxy.rlwy.net"
#define MQTT_PORT            35720
#define MQTT_USER            "dataguard"
#define MQTT_PASS            "DG_Device_Secret_2026!"
#define MQTT_ORG_ID          "demo"

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

// External VESDA / aspirating smoke detector present on PIN_VESDA?
//   true  = monitor the external VESDA system as its own channel
//   false = no VESDA; the optical chamber (or PMS5003) is the smoke source
// Either way, the optical chamber still provides particle classification
// and can independently escalate smoke.
#define VESDA_PRESENT        true

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
#define H2_ISB_SENSITIVITY   1.8f   // nA/ppm (from H2-AF datasheet, varies per unit)
#define H2_ISB_WE_ZERO_MV    230.0  // WE voltage at zero gas (from ISB cal cert)
#define CO_ISB_SENSITIVITY   3.5f   // nA/ppm (from CO-AF datasheet)
#define CO_ISB_WE_ZERO_MV    350.0  // WE voltage at zero gas

// Set false if NO gas sensors are fitted (neither Alphasense nor MQ-7/MQ-8).
// Forces H2/CO to zero so unconnected/floating ADS inputs can't produce false
// gas readings — the classifier then simply runs without the gas channels.
#define GAS_PRESENT          true   // ADS1115 + MQ-7/MQ-8 fitted

// For MQ hobby sensor fallback (if using MQ-8/MQ-7 on ADS1115):
#define USE_MQ_FALLBACK      true   // using MQ-7 (CO) + MQ-8 (H2) on the ADS1115
#define MQ_H2_SCALE          0.5    // ADC_voltage * scale = approx ppm
#define MQ_CO_SCALE           0.25

// VOC from BME680: gas resistance in kOhms
// Lower resistance = more VOCs
// Clean air baseline: ~50-200 kOhm
// VOC present: drops to 5-50 kOhm
#define BME_VOC_BASELINE_KOHM 100.0

// MOX gas (VOC) sensor warm-up. The BME680/688 hot-plate reads artificially
// LOW resistance (= fake HIGH VOC) on cold start and needs to burn in. During
// this window VOC is forced to 0 and the clean-air baseline is seeded, so the
// classifier doesn't false-alarm an "Electrical fault" at boot.
#define VOC_WARMUP_MS         180000   // 3 minutes

// BME680/688 temperature offset (°C). The gas hot-plate self-heats the die so
// the reported temp reads several degrees high — worse when the board sits
// near the ESP32. Calibrate: compare the dashboard temp to a reference
// thermometer in the same air, then set this to (reference - reported).
// e.g. dashboard 32.5, room 25.0  ->  set to -7.5
#define BME_TEMP_OFFSET       0.0f

// MQ-7/MQ-8 heater warm-up. The heaters read falsely high until warm, so for
// this window gas is forced to zero and the clean-air baseline is seeded.
// After it, the baseline auto-zeros DOWNWARD only (tracks settling/clean air)
// but holds against upward excursions, so a real H2/CO rise is still detected.
#define GAS_WARMUP_MS         180000   // 3 minutes

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
//  PROTOTYPE MODE — set true when using pots instead of 4-20mA
// ═══════════════════════════════════════════════════
#define VESDA_USE_POT        true   // true = 10K pot, false = 4-20mA with shunt
#define SUPP_USE_POT         true   // true = pot/wire, false = 4-20mA with shunt

// ═══════════════════════════════════════════════════
//  PARTICLE DETECTION (PMS5003 laser sensor)
//  Replaces external VESDA when not available.
//  Gives PM1.0, PM2.5, PM10 + 6 size bins.
//  PM1/PM10 ratio distinguishes fire type.
// ═══════════════════════════════════════════════════
#define PIN_PMS_RX           16    // ESP32 RX2 ← PMS5003 TX
#define PIN_PMS_TX           17    // ESP32 TX2 → PMS5003 RX (optional)
#define USE_PMS5003          false // set true when PMS5003 connected
// When USE_PMS5003 is true, the PMS5003 replaces the VESDA
// pot/4-20mA input as the smoke detection source.
// Both can coexist: PMS5003 provides particle classification,
// VESDA provides external system confirmation.

// ═══════════════════════════════════════════════════
//  OPTICAL SCATTER CHAMBER (ADPD4101)
//  Custom dual-wavelength chamber via Analog Devices ADPD4101
//  optical front end on the existing I2C bus (addr 0x24).
//  When enabled, becomes the primary smoke + particle source
//  and feeds the classifier like the PMS5003 does.
// ═══════════════════════════════════════════════════
#define USE_ADPD4101         true  // TSL2591 chamber: pulses IR(D32)+blue(D33) LEDs, reads scatter @0x29

// Offline telemetry buffer (LittleFS). Keep false unless you need the device to
// store readings to flash while MQTT is down — a corrupt flash FS crashes the
// writer (lfs_alloc divide-by-zero). The device is fine online without it.
#define USE_OFFLINE_BUFFER   false
#define ADPD4101_ADDR        0x24

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
