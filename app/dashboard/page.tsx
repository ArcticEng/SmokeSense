"use client";
import { useState, useMemo, useEffect } from "react";
import { useAuth, useOrganization, useDevices, useLatestTelemetry, useEvents, useDeviceCommands, useTelemetryHistory, useAcknowledgeEvent, useDeviceConfig } from "@/lib/hooks";
import { STAGE_META, Device, EventRow, TelemetryRow } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { XAxis, YAxis, ResponsiveContainer, Tooltip, Area, AreaChart } from "recharts";

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const isLight = typeof window !== "undefined" && localStorage.getItem("theme") === "light";
    setLight(isLight);
    document.documentElement.classList.toggle("light", isLight);
  }, []);
  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("theme", next ? "light" : "dark");
  }
  return (
    <button onClick={toggle} className="text-gray-500 hover:text-gray-300 text-xs" title="Toggle light / dark">
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}

export default function DashboardPage() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { org, loading: orgLoading } = useOrganization();
  const { devices, loading: devLoading } = useDevices(org?.id);
  const { events } = useEvents(org?.id, 30);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [view, setView] = useState<"devices" | "events">("devices");
  const [filter, setFilter] = useState<"all" | "alarm" | "warning" | "offline">("all");
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((j) => setIsAdmin(!!j.is_superadmin)).catch(() => {});
  }, []);

  if (!authLoading && !user) {
    router.replace("/login");
    return null;
  }

  const selectedDevice = devices.find((d) => d.device_id === selectedDeviceId);

  const filteredDevices = useMemo(() => {
    switch (filter) {
      case "alarm": return devices.filter((d) => d.last_severity >= 3);
      case "warning": return devices.filter((d) => d.last_severity >= 1 && d.last_severity < 3);
      case "offline": return devices.filter((d) => !d.is_online);
      default: return devices;
    }
  }, [devices, filter]);

  const alarmCount = devices.filter((d) => d.last_severity >= 3).length;
  const warningCount = devices.filter((d) => d.last_severity >= 1 && d.last_severity < 3).length;
  const onlineCount = devices.filter((d) => d.is_online).length;

  if (authLoading || orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-4 sm:px-5 py-3 flex items-center justify-between flex-shrink-0 gap-3">
        <div>
          <h1 className="text-lg font-medium">SmokeSense</h1>
          <p className="text-xs text-gray-500">{org?.name || "No organization"}</p>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-sm flex-wrap justify-end">
          {isAdmin && (
            <Link href="/dashboard/admin" className="text-amber-400 hover:text-amber-300 text-xs font-medium">Admin</Link>
          )}
          <Link href="/dashboard/fleet" className="text-teal-400 hover:text-teal-300 text-xs font-medium">Fleet Map</Link>
          <span className="text-gray-500"><span className="text-green-400 font-medium">{onlineCount}</span>/{devices.length} online</span>
          {alarmCount > 0 && (
            <span className="px-2.5 py-1 bg-red-950 text-red-400 border border-red-900 rounded-md text-xs font-medium animate-alarm">{alarmCount} alarm{alarmCount > 1 ? "s" : ""}</span>
          )}
          {warningCount > 0 && (
            <span className="px-2.5 py-1 bg-amber-950 text-amber-400 border border-amber-900 rounded-md text-xs font-medium">{warningCount} warning{warningCount > 1 ? "s" : ""}</span>
          )}
          <ThemeToggle />
          <button onClick={signOut} className="text-gray-500 hover:text-gray-300 text-xs">Sign out</button>
        </div>
      </header>

      <div className="border-b border-gray-800/50 px-4 sm:px-5 py-2 flex items-center gap-4 sm:gap-6 flex-shrink-0 overflow-x-auto">
        <div className="flex gap-1">
          {(["devices", "events"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${view === v ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {v === "devices" ? "Devices" : "Event log"}
            </button>
          ))}
        </div>
        {view === "devices" && (
          <div className="flex gap-1">
            {(["all", "alarm", "warning", "offline"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-md transition whitespace-nowrap ${filter === f ? "bg-gray-800 text-white border border-gray-700" : "text-gray-500"}`}>
                {f === "all" ? "All" : f === "alarm" ? "Alarms" : f === "warning" ? "Warnings" : "Offline"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {view === "devices" ? (
          <>
            <div className={`w-full md:w-[320px] md:flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-800 md:overflow-y-auto p-3 space-y-2 ${selectedDevice ? "hidden md:block" : ""}`}>
              {devLoading ? (
                <p className="text-center text-gray-600 text-sm py-8">Loading devices...</p>
              ) : filteredDevices.length === 0 ? (
                <p className="text-center text-gray-600 text-sm py-8">No devices match this filter</p>
              ) : (
                filteredDevices.map((d) => (
                  <DeviceCard key={d.id} device={d} selected={selectedDeviceId === d.device_id} onClick={() => setSelectedDeviceId(d.device_id)} />
                ))
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {selectedDevice ? (
                <DeviceDetail device={selectedDevice} orgId={org?.id} userId={user?.id} onBack={() => setSelectedDeviceId(null)} />
              ) : (
                <div className="hidden md:flex items-center justify-center h-full text-gray-600 text-sm">Select a sensor node to view details</div>
              )}
            </div>
          </>
        ) : (
          <EventLog events={events} userId={user?.id || ""} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  DEVICE CARD
// ═══════════════════════════════════════════════════

function DeviceCard({ device, selected, onClick }: { device: Device; selected: boolean; onClick: () => void }) {
  const s = STAGE_META[Math.min(device.last_severity, 4)];
  const ago = device.last_seen ? Math.round((Date.now() - new Date(device.last_seen).getTime()) / 1000) : null;
  const isDataGuard = device.device_id.startsWith("DG-");

  return (
    <button onClick={onClick}
      className={`w-full text-left p-3.5 rounded-xl border transition ${selected ? "bg-gray-800/60 border-gray-600" : "bg-gray-900/40 border-gray-800/50 hover:bg-gray-800/30"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${device.last_severity >= 3 ? "animate-alarm" : ""}`} style={{ background: device.is_online ? s.color : "#555" }} />
          <span className="text-sm font-medium">{device.name}</span>
          {isDataGuard && <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-950 text-teal-400 border border-teal-900">DG</span>}
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-md font-medium" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
      </div>
      <div className="text-[11px] text-gray-500 mb-2">
        {device.zone || "—"} {ago !== null ? `· ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago` : ""}
      </div>
      <StageBar severity={device.last_severity} />
    </button>
  );
}

function StageBar({ severity }: { severity: number }) {
  return (
    <div className="flex gap-0.5 h-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex-1 rounded-sm transition-all duration-500"
          style={{ background: i <= severity ? STAGE_META[i].color : "rgba(255,255,255,0.06)", opacity: i <= severity ? 1 : 0.3 }} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  GAUGE — semicircular, colour-zoned (green/amber/red)
// ═══════════════════════════════════════════════════

function Gauge({ label, value, unit, lo, hi, max }: { label: string; value: number; unit?: string; lo: number; hi: number; max: number }) {
  const GREEN = "#10d96a", AMBER = "#ffae00", RED = "#ff3b4e";
  const v = Math.max(0, value || 0);
  const frac = Math.min(v / max, 1);
  const band = v >= hi ? RED : v >= lo ? AMBER : GREEN;
  const cx = 60, cy = 54, r = 44;
  const pol = (f: number, rr = r) => { const a = Math.PI * (1 - Math.min(Math.max(f, 0), 1)); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
  const arc = (f0: number, f1: number) => { const [x0, y0] = pol(f0); const [x1, y1] = pol(f1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const loF = Math.min(lo / max, 1), hiF = Math.min(hi / max, 1);
  const [nx, ny] = pol(frac, r - 3);
  const display = unit === "ppm" ? v.toFixed(1) : Math.round(v);
  return (
    <div className="bg-gray-900/40 rounded-xl px-3 py-2.5 border border-gray-800/50">
      <div className="text-[11px] text-gray-500 mb-1 truncate">{label}</div>
      <svg viewBox="0 0 120 62" className="w-full">
        <path d={arc(0, 1)} fill="none" stroke="var(--gauge-track)" strokeWidth="9" strokeLinecap="round" />
        <path d={arc(0, loF)} fill="none" stroke={GREEN} strokeWidth="9" strokeLinecap="round" />
        <path d={arc(loF, hiF)} fill="none" stroke={AMBER} strokeWidth="9" />
        <path d={arc(hiF, 1)} fill="none" stroke={RED} strokeWidth="9" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={band} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={band} />
      </svg>
      <div className="text-center -mt-1">
        <span className="text-lg font-semibold tabular-nums" style={{ color: band }}>{display}</span>
        {unit && <span className="text-[10px] text-gray-500 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  DEVICE DETAIL PANEL
// ═══════════════════════════════════════════════════

function DeviceDetail({ device, orgId, userId, onBack }: { device: Device; orgId?: string; userId?: string; onBack?: () => void }) {
  const telemetry = useLatestTelemetry(device.device_id, orgId);
  const { data: history } = useTelemetryHistory(device.device_id, 24);
  const cfg = useDeviceConfig(device.device_id);
  const { silence, test, recalibrate, identify } = useDeviceCommands();
  const s = STAGE_META[Math.min(device.last_severity, 4)];
  const isDataGuard = device.device_id.startsWith("DG-");
  const [showDetails, setShowDetails] = useState(false);

  // Gauge zones come from this device's tuned config (thr_* thresholds),
  // falling back to firmware defaults if it hasn't reported config yet.
  const n = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  const TH = {
    h2: { lo: n(cfg?.thr_h2_low, 10), hi: n(cfg?.thr_h2_high, 50), max: n(cfg?.thr_h2_high, 50) * 2 },
    co: { lo: n(cfg?.thr_co_low, 10), hi: n(cfg?.thr_co_high, 35), max: n(cfg?.thr_co_high, 35) * 2 },
    voc: { lo: n(cfg?.thr_voc_low, 200), hi: n(cfg?.thr_voc_high, 500), max: n(cfg?.thr_voc_high, 500) * 2 },
    smoke: { lo: n(cfg?.thr_vesda_low, 5), hi: n(cfg?.thr_vesda_high, 25), max: 100 },
  };

  const chartData = history.map((t) => ({
    time: new Date(t.recorded_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }),
    delta: Math.round(t.scatter_delta), temp: t.temperature, humidity: t.humidity,
  }));

  const vesdaPresent = telemetry?.vesda_present !== false;
  const smoke = vesdaPresent ? (telemetry?.vesda_pct || 0) : (telemetry?.optical_pct || 0);

  const chartEl = chartData.length > 0 && (
    <div className="mb-5">
      <p className="text-xs text-gray-500 mb-2">{isDataGuard ? "24-hour temperature history" : "24-hour scatter history"}</p>
      <div className="bg-gray-900/50 rounded-xl p-3 border border-gray-800/50">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gDelta" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isDataGuard ? "#0d9488" : s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isDataGuard ? "#0d9488" : s.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#555" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#555" }} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={{ background: "#1c1e26", border: "1px solid #333", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#888" }} />
            <Area type="monotone" dataKey={isDataGuard ? "temp" : "delta"} stroke={isDataGuard ? "#0d9488" : s.color} fill="url(#gDelta)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const infoEl = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5 text-xs">
      <div className="bg-gray-900/40 rounded-lg px-3 py-2"><span className="text-gray-500">Firmware: </span>{device.firmware || "—"}</div>
      <div className="bg-gray-900/40 rounded-lg px-3 py-2"><span className="text-gray-500">IP: </span>{device.ip_address || "—"}</div>
      <div className="bg-gray-900/40 rounded-lg px-3 py-2"><span className="text-gray-500">Wi-Fi: </span>{device.rssi || 0} dBm</div>
      <div className="bg-gray-900/40 rounded-lg px-3 py-2"><span className="text-gray-500">Status: </span>
        <span className={device.is_online ? "text-green-400" : "text-red-400"}>{device.is_online ? "Online" : "Offline"}</span>
      </div>
    </div>
  );

  return (
    <div className="p-3 sm:p-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {onBack && (
          <button onClick={onBack} className="md:hidden text-gray-400 text-sm px-2 py-1 rounded-md border border-gray-800">←</button>
        )}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
          {device.last_severity}
        </div>
        <div>
          <h2 className="text-base font-medium">{device.name}</h2>
          <p className="text-xs text-gray-500">{device.device_id} — {device.zone || "Unassigned"}{isDataGuard && <span className="ml-2 text-teal-500 font-medium">DataGuard</span>}</p>
        </div>
      </div>

      {isDataGuard ? (
        <>
          {/* Status hero */}
          <div className="rounded-2xl p-4 mb-4 border" style={{ background: s.bg, borderColor: s.border }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: s.color }}>{s.label} — {s.desc}</div>
                <div className="text-2xl font-semibold mt-1" style={{ color: s.color }}>{telemetry?.fire_label || "Normal"}</div>
                <div className="text-[11px] text-gray-400 mt-1">
                  Action: {telemetry?.action || "monitor"} · {telemetry?.sensors_active ?? 0} sensors agreeing
                  {telemetry?.confirmed && <span className="ml-1 text-red-400 font-medium">· confirmed</span>}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-[11px] text-gray-400">Confidence</div>
                <div className="text-4xl font-bold tabular-nums" style={{ color: s.color }}>{Math.round(telemetry?.confidence || 0)}%</div>
              </div>
            </div>
          </div>

          {/* Gauges — what's out of ordinary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Gauge label="H₂" value={telemetry?.h2_ppm || 0} unit="ppm" lo={TH.h2.lo} hi={TH.h2.hi} max={TH.h2.max} />
            <Gauge label="CO" value={telemetry?.co_ppm || 0} unit="ppm" lo={TH.co.lo} hi={TH.co.hi} max={TH.co.max} />
            <Gauge label="VOC" value={telemetry?.voc_ppb || 0} unit="ppb" lo={TH.voc.lo} hi={TH.voc.hi} max={TH.voc.max} />
            <Gauge label={vesdaPresent ? "Smoke · VESDA" : "Smoke · chamber"} value={smoke} unit="%" lo={TH.smoke.lo} hi={TH.smoke.hi} max={TH.smoke.max} />
          </div>

          {/* Slim context + suppression */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            <Stat label="Temperature" value={(telemetry?.temperature || 0).toFixed(1)} unit="°C" />
            <Stat label="Humidity" value={Math.round(telemetry?.humidity || 0)} unit="%" />
            <div className="bg-gray-900/40 rounded-xl px-3 py-2.5">
              <div className="text-[11px] text-gray-500 mb-1">Suppression</div>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${device.last_severity >= 4 ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
                <span className="text-sm font-medium">{device.last_severity >= 4 ? "DISCHARGED" : "Armed — Ready"}</span>
              </div>
            </div>
          </div>

          {/* Details toggle */}
          <button onClick={() => setShowDetails(!showDetails)} className="text-xs text-gray-500 hover:text-gray-300 mb-3">
            {showDetails ? "▾ Hide details" : "▸ Show details — sensors, optical chamber, history"}
          </button>

          {showDetails && (
            <div className="mb-2">
              {/* Subsystem indicators */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Gas Detection", icon: "H₂", alert: (telemetry?.h2_ppm || 0) > 15 || (telemetry?.co_ppm || 0) > 10 },
                  { label: "Smoke", icon: "SM", alert: smoke > 8 },
                  { label: "Suppression", icon: "SP", alert: device.last_severity >= 4 },
                  { label: "Fire Panel", icon: "FP", alert: false },
                ].map((sub) => (
                  <div key={sub.label} className={`rounded-lg px-2 py-2 text-center border ${sub.alert ? "bg-red-950/50 border-red-900/50" : "bg-gray-900/40 border-gray-800/50"}`}>
                    <span className={`text-xs font-mono font-bold ${sub.alert ? "text-red-400" : "text-green-400"}`}>{sub.icon}</span>
                    <div className="text-[10px] text-gray-500 mt-0.5">{sub.label}</div>
                  </div>
                ))}
              </div>

              {/* Optical scatter chamber — when live */}
              {(telemetry?.ir_blue_ratio ?? 0) > 0 && (
                <div className="mb-5">
                  <p className="text-xs text-gray-500 mb-2">Optical scatter chamber</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat label="Smoke %" value={Math.round(telemetry?.optical_pct || 0)} unit="%" color={s.color} />
                    <Stat label="Scatter delta" value={Math.round(telemetry?.scatter_delta || 0)} />
                    <Stat label="Blue / IR" value={(telemetry?.ir_blue_ratio || 0).toFixed(2)} color={(telemetry?.ir_blue_ratio || 0) > 1.6 ? "#ef4444" : "#22c55e"} />
                    <Stat label="Fwd / Back" value={(telemetry?.fwd_back_ratio || 0).toFixed(2)} />
                  </div>
                </div>
              )}

              {chartEl}
              {infoEl}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Status banner (legacy node) */}
          <div className="rounded-xl px-4 py-3 mb-5 text-sm font-medium" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
            {s.label}: {s.desc}
            {telemetry?.is_smoke && <span className="ml-2 opacity-70">({telemetry.is_smouldering ? "smouldering" : "flaming"})</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
            <Stat label="Scatter delta" value={Math.round(telemetry?.scatter_delta || 0)} color={s.color} />
            <Stat label="IR / Blue" value={(telemetry?.ir_blue_ratio || 0).toFixed(2)} color={(telemetry?.ir_blue_ratio || 0) > 1.2 ? "#ef4444" : "#22c55e"} />
            <Stat label="Fwd / Back" value={(telemetry?.fwd_back_ratio || 0).toFixed(2)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            <Stat label="MQ-2" value={telemetry?.mq2 || device.baseline_mq2 || 0} unit="ppm" />
            <Stat label="Temp" value={(telemetry?.temperature || 0).toFixed(1)} unit="°C" />
            <Stat label="Humidity" value={Math.round(telemetry?.humidity || 0)} unit="%" />
            <Stat label="WiFi" value={device.rssi || 0} unit="dBm" />
          </div>
          {chartEl}
          {infoEl}
        </>
      )}

      {/* Commands */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Silence", fn: () => silence(device.device_id), danger: true },
          { label: "Self-test", fn: () => test(device.device_id) },
          { label: "Recalibrate", fn: () => recalibrate(device.device_id) },
          { label: "Identify", fn: () => identify(device.device_id) },
        ].map(({ label, fn, danger }) => (
          <button key={label} onClick={fn}
            className={`py-2.5 rounded-lg text-xs font-medium border transition ${danger ? "border-red-900 text-red-400 hover:bg-red-950" : "border-gray-700 text-gray-400 hover:bg-gray-800"}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: any; unit?: string; color?: string }) {
  return (
    <div className="bg-gray-900/40 rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold" style={{ color: color || "#e4e4e7" }}>
        {value}{unit && <span className="text-xs font-normal text-gray-500 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  EVENT LOG
// ═══════════════════════════════════════════════════

function EventLog({ events, userId }: { events: EventRow[]; userId: string }) {
  const ack = useAcknowledgeEvent();
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5">
      <h2 className="text-sm font-medium text-gray-400 mb-3">Recent events</h2>
      {events.length === 0 ? (
        <p className="text-gray-600 text-sm">No events yet</p>
      ) : (
        <div className="space-y-1.5">
          {events.map((ev) => {
            const sev = ev.severity ?? 0;
            const s = STAGE_META[Math.min(sev, 4)];
            const time = new Date(ev.recorded_at).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return (
              <div key={ev.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${ev.acknowledged ? "bg-gray-900/30 border-gray-800/30" : "bg-gray-900/60 border-gray-800"}`}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-medium">{ev.device_id}</span>
                    <span className="text-gray-500 mx-1.5">·</span>
                    <span style={{ color: s.color }}>{ev.event_type}</span>
                    {ev.from_stage && ev.to_stage && <span className="text-gray-500 text-xs ml-2">{ev.from_stage} → {ev.to_stage}</span>}
                    {ev.fire_label && <span className="text-gray-400 text-xs ml-2">· {ev.fire_label} ({Math.round(ev.confidence || 0)}%)</span>}
                  </div>
                  <div className="text-[11px] text-gray-600">{time}</div>
                </div>
                {!ev.acknowledged && ev.event_type === "escalation" && (
                  <button onClick={() => ack(ev.id, userId)} className="text-[11px] px-2.5 py-1 rounded-md border border-gray-700 text-gray-400 hover:bg-gray-800 flex-shrink-0">Acknowledge</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
