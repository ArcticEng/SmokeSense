/*
 * adpd4101.h — ADPD4101 Dual-Wavelength Optical Scatter Chamber Driver
 * Arctic Engineering — DataGuard v2.0
 *
 * Reads a custom dual-wavelength forward/back scatter smoke chamber built
 * around the Analog Devices ADPD4101 multimodal optical front end.
 *
 * The ADPD4101 does ALL the analog work: it pulses the LEDs, reads the
 * photodiodes through its on-chip transimpedance amps + 14-bit ADC, rejects
 * ambient light by synchronous detection, and exposes results over I2C.
 * No external transimpedance amplifiers, no ESP32 ADC reads.
 *
 * CHAMBER OPTICS  (your existing 65mm PETG chamber bores):
 *   IR  LED  (850nm) at   0°  -> ADPD LED driver  LEDX1   (time slot A illum)
 *   Blue LED (470nm) at 340°  -> ADPD LED driver  LEDX2   (time slot B illum)
 *   Forward PD       at  25°  -> ADPD input pair  IN1  (single-ended)
 *   Backward PD      at 135°  -> ADPD input pair  IN2  (single-ended)
 *
 * TIME-SLOT PLAN (4 scatter measurements per cycle):
 *   Slot A: IR   LED on, sample IN1 (fwd) and IN2 (back) -> fwd_ir,  back_ir
 *   Slot B: Blue LED on, sample IN1 (fwd) and IN2 (back) -> fwd_blue, back_blue
 *
 * WIRING TO ESP32 (shares existing I2C bus — no GPIO conflict):
 *   ADPD SDA -> GPIO 21   (same bus as ADS1115 0x48, BME680 0x77)
 *   ADPD SCL -> GPIO 22
 *   ADPD GPIO0/INT -> (optional) any free GPIO for data-ready
 *   VDD 1.8/3.3V, VLED from a separate clean 3.3–5V rail (LED pulses are noisy)
 *   I2C address: 0x24 (default)
 *
 * IMPORTANT — REGISTER CONFIGURATION:
 *   The ADPD4101 has a large register map (time slots, LED currents, pulse
 *   counts, integration windows, FIFO format). The exact values for YOUR
 *   chamber must be generated, not guessed:
 *     1. Wire the chamber to the EVAL-ADPD4101-ARDZ breakout.
 *     2. Open ADI's Wavetool GUI, configure 2 slots / 2 inputs / your LED
 *        currents, and tune until forward/back scatter is clean.
 *     3. Export the register set and paste it into ADPD_INIT[] below.
 *   The addresses marked "VERIFY" must be confirmed against the ADPD4101
 *   datasheet for the silicon revision you receive.
 */

#pragma once
#include <Arduino.h>
#include <Wire.h>

#define ADPD4101_I2C_ADDR     0x24    // default 7-bit address

// --- Register addresses (VERIFY against ADPD4101 datasheet / Wavetool) -------
// These are the registers the driver touches at runtime. Configuration
// registers live entirely in ADPD_INIT[] exported from Wavetool.
#define ADPD_REG_FIFO_STATUS  0x00    // VERIFY: FIFO byte count / status
#define ADPD_REG_CHIP_ID      0x08    // VERIFY: device ID (sanity check on begin)
#define ADPD_REG_OPMODE       0x10    // VERIFY: 0=standby, 1=active/go
#define ADPD_REG_FIFO_DATA    0x2F    // VERIFY: FIFO read register
#define ADPD_CHIP_ID_EXPECTED 0xC0    // VERIFY: expected ID value

// --- Per-chamber tuning (clean-air calibration + scaling) --------------------
#define ADPD_BASELINE_SAMPLES 64      // averaged at begin() for clean-air zero
#define ADPD_SMOKE_FULLSCALE  60000.0f// total scatter counts ~= 100% obscuration
#define ADPD_SMOKE_THRESH_PCT 4.0f    // below this = clean air, hint = none
#define ADPD_EMA_ALPHA        0.30f   // smoothing on the live signal

struct ADPDData {
    // Raw synchronous-detected scatter counts (ambient already rejected by chip)
    uint32_t fwd_ir;       // forward PD, IR illumination
    uint32_t fwd_blue;     // forward PD, blue illumination
    uint32_t back_ir;      // backward PD, IR illumination
    uint32_t back_blue;    // backward PD, blue illumination

    // Clean-air baselines (captured at begin(), updated slowly in clean air)
    uint32_t bl_fwd_ir, bl_fwd_blue, bl_back_ir, bl_back_blue;

