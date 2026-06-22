"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";

// Mirrors firmware config_set_defaults() — used to seed the editor when a
// device has not yet reported its config.
const DEFAULT_CONFIG: Record<string, any> = {
  vesda_present: true, use_adpd: false, use_pms: false,
  h2_alert: 15, co_alert: 10, voc_alert: 200,
  h2_critical: 50, co_critical: 30, h2_emergency: 150, co_emergency: 80,
  h2_rate_critical: 20, temp_rate_critical: 2,
  thr_h2_low: 10, thr_h2_high: 50, thr_co_low: 10, thr_co_high: 35,
  thr_voc_low: 200, thr_voc_high: 500, thr_temprate_low: 0.5, thr_temprate_high: 2,
  thr_vesda_low: 5, thr_vesda_high: 25, thr_humidity_high: 80,
  conf_alert: 30, conf_prealarm: 55, conf_critical: 75, conf_emergency: 90,
  adpd_fullscale: 60000, adpd_smoke_thresh: 4,
  irblue_small: 1.6, irblue_large: 1.0, fwdback_small: 0.9, fwdback_large: 1.5,
  poll_ms: 2000,
};

const STAGE = ["Monitor", "Alert", "Pre-Alarm", "Critical", "Emergency"];
const STAGE_COLOR = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#dc2626"];

// ─── Faithful TS port of fire_classifier.h::classify() ───────────────
// Signature weights [h2, co, voc, temp_rate, vesda] per fire type.
const SIGNATURES = [
  [0, 0, 0, 0, 0],
  [0.1, 0.1, 0.2, 0.1, 0.5],
  [0.55, 0.05, 0.25, 0.1, 0.05],
  [0.3, 0.2, 0.25, 0.15, 0.1],
  [0.05, 0.35, 0.15, 0.1, 0.35],
  [0.05, 0.15, 0.2, 0.3, 0.3],
  [0.05, 0.2, 0.45, 0.15, 0.15],
];
const FIRE_LABELS = ["Normal", "Nuisance (false alarm)", "Battery off-gas (early)", "Battery thermal runaway", "Smouldering fire", "Flaming fire", "Electrical fault"];
const ACTION_LABELS = ["Monitoring", "Alert — investigate", "Pre-alarm — prepare", "Critical — suppression", "Emergency — evacuate"];

function normalize(v: number, low: number, high: number) {
  if (v <= 0 || v <= low) return 0;
  if (v >= high) return 1;
  return (v - low) / (high - low);
}

interface TestInputs {
  h2: number; co: number; voc: number; tempRate: number; smoke: number; humidity: number;
  panel: boolean; discharged: boolean; sustained: number; pmsHint: number;
}

function classify(inp: TestInputs, c: Record<string, number>, pmsConnected: boolean) {
  const s = {
    h2: normalize(inp.h2, c.thr_h2_low, c.thr_h2_high),
    co: normalize(inp.co, c.thr_co_low, c.thr_co_high),
    voc: normalize(inp.voc, c.thr_voc_low, c.thr_voc_high),
    temp: normalize(inp.tempRate, c.thr_temprate_low, c.thr_temprate_high),
    vesda: normalize(inp.smoke, c.thr_vesda_low, c.thr_vesda_high),
  };
  const arr = [s.h2, s.co, s.voc, s.temp, s.vesda];
  let active = arr.filter((x) => x > 0.1).length;
  let best = 0, bestType = 0;
  const match = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 1; i < 7; i++) {
    const w = SIGNATURES[i];
    const sc = s.h2 * w[0] + s.co * w[1] + s.voc * w[2] + s.temp * w[3] + s.vesda * w[4];
    match[i] = sc * 100;
    if (sc > best) { best = sc; bestType = i; }
  }
  let conf = best * 100;
  if (pmsConnected && inp.smoke > 5) {
    if (inp.pmsHint === 1 && (bestType === 4 || bestType === 1)) { conf += 15; if (bestType === 1) bestType = 4; }
    if (inp.pmsHint === 2 && (bestType === 5 || bestType === 1)) { conf += 15; if (bestType === 1) bestType = 5; }
    if (inp.pmsHint > 0) active++;
  }
  const MULT = [0, 0.35, 0.65, 0.85, 0.95, 1.0];
  const mult = active <= 5 ? MULT[active] : 1.0;
  conf = conf * mult;
  let confirmed = false;
  if (bestType !== 0) {
    if (inp.sustained >= 1) conf += 10;
    if (inp.sustained >= 2) { conf += 20; confirmed = true; }
  }
  if (inp.humidity > c.thr_humidity_high && s.vesda > 0.3) conf *= 0.6;
  if (inp.panel && conf > 20) conf = Math.max(conf, 75);
  if (inp.discharged) { conf = 100; if (bestType === 0) bestType = 3; }
  conf = Math.min(100, Math.max(0, conf));
  let action = 0;
  if (conf < c.conf_alert) action = 0;
  else if (conf < c.conf_prealarm) action = 1;
  else if (conf < c.conf_critical) action = 2;
  else if (conf < c.conf_emergency) action = 3;
  else action = 4;
  if (active <= 1 && bestType === 1 && action > 1) action = 1;
  const fireType = conf < 10 ? 0 : bestType;
  return { s, active, mult, match, raw: best * 100, confidence: conf, action, fireType, confirmed };
}

