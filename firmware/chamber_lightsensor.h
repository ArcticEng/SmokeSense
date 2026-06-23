/*
 * chamber_lightsensor.h — Commodity dual-wavelength optical scatter chamber
 * Arctic Engineering — DataGuard v2.0
 *
 * A drop-in replacement for adpd4101.h that uses an off-the-shelf
 * TSL2591 high-dynamic-range light sensor (AMS, I2C 0x29) as the
 * detector instead of the ADPD4101 front-end. No analog design, no
 * import — built from parts stocked locally.
 *
 * PRINCIPLE
 *   The ESP32 pulses two LEDs into the chamber and the TSL2591 reads the
 *   light SCATTERED by smoke (the detector never sees the LED directly —
 *   the chamber baffles block the line of sight). The TSL2591 has two
 *   channels: CH0 = full spectrum (visible + IR), CH1 = IR only. We use
 *   that to separate the two wavelengths:
 *     • IR  850 nm scatter  ≈ CH1 (IR channel)
 *     • Blue 470 nm scatter ≈ visible = CH0 − CH1
 *   Reading each LED in its own time-slot, with a LED-off "dark" frame
 *   subtracted for ambient rejection, mimics the ADPD's synchronous,
 *   dual-wavelength measurement in firmware.
 *
 *   blue/IR ratio  → particle size → fire type (small=flaming, large=smouldering)
 *
 * WIRING
 *   TSL2591  SDA→GPIO21  SCL→GPIO22  (shared I2C bus, addr 0x29)  VIN→3V3  GND→GND
 *   IR LED   anode→GPIO32 via ~220Ω, cathode→GND
 *   Blue LED anode→GPIO33 via ~220Ω, cathode→GND
 *   (LEDs are driven directly from GPIO now, so the series resistors ARE
 *    required — unlike the ADPD which was a current sink.)
 *
 * NOTE: single detector → forward/back scatter ratio is not measured;
 * fwd_back_ratio is reported as 1.0 (neutral). Add a second TSL2591 on a
 * second bore later for the angular ratio. Everything else maps onto the
 * existing telemetry/classifier path unchanged.
 */

#pragma once
#include <Arduino.h>
#include <Wire.h>

// LED drive pins (override in dataguard_config.h if needed). Both are free GPIOs.
#ifndef PIN_CHAMBER_LED_IR
  #define PIN_CHAMBER_LED_IR   32
#endif
#ifndef PIN_CHAMBER_LED_BLUE
  #define PIN_CHAMBER_LED_BLUE 33
#endif

// Compatibility defines consumed by runtime_config.h defaults (keep names).
#define ADPD_SMOKE_FULLSCALE  2000.0f   // scatter counts ≈ 100% — TUNE on the bench
#define ADPD_SMOKE_THRESH_PCT 4.0f      // clean-air cutoff %

// ── TSL2591 register map ─────────────────────────────────────────────
#define TSL2591_ADDR     0x29
#define TSL2591_CMD      0xA0   // COMMAND | normal transaction
#define TSL2591_R_ENABLE 0x00
#define TSL2591_R_CONFIG 0x01
#define TSL2591_R_ID     0x12
#define TSL2591_R_C0DATA 0x14   // CH0 low; CH0H/CH1L/CH1H auto-increment
#define TSL2591_EN_PON   0x01
#define TSL2591_EN_AEN   0x02
#define TSL2591_GAIN_MED 0x10   // 25x
#define TSL2591_INT_100  0x00   // 100 ms integration
#define ADPD_BASELINE_SAMPLES 16
#define ADPD_EMA_ALPHA   0.35f

struct ADPDData {
    uint32_t fwd_ir, fwd_blue, back_ir, back_blue;        // scatter counts (back_* = 0, single detector)
    uint32_t bl_fwd_ir, bl_fwd_blue, bl_back_ir, bl_back_blue;
    float    scatter_delta;     // total scatter above clean-air baseline
    float    smoke_pct;         // 0–100 % obscuration
    float    ir_blue_ratio;     // blue/IR scatter
    float    fwd_back_ratio;    // 1.0 (single detector)
    uint8_t  particle_fire_hint;// 0 none 1 smoulder 2 flame 3 mixed
    bool          valid;
    unsigned long last_read;
};

class ChamberOptical {
public:
    ADPDData data = {};

    // Runtime-tunable (overridden live by config topic) — same names as ADPD4101.
    float smoke_fullscale  = ADPD_SMOKE_FULLSCALE;
    float smoke_thresh_pct = ADPD_SMOKE_THRESH_PCT;
    float irblue_small = 1.6f, irblue_large = 1.0f;
    float fwdback_small = 0.9f, fwdback_large = 1.5f;

    bool begin(TwoWire& wire = Wire) {
        _wire = &wire;
        pinMode(PIN_CHAMBER_LED_IR, OUTPUT);   digitalWrite(PIN_CHAMBER_LED_IR, LOW);
        pinMode(PIN_CHAMBER_LED_BLUE, OUTPUT); digitalWrite(PIN_CHAMBER_LED_BLUE, LOW);

        uint8_t id = readReg(TSL2591_R_ID);
        if (id != 0x50) {
            Serial.printf("[CHAMBER] TSL2591 ID 0x%02X (expected 0x50) — not responding, check VIN/GND/SDA(D21)/SCL(D22) @0x29\n", id);
            data.valid = false;
            return false;   // honest failure: don't report a chamber that isn't there
        }
        writeReg(TSL2591_R_CONFIG, TSL2591_GAIN_MED | TSL2591_INT_100);
        writeReg(TSL2591_R_ENABLE, TSL2591_EN_PON | TSL2591_EN_AEN);
        delay(120);

        captureBaseline();
        data.valid = true;
        Serial.println("[CHAMBER] TSL2591 optical chamber initialised");
        return true;
    }