    // Derived metrics (these map onto the existing telemetry JSON keys)
    float    scatter_delta;     // total scatter above baseline -> d["delta"]
    float    smoke_pct;         // 0-100% obscuration  -> classifier vesda_pct input
    float    ir_blue_ratio;     // blue/IR scatter     -> d["ir_blue"]
    float    fwd_back_ratio;    // forward/back scatter -> d["fwd_back"]

    // Fire-type hint from optical signature (matches PMS5003 convention)
    //   0=none  1=smouldering(large particles)  2=flaming(small)  3=mixed
    uint8_t  particle_fire_hint;

    bool          valid;
    unsigned long last_read;
};

class ADPD4101 {
public:
    ADPDData data = {};

    // Runtime-tunable beam sensitivity (overridden live by config topic).
    float smoke_fullscale  = ADPD_SMOKE_FULLSCALE;  // lower = more sensitive
    float smoke_thresh_pct = ADPD_SMOKE_THRESH_PCT;  // clean-air cutoff %
    float irblue_small = 1.6f, irblue_large = 1.0f;  // blue/IR ratio cutoffs
    float fwdback_small = 0.9f, fwdback_large = 1.5f; // fwd/back ratio cutoffs

    bool begin(TwoWire& wire = Wire) {
        _wire = &wire;

        // Sanity: read chip ID
        uint16_t id = readReg(ADPD_REG_CHIP_ID);
        if ((id & 0xFF) != ADPD_CHIP_ID_EXPECTED) {
            Serial.printf("[ADPD4101] ID mismatch: 0x%04X (check wiring/addr)\n", id);
            // Don't hard-fail — some revisions report differently. Continue.
        }

        // Load the Wavetool-exported configuration
        loadConfig();

        // Capture clean-air baseline (chamber MUST be clean at boot)
        captureBaseline();

        data.valid = true;
        Serial.println("[ADPD4101] Optical chamber initialised");
        return true;
    }

    // Call every sample cycle. Reads the 4 channels and recomputes metrics.
    bool update() {
        if (!_wire) return false;

        // Pull one full result set from the FIFO. The exact FIFO unpacking
        // depends on your Wavetool sample format (bytes per slot/channel).
        // readResultSet() returns false if a full frame isn't ready yet.
        if (!readResultSet()) return false;

        // Smoothing
        _ema(data.fwd_ir,   _f_fwd_ir);
        _ema(data.fwd_blue, _f_fwd_blue);
        _ema(data.back_ir,  _f_back_ir);
        _ema(data.back_blue,_f_back_blue);

        calculateMetrics();
        data.last_read = millis();
        return true;
    }

    bool isConnected() {
        return data.valid && (millis() - data.last_read < 5000);
    }

    // Re-zero the chamber on operator command (clean-air recalibration)
    void recalibrate() { captureBaseline(); }

private:
    TwoWire* _wire = nullptr;
    float _f_fwd_ir = 0, _f_fwd_blue = 0, _f_back_ir = 0, _f_back_blue = 0;

    // ---- Wavetool-exported register init -----------------------------------
    // PASTE your exported {address, value} pairs here. The array below is a
    // STRUCTURE PLACEHOLDER — the values are not valid for your optics yet.
    struct RegPair { uint8_t addr; uint16_t val; };
    void loadConfig() {
        static const RegPair ADPD_INIT[] = {
            // { 0x10, 0x0001 },   // example: enter program mode  (VERIFY)
            // { 0x.., 0x.... },   // <-- paste Wavetool export here
            // { ADPD_REG_OPMODE, 0x0001 }, // go to active mode (last)
        };
        for (auto& r : ADPD_INIT) writeReg(r.addr, r.val);
        // If ADPD_INIT is empty the chip stays in default mode — wire up
        // Wavetool first and export before expecting real readings.
    }

    void captureBaseline() {
        uint64_t s_fi = 0, s_fb = 0, s_bi = 0, s_bb = 0;
        uint16_t n = 0;
        unsigned long t0 = millis();
        while (n < ADPD_BASELINE_SAMPLES && millis() - t0 < 3000) {
            if (readResultSet()) {
                s_fi += data.fwd_ir;  s_fb += data.fwd_blue;
                s_bi += data.back_ir; s_bb += data.back_blue;
                n++;
            }
        }
        if (n == 0) n = 1;
        data.bl_fwd_ir   = s_fi / n;  data.bl_fwd_blue = s_fb / n;
        data.bl_back_ir  = s_bi / n;  data.bl_back_blue = s_bb / n;
        _f_fwd_ir = data.bl_fwd_ir;   _f_fwd_blue = data.bl_fwd_blue;
        _f_back_ir = data.bl_back_ir; _f_back_blue = data.bl_back_blue;
        Serial.printf("[ADPD4101] Baseline: fIR=%lu fBl=%lu bIR=%lu bBl=%lu (n=%u)\n",
            data.bl_fwd_ir, data.bl_fwd_blue, data.bl_back_ir, data.bl_back_blue, n);
    }