interface Field { key: string; label: string; type?: "bool" | "num"; step?: number; }
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Features", fields: [
    { key: "vesda_present", label: "External VESDA present", type: "bool" },
    { key: "use_adpd", label: "Optical chamber (ADPD4101)", type: "bool" },
    { key: "use_pms", label: "PMS5003 particle sensor", type: "bool" },
  ]},
  { title: "Optical beam sensitivity", fields: [
    { key: "adpd_fullscale", label: "Scatter full-scale (↓ = more sensitive)", step: 1000 },
    { key: "adpd_smoke_thresh", label: "Clean-air cutoff %", step: 0.5 },
    { key: "irblue_large", label: "Blue/IR ≤ → smouldering", step: 0.05 },
    { key: "irblue_small", label: "Blue/IR ≥ → flaming", step: 0.05 },
    { key: "fwdback_large", label: "Fwd/Back ≥ → smouldering", step: 0.05 },
    { key: "fwdback_small", label: "Fwd/Back ≤ → flaming", step: 0.05 },
  ]},
  { title: "Smoke / classification thresholds", fields: [
    { key: "thr_vesda_low", label: "Smoke low %", step: 1 },
    { key: "thr_vesda_high", label: "Smoke high %", step: 1 },
    { key: "thr_h2_low", label: "H₂ low ppm", step: 1 },
    { key: "thr_h2_high", label: "H₂ high ppm", step: 1 },
    { key: "thr_co_low", label: "CO low ppm", step: 1 },
    { key: "thr_co_high", label: "CO high ppm", step: 1 },
    { key: "thr_voc_low", label: "VOC low ppb", step: 10 },
    { key: "thr_voc_high", label: "VOC high ppb", step: 10 },
    { key: "thr_temprate_low", label: "Temp rate low °C/min", step: 0.1 },
    { key: "thr_temprate_high", label: "Temp rate high °C/min", step: 0.1 },
    { key: "thr_humidity_high", label: "Humidity steam cutoff %", step: 1 },
  ]},
  { title: "Classification confidence → action (%)", fields: [
    { key: "conf_alert", label: "Alert at confidence ≥", step: 1 },
    { key: "conf_prealarm", label: "Pre-Alarm at confidence ≥", step: 1 },
    { key: "conf_critical", label: "Critical at confidence ≥", step: 1 },
    { key: "conf_emergency", label: "Emergency at confidence ≥", step: 1 },
  ]},
  { title: "Gas alarm levels", fields: [
    { key: "h2_alert", label: "H₂ alert ppm", step: 1 },
    { key: "h2_critical", label: "H₂ critical ppm", step: 1 },
    { key: "h2_emergency", label: "H₂ emergency ppm", step: 1 },
    { key: "co_alert", label: "CO alert ppm", step: 1 },
    { key: "co_critical", label: "CO critical ppm", step: 1 },
    { key: "co_emergency", label: "CO emergency ppm", step: 1 },
    { key: "voc_alert", label: "VOC alert ppb", step: 10 },
    { key: "h2_rate_critical", label: "H₂ rate critical ppm/min", step: 1 },
    { key: "temp_rate_critical", label: "Temp rate critical °C/min", step: 0.1 },
  ]},
  { title: "Timing", fields: [
    { key: "poll_ms", label: "Sample interval (ms)", step: 250 },
  ]},
];

