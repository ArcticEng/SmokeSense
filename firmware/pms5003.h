/*
 * pms5003.h — PMS5003 Laser Particle Sensor Driver
 * Arctic Engineering — DataGuard v2.0
 *
 * Reads PM1.0, PM2.5, PM10 + particle count bins via UART.
 * Provides fire type classification based on particle size ratio:
 *   - High PM10 / low PM1.0 = smouldering (large cool particles)
 *   - High PM1.0 / low PM10 = flaming (small hot particles)
 *   - Overall concentration = smoke density / severity
 *
 * Wiring: PMS5003 TX → ESP32 GPIO16 (RX2), VCC → 5V, GND → GND
 * Protocol: 9600 baud UART, 32-byte frames, header 0x42 0x4D
 */

#pragma once
#include <Arduino.h>

// PMS5003 data frame structure
struct PMSData {
    // Concentration (μg/m³) — standard particle
    uint16_t pm1_0_std;
    uint16_t pm2_5_std;
    uint16_t pm10_std;

    // Concentration (μg/m³) — atmospheric environment
    uint16_t pm1_0_atm;
    uint16_t pm2_5_atm;
    uint16_t pm10_atm;

    // Particle count per 0.1L of air
    uint16_t cnt_0_3um;   // > 0.3μm
    uint16_t cnt_0_5um;   // > 0.5μm
    uint16_t cnt_1_0um;   // > 1.0μm
    uint16_t cnt_2_5um;   // > 2.5μm
    uint16_t cnt_5_0um;   // > 5.0μm
    uint16_t cnt_10um;    // > 10μm

    // Derived metrics for fire classification
    float smoke_density;      // 0-100% — overall particle load
    float pm1_pm10_ratio;     // <0.3 = smouldering, >0.7 = flaming
    bool  is_smoke;           // particles significantly above baseline
    
    // Fire type hint from particle analysis alone
    // 0=none, 1=smouldering, 2=flaming, 3=mixed
    uint8_t particle_fire_hint;

    bool valid;               // true if last read was successful
    unsigned long last_read;  // millis() of last successful read
};

// Baseline particle counts (clean air reference)
#define PMS_BASELINE_PM25    12    // typical indoor PM2.5 in μg/m³
#define PMS_SMOKE_THRESH     50    // PM2.5 above this = smoke present
#define PMS_HEAVY_SMOKE     200    // PM2.5 above this = heavy smoke
#define PMS_DENSITY_MAX     500    // PM2.5 at which density = 100%

class PMS5003 {
public:
    PMSData data = {};

    void begin(HardwareSerial& serial, int rxPin, int txPin) {
        _serial = &serial;
        _serial->begin(9600, SERIAL_8N1, rxPin, txPin);
        delay(100);
        Serial.println("[PMS5003] UART started on RX=" + String(rxPin));
    }

    // Call every loop cycle — reads available bytes and parses frames
    bool update() {
        if (!_serial) return false;

        while (_serial->available()) {
            uint8_t b = _serial->read();

            if (_idx == 0 && b != 0x42) continue;  // Wait for start byte 1
            if (_idx == 1 && b != 0x4D) { _idx = 0; continue; } // Start byte 2

            _buf[_idx++] = b;

            if (_idx == 32) {
                _idx = 0;
                if (parseFrame()) {
                    calculateMetrics();
                    data.valid = true;
                    data.last_read = millis();
                    return true;
                }
            }
        }
        
        // Mark as stale if no data for 5 seconds
        if (data.valid && millis() - data.last_read > 5000) {
            data.valid = false;
        }
        
        return false;
    }

    bool isConnected() {
        return data.valid && (millis() - data.last_read < 5000);
    }

private:
    HardwareSerial* _serial = nullptr;
    uint8_t _buf[32];
    uint8_t _idx = 0;

    bool parseFrame() {
        // Verify checksum
        uint16_t checksum = 0;
        for (int i = 0; i < 30; i++) checksum += _buf[i];
        uint16_t expected = (_buf[30] << 8) | _buf[31];
        if (checksum != expected) return false;

        // Parse data fields (big-endian uint16)
        data.pm1_0_std  = (_buf[4] << 8) | _buf[5];
        data.pm2_5_std  = (_buf[6] << 8) | _buf[7];
        data.pm10_std   = (_buf[8] << 8) | _buf[9];
        data.pm1_0_atm  = (_buf[10] << 8) | _buf[11];
        data.pm2_5_atm  = (_buf[12] << 8) | _buf[13];
        data.pm10_atm   = (_buf[14] << 8) | _buf[15];
        data.cnt_0_3um  = (_buf[16] << 8) | _buf[17];
        data.cnt_0_5um  = (_buf[18] << 8) | _buf[19];
        data.cnt_1_0um  = (_buf[20] << 8) | _buf[21];
        data.cnt_2_5um  = (_buf[22] << 8) | _buf[23];
        data.cnt_5_0um  = (_buf[24] << 8) | _buf[25];
        data.cnt_10um   = (_buf[26] << 8) | _buf[27];

        return true;
    }

    void calculateMetrics() {
        // Smoke density: 0-100% based on PM2.5 concentration
        float pm25 = (float)data.pm2_5_atm;
        data.smoke_density = constrain((pm25 / PMS_DENSITY_MAX) * 100.0f, 0.0f, 100.0f);

        // Is this smoke or just normal indoor air?
        data.is_smoke = (pm25 > PMS_SMOKE_THRESH);

        // PM1.0 / PM10 ratio — key fire type discriminator
        float pm1 = max((float)data.pm1_0_atm, 1.0f);
        float pm10 = max((float)data.pm10_atm, 1.0f);
        data.pm1_pm10_ratio = pm1 / pm10;

        // Fire type hint from particles alone:
        // Smouldering: large particles dominate (ratio < 0.3)
        // Flaming: small particles dominate (ratio > 0.7)
        // Mixed: roughly equal (0.3 - 0.7)
        if (!data.is_smoke) {
            data.particle_fire_hint = 0;  // No smoke
        } else if (data.pm1_pm10_ratio < 0.3f) {
            data.particle_fire_hint = 1;  // Smouldering
        } else if (data.pm1_pm10_ratio > 0.7f) {
            data.particle_fire_hint = 2;  // Flaming
        } else {
            data.particle_fire_hint = 3;  // Mixed / transitioning
        }
    }
};
