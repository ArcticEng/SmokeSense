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

export default function AdminPage() {
  const [me, setMe] = useState<{ is_superadmin: boolean; email: string | null } | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [baseline, setBaseline] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-medium">SmokeSense — Superadmin</h1>
          <p className="text-xs text-gray-500">{me.email} · fleet control & tuning</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500"><span className="text-green-400 font-medium">{onlineCount}</span>/{devices.length} online</span>
          {alarmCount > 0 && <span className="px-2.5 py-1 bg-red-950 text-red-400 border border-red-900 rounded-md text-xs font-medium">{alarmCount} alarm{alarmCount > 1 ? "s" : ""}</span>}
          <Link href="/dashboard" className="text-teal-400 hover:text-teal-300 text-xs">Standard view</Link>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Fleet list — all orgs */}
        <div className="w-[360px] border-r border-gray-800 overflow-y-auto p-3 space-y-1.5 flex-shrink-0">
          {devices.length === 0 ? (
            <p className="text-center text-gray-600 text-sm py-8">No devices</p>
          ) : devices.map((d) => {
            const sev = Math.min(d.last_severity ?? 0, 4);
            const cfg = d.config || {};
            return (
              <button
                key={d.device_id}
                onClick={() => selectDevice(d)}
                className={`w-full text-left p-3 rounded-xl border transition ${selId === d.device_id ? "bg-gray-800/60 border-gray-600" : "bg-gray-900/40 border-gray-800/50 hover:bg-gray-800/30"}`}
              >
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
                <div className="text-[10px] text-gray-600 mt-1 flex gap-2">
                  <span>{d.firmware || "fw —"}</span>
                  <span>VESDA {cfg.vesda_present === false ? "off" : "on"}</span>
                  {cfg.use_adpd && <span className="text-teal-500">chamber</span>}
                  {cfg.use_pms && <span className="text-teal-500">pms</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Config editor */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">Select a device to monitor and tune</div>
          ) : (
            <div className="p-5 max-w-3xl">
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
                          <input
                            type="number"
                            step={f.step ?? 1}
                            value={draft[f.key] ?? ""}
                            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })}
                            className="w-24 bg-gray-800 rounded px-2 py-1 text-xs text-right text-gray-100 border border-gray-700 focus:border-teal-600 outline-none"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Sticky push bar */}
              <div className="sticky bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-4 pb-2 flex items-center gap-3">
                <button
                  onClick={push}
                  disabled={busy || dirty.length === 0}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {busy ? "Pushing…" : dirty.length ? `Push ${dirty.length} change${dirty.length > 1 ? "s" : ""}` : "No changes"}
                </button>
                {dirty.length > 0 && (
                  <button onClick={() => setDraft({ ...baseline })} className="text-xs text-gray-500 hover:text-gray-300">Discard</button>
                )}
                {msg && <span className="text-xs text-gray-400">{msg}</span>}
                {selected.config_updated_at && (
                  <span className="text-[11px] text-gray-600 ml-auto">device reported {ago(selected.config_updated_at)} ago</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