    // Full dual-wavelength read cycle (~3 × integration time). Call each sample.
    bool update() {
        if (!_wire) return false;
        float ir_raw, blue_raw;
        if (!readScatter(ir_raw, blue_raw)) return false;

        _ema(ir_raw, _f_ir);
        _ema(blue_raw, _f_blue);

        float total = _f_ir + _f_blue;
        float delta = fmaxf(0.0f, total - _baseline);
        data.scatter_delta = delta;
        data.smoke_pct = constrain((delta / smoke_fullscale) * 100.0f, 0.0f, 100.0f);
        data.ir_blue_ratio = _f_blue / fmaxf(_f_ir, 1.0f);
        data.fwd_back_ratio = 1.0f; // single detector — no angular ratio

        data.fwd_ir   = (uint32_t)_f_ir;
        data.fwd_blue = (uint32_t)_f_blue;
        data.back_ir  = 0; data.back_blue = 0;

        if (data.smoke_pct < smoke_thresh_pct) {
            data.particle_fire_hint = 0;
        } else {
            bool large = (data.ir_blue_ratio < irblue_large);
            bool small = (data.ir_blue_ratio > irblue_small);
            if (large && !small)      data.particle_fire_hint = 1; // smouldering
            else if (small && !large) data.particle_fire_hint = 2; // flaming
            else                      data.particle_fire_hint = 3; // mixed
        }
        data.last_read = millis();
        return true;
    }

    bool isConnected() { return data.valid && (millis() - data.last_read < 5000); }
    void recalibrate() { captureBaseline(); }

private:
    TwoWire* _wire = nullptr;
    float _f_ir = 0, _f_blue = 0, _baseline = 0;
    const uint16_t INTEG_MS = 120; // 100 ms integration + margin

    // One dark / IR / blue cycle → ambient-rejected, wavelength-separated scatter.
    bool readScatter(float& ir_out, float& blue_out) {
        uint16_t f_d, i_d, f_ir, i_ir, f_bl, i_bl;
        digitalWrite(PIN_CHAMBER_LED_IR, LOW); digitalWrite(PIN_CHAMBER_LED_BLUE, LOW);
        delay(INTEG_MS); if (!readChannels(f_d, i_d)) return false;        // dark
        digitalWrite(PIN_CHAMBER_LED_IR, HIGH);
        delay(INTEG_MS); readChannels(f_ir, i_ir);                          // IR slot
        digitalWrite(PIN_CHAMBER_LED_IR, LOW);
        digitalWrite(PIN_CHAMBER_LED_BLUE, HIGH);
        delay(INTEG_MS); readChannels(f_bl, i_bl);                          // blue slot
        digitalWrite(PIN_CHAMBER_LED_BLUE, LOW);

        // IR 850 nm → IR channel (CH1); Blue 470 nm → visible (CH0 − CH1).
        ir_out   = fmaxf(0.0f, (float)i_ir - (float)i_d);
        float vis_bl = (float)f_bl - (float)i_bl;
        float vis_d  = (float)f_d  - (float)i_d;
        blue_out = fmaxf(0.0f, vis_bl - vis_d);
        return true;
    }

    void captureBaseline() {
        float sir = 0, sbl = 0; uint16_t n = 0;
        for (uint16_t k = 0; k < ADPD_BASELINE_SAMPLES; k++) {
            float ir, bl;
            if (readScatter(ir, bl)) { sir += ir; sbl += bl; n++; }
        }
        if (n == 0) n = 1;
        _f_ir = sir / n; _f_blue = sbl / n;
        _baseline = _f_ir + _f_blue;
        data.bl_fwd_ir = (uint32_t)_f_ir; data.bl_fwd_blue = (uint32_t)_f_blue;
        data.bl_back_ir = 0; data.bl_back_blue = 0;
        Serial.printf("[CHAMBER] Baseline: IR=%.0f Blue=%.0f total=%.0f (n=%u)\n",
                      _f_ir, _f_blue, _baseline, n);
    }

    // ── TSL2591 I2C ──
    void writeReg(uint8_t reg, uint8_t val) {
        _wire->beginTransmission(TSL2591_ADDR);
        _wire->write(TSL2591_CMD | reg);
        _wire->write(val);
        _wire->endTransmission();
    }
    uint8_t readReg(uint8_t reg) {
        _wire->beginTransmission(TSL2591_ADDR);
        _wire->write(TSL2591_CMD | reg);
        _wire->endTransmission(false);
        _wire->requestFrom((int)TSL2591_ADDR, 1);
        return _wire->available() ? _wire->read() : 0xFF;
    }
    // Reads CH0 (full) and CH1 (IR) — 4 bytes auto-incremented from C0DATAL.
    bool readChannels(uint16_t& ch0, uint16_t& ch1) {
        _wire->beginTransmission(TSL2591_ADDR);
        _wire->write(TSL2591_CMD | TSL2591_R_C0DATA);
        _wire->endTransmission(false);
        _wire->requestFrom((int)TSL2591_ADDR, 4);
        if (_wire->available() < 4) return false;
        uint8_t c0l = _wire->read(), c0h = _wire->read();
        uint8_t c1l = _wire->read(), c1h = _wire->read();
        ch0 = (uint16_t)c0l | ((uint16_t)c0h << 8);
        ch1 = (uint16_t)c1l | ((uint16_t)c1h << 8);
        return true;
    }
    void _ema(float raw, float& filt) { filt = ADPD_EMA_ALPHA * raw + (1.0f - ADPD_EMA_ALPHA) * filt; }
};

// Drop-in alias so existing `ADPD4101 adpd;` declarations keep compiling.
typedef ChamberOptical ADPD4101;