    void calculateMetrics() {
        // Scatter above clean-air baseline, clamped at >=0
        float d_fwd_ir   = fmaxf(0.0f, _f_fwd_ir   - data.bl_fwd_ir);
        float d_fwd_blue = fmaxf(0.0f, _f_fwd_blue - data.bl_fwd_blue);
        float d_back_ir  = fmaxf(0.0f, _f_back_ir  - data.bl_back_ir);
        float d_back_blue= fmaxf(0.0f, _f_back_blue- data.bl_back_blue);

        float total_scatter = d_fwd_ir + d_fwd_blue + d_back_ir + d_back_blue;
        data.scatter_delta = total_scatter;

        // Obscuration / smoke percentage
        data.smoke_pct = constrain((total_scatter / smoke_fullscale) * 100.0f,
                                    0.0f, 100.0f);

        // Wavelength ratio: blue scatters more off SMALL particles than IR.
        //   blue/IR high  -> small particles (flaming soot)
        //   blue/IR ~1    -> larger particles (smouldering)
        float ir_sum   = fmaxf(d_fwd_ir + d_back_ir, 1.0f);
        float blue_sum = d_fwd_blue + d_back_blue;
        data.ir_blue_ratio = blue_sum / ir_sum;

        // Angular ratio: forward lobe dominates for LARGE particles (Mie),
        // backscatter relatively stronger for small particles.
        //   fwd/back high -> large particles (smouldering)
        //   fwd/back low  -> small particles (flaming)
        float back_sum = fmaxf(d_back_ir + d_back_blue, 1.0f);
        float fwd_sum  = d_fwd_ir + d_fwd_blue;
        data.fwd_back_ratio = fwd_sum / back_sum;

        // Fire-type hint (same codes as PMS5003: 1=smoulder 2=flame 3=mixed)
        if (data.smoke_pct < smoke_thresh_pct) {
            data.particle_fire_hint = 0;
        } else {
            bool large = (data.ir_blue_ratio < irblue_large) || (data.fwd_back_ratio > fwdback_large);
            bool small = (data.ir_blue_ratio > irblue_small) || (data.fwd_back_ratio < fwdback_small);
            if (large && !small)      data.particle_fire_hint = 1; // smouldering
            else if (small && !large) data.particle_fire_hint = 2; // flaming
            else                      data.particle_fire_hint = 3; // mixed
        }
    }

    // ---- Low-level I2C ------------------------------------------------------
    // ADPD4101 uses 16-bit data words. Confirm the address byte width and
    // FIFO unpacking against the datasheet for your part revision.
    uint16_t readReg(uint8_t reg) {
        _wire->beginTransmission(ADPD4101_I2C_ADDR);
        _wire->write(reg);
        _wire->endTransmission(false);
        _wire->requestFrom((int)ADPD4101_I2C_ADDR, 2);
        uint16_t hi = _wire->read();
        uint16_t lo = _wire->read();
        return (hi << 8) | lo;
    }

    void writeReg(uint8_t reg, uint16_t val) {
        _wire->beginTransmission(ADPD4101_I2C_ADDR);
        _wire->write(reg);
        _wire->write(val >> 8);
        _wire->write(val & 0xFF);
        _wire->endTransmission();
    }

    // Read one complete 4-channel result set from the FIFO.
    // Replace the body with the FIFO unpack matching your Wavetool sample
    // format (typically 2–4 bytes per channel per slot). Returns false until
    // a full frame is available.
    bool readResultSet() {
        uint16_t fifo_bytes = readReg(ADPD_REG_FIFO_STATUS) & 0x07FF; // VERIFY mask
        const uint16_t FRAME_BYTES = 8; // VERIFY: 4 channels * bytes/channel
        if (fifo_bytes < FRAME_BYTES) return false;

        // Example unpack assuming 16-bit per channel, order: A-IN1, A-IN2,
        // B-IN1, B-IN2 (IR-fwd, IR-back, Blue-fwd, Blue-back). VERIFY order
        // against your slot configuration.
        data.fwd_ir    = readReg(ADPD_REG_FIFO_DATA);
        data.back_ir   = readReg(ADPD_REG_FIFO_DATA);
        data.fwd_blue  = readReg(ADPD_REG_FIFO_DATA);
        data.back_blue = readReg(ADPD_REG_FIFO_DATA);
        return true;
    }

    void _ema(uint32_t raw, float& filt) {
        filt = ADPD_EMA_ALPHA * (float)raw + (1.0f - ADPD_EMA_ALPHA) * filt;
    }
};