function ago(ts: string | null) {
  if (!ts) return "—";
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

function Slider({ label, value, min, max, step, onChange, unit, on, onToggle, disabled }: any) {
  return (
    <div className={`bg-gray-900/40 rounded-lg px-3 py-2 border border-gray-800/50 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-gray-300 flex items-center gap-2">
          {onToggle && (
            <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="accent-teal-500 w-3.5 h-3.5" title="Sensor connected" />
          )}
          {label}
        </label>
        <span className="text-xs font-medium text-gray-100 tabular-nums">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-teal-500" />
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 w-7 text-right tabular-nums">{pct}</span>
    </div>
  );
}

export default function AdminPage() {
  const [me, setMe] = useState<{ is_superadmin: boolean; email: string | null } | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({ ...DEFAULT_CONFIG });
  const [baseline, setBaseline] = useState<Record<string, any>>({ ...DEFAULT_CONFIG });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [tb, setTb] = useState<any>({
    h2: 90, co: 28, voc: 700, tempRate: 1.4, smoke: 14, humidity: 45,
    panel: false, discharged: false, sustained: 0, pmsHint: 0,
    h2On: true, coOn: true, vocOn: true, tempOn: true, smokeOn: true,
  });

  useEffect(() => { fetch("/api/admin/me").then((r) => r.json()).then(setMe).catch(() => setMe({ is_superadmin: false, email: null })); }, []);

  const loadDevices = useCallback(async () => {
    const r = await fetch("/api/admin/devices");
    if (!r.ok) return;
    const j = await r.json();
    setDevices(j.devices || []);
  }, []);

  useEffect(() => { if (me?.is_superadmin) loadDevices(); }, [me, loadDevices]);
  useEffect(() => {
    if (!me?.is_superadmin) return;
    const t = setInterval(loadDevices, 5000);
    return () => clearInterval(t);
  }, [me, loadDevices]);

  const selected = devices.find((d) => d.device_id === selId) || null;

  function selectDevice(d: any) {
    const cfg = { ...DEFAULT_CONFIG, ...(d.config || {}) };
    setSelId(d.device_id);
    setDraft(cfg);
    setBaseline(cfg);
    setMsg(d.config ? "" : "No config reported yet — showing defaults");
  }

  const dirty = useMemo(
    () => Object.keys(draft).filter((k) => draft[k] !== baseline[k]),
    [draft, baseline]
  );

  // ─── Live classifier result from the CURRENT (unsaved) params ───
  const smokeSource = draft.vesda_present ? "VESDA" : draft.use_adpd ? "Chamber" : "Smoke (no source)";
  const smokeConnected = tb.smokeOn && (!!draft.vesda_present || !!draft.use_adpd);
  const cfgNum = useMemo(() => {
    const c: Record<string, number> = {};
    Object.keys(DEFAULT_CONFIG).forEach((k) => {
      const v = Number(draft[k]); c[k] = Number.isFinite(v) ? v : Number(DEFAULT_CONFIG[k]);
    });
    return c;
  }, [draft]);
  const result = useMemo(() => classify({
    h2: tb.h2On ? tb.h2 : 0, co: tb.coOn ? tb.co : 0, voc: tb.vocOn ? tb.voc : 0,
    tempRate: tb.tempOn ? tb.tempRate : 0, smoke: smokeConnected ? tb.smoke : 0, humidity: tb.humidity,
    panel: tb.panel, discharged: tb.discharged, sustained: tb.sustained, pmsHint: tb.pmsHint,
  }, cfgNum, !!draft.use_pms), [tb, cfgNum, smokeConnected, draft.use_pms]);

  async function push() {
    if (!selId || dirty.length === 0) return;
    setBusy(true); setMsg("");
    const patch: Record<string, any> = {};
    dirty.forEach((k) => (patch[k] = draft[k]));
    const r = await fetch(`/api/devices/${selId}/config`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    setBusy(false);
    if (r.ok) { setMsg(`Pushed ${dirty.length} change(s)`); setBaseline({ ...draft }); setTimeout(loadDevices, 1500); }
    else { const e = await r.json().catch(() => ({})); setMsg(`Error: ${e.error || r.status}`); }
  }

  async function sendCmd(c: string) {
    if (!selId) return;
    setBusy(true);
    await fetch(`/api/devices/${selId}/command`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: c }),
    });
    setBusy(false);
    setMsg(`Sent: ${c}`);
    if (c === "reset_config") { setDraft({ ...DEFAULT_CONFIG }); setBaseline({ ...DEFAULT_CONFIG }); setTimeout(loadDevices, 1500); }
  }

  if (me === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">Loading…</div>;
  }
  if (!me.is_superadmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-gray-400 text-sm">This area is restricted to superadmins.</p>
        <Link href="/dashboard" className="text-teal-400 text-xs hover:text-teal-300">← Back to dashboard</Link>
      </div>
    );
  }

  const alarmCount = devices.filter((d) => d.last_severity >= 3).length;
  const onlineCount = devices.filter((d) => d.is_online).length;
  const ac = STAGE_COLOR[result.action];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-medium">SmokeSense — Superadmin</h1>
          <p className="text-xs text-gray-500">{me.email} · fleet control, tuning &amp; classifier test bench</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500"><span className="text-green-400 font-medium">{onlineCount}</span>/{devices.length} online</span>
          {alarmCount > 0 && <span className="px-2.5 py-1 bg-red-950 text-red-400 border border-red-900 rounded-md text-xs font-medium">{alarmCount} alarm{alarmCount > 1 ? "s" : ""}</span>}
          <Link href="/dashboard" className="text-teal-400 hover:text-teal-300 text-xs">Standard view</Link>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Fleet list */}
        <div className="w-[340px] border-r border-gray-800 overflow-y-auto p-3 space-y-1.5 flex-shrink-0">
          {devices.length === 0 ? (
            <p className="text-center text-gray-600 text-sm py-8">No devices</p>
          ) : devices.map((d) => {
            const sev = Math.min(d.last_severity ?? 0, 4);
            const cfg = d.config || {};
            return (
              <button key={d.device_id} onClick={() => selectDevice(d)}
                className={`w-full text-left p-3 rounded-xl border transition ${selId === d.device_id ? "bg-gray-800/60 border-gray-600" : "bg-gray-900/40 border-gray-800/50 hover:bg-gray-800/30"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: d.is_online ? STAGE_COLOR[sev] : "#555" }} />
                    <span className="text-sm font-medium">{d.name || d.device_id}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: STAGE_COLOR[sev] + "22", color: STAGE_COLOR[sev] }}>{STAGE[sev]}</span>
                </div>
                <div className="text-[11px] text-gray-500 flex items-center justify-between">
                  <span>{d.org_name || "—"} · {d.zone || "—"}</span>
                  <span>{ago(d.last_seen)} ago</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Editor + test bench */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 max-w-3xl">
            {/* ── Classifier test bench ── */}
            <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">Classifier test bench</p>
                <span className="text-[11px] text-gray-500">runs the device classifier on these inputs with the params below — no device needed</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Inputs */}
                <div className="space-y-2">
                  <Slider label="H₂ ppm" value={tb.h2} min={0} max={300} step={1} unit="" on={tb.h2On} onToggle={(v: boolean) => setTb({ ...tb, h2On: v })} disabled={!tb.h2On} onChange={(v: number) => setTb({ ...tb, h2: v })} />
                  <Slider label="CO ppm" value={tb.co} min={0} max={150} step={1} unit="" on={tb.coOn} onToggle={(v: boolean) => setTb({ ...tb, coOn: v })} disabled={!tb.coOn} onChange={(v: number) => setTb({ ...tb, co: v })} />
                  <Slider label="VOC ppb" value={tb.voc} min={0} max={3000} step={10} unit="" on={tb.vocOn} onToggle={(v: boolean) => setTb({ ...tb, vocOn: v })} disabled={!tb.vocOn} onChange={(v: number) => setTb({ ...tb, voc: v })} />
                  <Slider label="Temp rate °C/min" value={tb.tempRate} min={0} max={10} step={0.1} unit="" on={tb.tempOn} onToggle={(v: boolean) => setTb({ ...tb, tempOn: v })} disabled={!tb.tempOn} onChange={(v: number) => setTb({ ...tb, tempRate: v })} />
                  <Slider label={`${smokeSource} %`} value={tb.smoke} min={0} max={100} step={1} unit="%" on={tb.smokeOn} onToggle={(v: boolean) => setTb({ ...tb, smokeOn: v })} disabled={!smokeConnected} onChange={(v: number) => setTb({ ...tb, smoke: v })} />
                  <Slider label="Humidity %" value={tb.humidity} min={0} max={100} step={1} unit="%" onChange={(v: number) => setTb({ ...tb, humidity: v })} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => setTb({ ...tb, panel: !tb.panel })} className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${tb.panel ? "border-teal-600 text-teal-300 bg-teal-950/40" : "border-gray-700 text-gray-500"}`}>Panel alarm</button>
                    <button onClick={() => setTb({ ...tb, discharged: !tb.discharged })} className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${tb.discharged ? "border-red-700 text-red-300 bg-red-950/40" : "border-gray-700 text-gray-500"}`}>Suppression discharged</button>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-gray-500 mr-1">Sustained:</span>
                    {["Live", "> 30 s", "> 60 s"].map((lbl, i) => (
                      <button key={i} onClick={() => setTb({ ...tb, sustained: i })} className={`text-[11px] px-2 py-1 rounded-md border ${tb.sustained === i ? "border-teal-600 text-teal-300" : "border-gray-700 text-gray-500"}`}>{lbl}</button>
                    ))}
                  </div>
                  {draft.use_pms && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-gray-500 mr-1">Particle hint:</span>
                      {["—", "Large (smoulder)", "Small (flame)"].map((lbl, i) => (
                        <button key={i} onClick={() => setTb({ ...tb, pmsHint: i })} className={`text-[11px] px-2 py-1 rounded-md border ${tb.pmsHint === i ? "border-teal-600 text-teal-300" : "border-gray-700 text-gray-500"}`}>{lbl}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Live verdict */}
                <div className="rounded-xl border p-4 flex flex-col" style={{ borderColor: ac + "55", background: ac + "11" }}>
                  <div className="text-[11px] uppercase tracking-wide" style={{ color: ac }}>{ACTION_LABELS[result.action]}</div>
                  <div className="text-xl font-semibold mt-1 mb-0.5" style={{ color: ac }}>{FIRE_LABELS[result.fireType]}</div>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-3xl font-bold tabular-nums" style={{ color: ac }}>{Math.round(result.confidence)}%</span>
                    <span className="text-[11px] text-gray-500">confidence · severity {result.action}</span>
                    {result.confirmed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">confirmed</span>}
                  </div>
                  <div className="space-y-1 mb-3">
                    <ScoreBar label="H₂" score={result.s.h2} />
                    <ScoreBar label="CO" score={result.s.co} />
                    <ScoreBar label="VOC" score={result.s.voc} />
                    <ScoreBar label="Temp" score={result.s.temp} />
                    <ScoreBar label="Smoke" score={result.s.vesda} />
                  </div>
                  <div className="text-[11px] text-gray-500 mt-auto leading-relaxed">
                    {result.active} sensor{result.active === 1 ? "" : "s"} active · agreement ×{result.mult.toFixed(2)}<br />
                    raw match {Math.round(result.raw)}% → after agreement {Math.round(result.raw * result.mult)}%
                  </div>
                </div>
              </div>

              {/* ── Classification matrix (live) ── */}
              <div className="mt-4 pt-4 border-t border-gray-800/70">
                <p className="text-[11px] text-gray-500 mb-2">Classification matrix — each cell = sensor score × that fire type&apos;s weight; row total = match score. Re-ranks live as you change inputs or thresholds.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left font-normal py-1 pr-2">Fire type</th>
                        {["H₂", "CO", "VOC", "Temp", "Smoke"].map((h) => (<th key={h} className="font-normal px-1 w-10">{h}</th>))}
                        <th className="font-normal px-1 text-right w-12">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5, 6].map((ti) => {
                        const sc = [result.s.h2, result.s.co, result.s.voc, result.s.temp, result.s.vesda];
                        const w = SIGNATURES[ti];
                        const total = Math.round(result.match[ti]);
                        const win = ti === result.fireType && result.fireType !== 0;
                        return (
                          <tr key={ti} className={win ? "text-teal-300 font-medium" : "text-gray-400"} style={win ? { background: "#1d9e7418" } : undefined}>
                            <td className="py-1 pr-2 whitespace-nowrap">{FIRE_LABELS[ti]}{win ? " ◄" : ""}</td>
                            {w.map((wt, k) => {
                              const c = sc[k] * wt;
                              return (
                                <td key={k} className="px-1 text-center tabular-nums" style={{ background: `rgba(45,158,114,${Math.min(0.9, c * 1.8)})`, color: c > 0.25 ? "#fff" : undefined }}>
                                  {c > 0.001 ? Math.round(c * 100) : "·"}
                                </td>
                              );
                            })}
                            <td className="px-1 text-right tabular-nums">{total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ── Device header / commands ── */}
            {selected ? (
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-medium">{selected.name || selected.device_id}</h2>
                  <p className="text-xs text-gray-500">{selected.device_id} · {selected.org_name || "—"} · {selected.is_online ? <span className="text-green-400">online</span> : <span className="text-red-400">offline</span>}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => sendCmd("get_config")} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40">Refresh</button>
                  <button onClick={() => sendCmd("recalibrate")} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40">Re-zero chamber</button>
                  <button onClick={() => sendCmd("reset_config")} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-amber-900 text-amber-400 hover:bg-amber-950 disabled:opacity-40">Reset defaults</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 mb-4">Tuning parameters below feed the test bench live. Select a device from the list to push these settings to it.</p>
            )}

            {GROUPS.map((g) => (
              <div key={g.title} className="mb-5">
                <p className="text-xs text-gray-500 mb-2">{g.title}</p>
                <div className="grid grid-cols-2 gap-2">
                  {g.fields.map((f) => {
                    const changed = draft[f.key] !== baseline[f.key];
                    if (f.type === "bool") {
                      return (
                        <label key={f.key} className={`flex items-center justify-between bg-gray-900/40 rounded-lg px-3 py-2.5 border ${changed ? "border-teal-700" : "border-gray-800/50"}`}>
                          <span className="text-xs text-gray-300">{f.label}</span>
                          <input type="checkbox" checked={!!draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} className="accent-teal-500 w-4 h-4" />
                        </label>
                      );
                    }
                    return (
                      <label key={f.key} className={`flex items-center justify-between bg-gray-900/40 rounded-lg px-3 py-2 border ${changed ? "border-teal-700" : "border-gray-800/50"}`}>
                        <span className="text-xs text-gray-400 mr-2">{f.label}</span>
                        <input type="number" step={f.step ?? 1} value={draft[f.key] ?? ""}
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })}
                          className="w-24 bg-gray-800 rounded px-2 py-1 text-xs text-right text-gray-100 border border-gray-700 focus:border-teal-600 outline-none" />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="sticky bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-4 pb-2 flex items-center gap-3">
              <button onClick={push} disabled={busy || !selId || dirty.length === 0}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-30 disabled:cursor-not-allowed">
                {busy ? "Pushing…" : !selId ? "Select a device to push" : dirty.length ? `Push ${dirty.length} change${dirty.length > 1 ? "s" : ""}` : "No changes"}
              </button>
              {dirty.length > 0 && (
                <button onClick={() => setDraft({ ...baseline })} className="text-xs text-gray-500 hover:text-gray-300">Discard</button>
              )}
              {msg && <span className="text-xs text-gray-400">{msg}</span>}
              {selected?.config_updated_at && (
                <span className="text-[11px] text-gray-600 ml-auto">device reported {ago(selected.config_updated_at)} ago</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
