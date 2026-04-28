"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ═══════════════════════════════════════════════════
//  UK DATA CENTRE FLEET MAP
//  Shows all data centres on an interactive map
//  with colour-coded severity pins.
// ═══════════════════════════════════════════════════

// UK data centre locations (seed data — replace with DB query)
const DC_LOCATIONS = [
  { code: "LDN-01", name: "London DC-01", lat: 51.5074, lng: -0.1278, city: "London", racks: 200, kw: 4000 },
  { code: "LDN-02", name: "London DC-02", lat: 51.5225, lng: -0.0846, city: "London Docklands", racks: 150, kw: 3000 },
  { code: "LDN-03", name: "London DC-03", lat: 51.4816, lng: -0.6105, city: "Slough", racks: 300, kw: 6000 },
  { code: "LDN-04", name: "London DC-04", lat: 51.3890, lng: -0.2861, city: "Croydon", racks: 120, kw: 2400 },
  { code: "MAN-01", name: "Manchester DC-01", lat: 53.4808, lng: -2.2426, city: "Manchester", racks: 180, kw: 3600 },
  { code: "MAN-02", name: "Manchester DC-02", lat: 53.4534, lng: -2.1744, city: "Manchester South", racks: 160, kw: 3200 },
  { code: "BHM-01", name: "Birmingham DC-01", lat: 52.4862, lng: -1.8904, city: "Birmingham", racks: 140, kw: 2800 },
  { code: "LDS-01", name: "Leeds DC-01", lat: 53.7996, lng: -1.5491, city: "Leeds", racks: 120, kw: 2400 },
  { code: "BRS-01", name: "Bristol DC-01", lat: 51.4545, lng: -2.5879, city: "Bristol", racks: 100, kw: 2000 },
  { code: "EDI-01", name: "Edinburgh DC-01", lat: 55.9533, lng: -3.1883, city: "Edinburgh", racks: 130, kw: 2600 },
  { code: "EDI-02", name: "Edinburgh DC-02", lat: 55.9221, lng: -3.1735, city: "Edinburgh South", racks: 110, kw: 2200 },
  { code: "GLA-01", name: "Glasgow DC-01", lat: 55.8642, lng: -4.2518, city: "Glasgow", racks: 100, kw: 2000 },
  { code: "CDF-01", name: "Cardiff DC-01", lat: 51.4816, lng: -3.1791, city: "Cardiff", racks: 80, kw: 1600 },
  { code: "NCL-01", name: "Newcastle DC-01", lat: 54.9783, lng: -1.6178, city: "Newcastle", racks: 90, kw: 1800 },
  { code: "SHF-01", name: "Sheffield DC-01", lat: 53.3811, lng: -1.4701, city: "Sheffield", racks: 80, kw: 1600 },
  { code: "NTM-01", name: "Nottingham DC-01", lat: 52.9548, lng: -1.1581, city: "Nottingham", racks: 90, kw: 1800 },
  { code: "CPH-01", name: "Cambridge DC-01", lat: 52.2053, lng: 0.1218, city: "Cambridge", racks: 110, kw: 2200 },
  { code: "SVN-01", name: "Southampton DC-01", lat: 50.9097, lng: -1.4044, city: "Southampton", racks: 80, kw: 1600 },
  { code: "RDG-01", name: "Reading DC-01", lat: 51.4543, lng: -0.9781, city: "Reading", racks: 100, kw: 2000 },
  { code: "MKY-01", name: "Milton Keynes DC-01", lat: 52.0406, lng: -0.7594, city: "Milton Keynes", racks: 120, kw: 2400 },
  // Extend to 40+ as needed
  { code: "LPL-01", name: "Liverpool DC-01", lat: 53.4084, lng: -2.9916, city: "Liverpool", racks: 90, kw: 1800 },
  { code: "BFD-01", name: "Bradford DC-01", lat: 53.7960, lng: -1.7594, city: "Bradford", racks: 70, kw: 1400 },
  { code: "COV-01", name: "Coventry DC-01", lat: 52.4068, lng: -1.5197, city: "Coventry", racks: 80, kw: 1600 },
  { code: "PLY-01", name: "Plymouth DC-01", lat: 50.3755, lng: -4.1427, city: "Plymouth", racks: 60, kw: 1200 },
  { code: "NRW-01", name: "Norwich DC-01", lat: 52.6309, lng: 1.2974, city: "Norwich", racks: 70, kw: 1400 },
  { code: "ABD-01", name: "Aberdeen DC-01", lat: 57.1497, lng: -2.0943, city: "Aberdeen", racks: 60, kw: 1200 },
  { code: "BLF-01", name: "Belfast DC-01", lat: 54.5973, lng: -5.9301, city: "Belfast", racks: 80, kw: 1600 },
  { code: "LDN-05", name: "London DC-05", lat: 51.5555, lng: -0.0799, city: "Tottenham Hale", racks: 250, kw: 5000 },
  { code: "LDN-06", name: "London DC-06", lat: 51.4985, lng: 0.0130, city: "Greenwich", racks: 180, kw: 3600 },
  { code: "LDN-07", name: "London DC-07", lat: 51.5350, lng: -0.4833, city: "Hayes", racks: 220, kw: 4400 },
  { code: "MAN-03", name: "Manchester DC-03", lat: 53.5073, lng: -2.2900, city: "Salford", racks: 140, kw: 2800 },
  { code: "LDN-08", name: "London DC-08", lat: 51.4300, lng: -0.5620, city: "Heathrow", racks: 200, kw: 4000 },
  { code: "LDN-09", name: "London DC-09", lat: 51.5462, lng: -0.0233, city: "Stratford", racks: 160, kw: 3200 },
  { code: "LDN-10", name: "London DC-10", lat: 51.5028, lng: -0.0194, city: "Canary Wharf", racks: 280, kw: 5600 },
  { code: "BHM-02", name: "Birmingham DC-02", lat: 52.5139, lng: -1.9426, city: "West Bromwich", racks: 100, kw: 2000 },
  { code: "LDS-02", name: "Leeds DC-02", lat: 53.7720, lng: -1.5251, city: "Leeds South", racks: 90, kw: 1800 },
  { code: "BRS-02", name: "Bristol DC-02", lat: 51.4295, lng: -2.6250, city: "Bristol West", racks: 80, kw: 1600 },
  { code: "SWA-01", name: "Swansea DC-01", lat: 51.6214, lng: -3.9436, city: "Swansea", racks: 60, kw: 1200 },
  { code: "DND-01", name: "Dundee DC-01", lat: 56.4620, lng: -2.9707, city: "Dundee", racks: 50, kw: 1000 },
  { code: "EXE-01", name: "Exeter DC-01", lat: 50.7184, lng: -3.5339, city: "Exeter", racks: 60, kw: 1200 },
];

// Severity colours
const SEV_COLORS: Record<number, string> = {
  0: "#16a34a", // green — normal
  1: "#eab308", // yellow — early warning
  2: "#f97316", // orange — pre-alarm
  3: "#dc2626", // red — critical
  4: "#991b1b", // dark red — emergency
};

const SEV_LABELS: Record<number, string> = {
  0: "Normal",
  1: "Early Warning",
  2: "Pre-Alarm",
  3: "Critical",
  4: "Emergency",
};

type DCStatus = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  racks: number;
  kw: number;
  severity: number;
  devices_total: number;
  devices_online: number;
  last_event?: string;
};

export default function FleetMapPage() {
  const [dcList, setDcList] = useState<DCStatus[]>([]);
  const [selectedDC, setSelectedDC] = useState<DCStatus | null>(null);
  const [filter, setFilter] = useState<string>("all");

  // Simulate device status per DC (in production, query from Supabase)
  useEffect(() => {
    const statuses: DCStatus[] = DC_LOCATIONS.map((dc, i) => {
      // Simulate: most are normal, a few have warnings
      const sev = i === 0 ? 1 : i === 4 ? 2 : i === 7 ? 3 : 0;
      return {
        ...dc,
        severity: sev,
        devices_total: Math.floor(dc.racks / 50) * 4 + 4,
        devices_online: Math.floor(dc.racks / 50) * 4 + (sev > 0 ? 3 : 4),
        last_event: sev > 0 ? new Date(Date.now() - Math.random() * 3600000).toISOString() : undefined,
      };
    });
    setDcList(statuses);
  }, []);

  const filtered = filter === "all"
    ? dcList
    : filter === "alerts"
    ? dcList.filter(dc => dc.severity > 0)
    : dcList.filter(dc => dc.severity === 0);

  const alertCount = dcList.filter(dc => dc.severity > 0).length;
  const criticalCount = dcList.filter(dc => dc.severity >= 3).length;
  const totalDevices = dcList.reduce((sum, dc) => sum + dc.devices_total, 0);
  const onlineDevices = dcList.reduce((sum, dc) => sum + dc.devices_online, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-gray-400 text-sm hover:text-white">
              &larr; Dashboard
            </Link>
            <h1 className="text-xl font-bold mt-1">Fleet Overview</h1>
            <p className="text-gray-400 text-sm">NVIDIA UK Data Centre Network</p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-2xl font-bold">{dcList.length}</div>
              <div className="text-xs text-gray-400">Data Centres</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">{onlineDevices}/{totalDevices}</div>
              <div className="text-xs text-gray-400">Devices Online</div>
            </div>
            {criticalCount > 0 && (
              <div>
                <div className="text-2xl font-bold text-red-500 animate-pulse">{criticalCount}</div>
                <div className="text-xs text-red-400">Critical</div>
              </div>
            )}
            {alertCount > 0 && (
              <div>
                <div className="text-2xl font-bold text-yellow-500">{alertCount}</div>
                <div className="text-xs text-yellow-400">Alerts</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-100px)]">
        {/* Map area */}
        <div className="flex-1 relative bg-gray-900 overflow-hidden">
          {/* SVG map of UK with positioned pins */}
          <svg viewBox="-8 49 12 10" className="w-full h-full" style={{ background: "#0f172a" }}>
            {/* Simplified UK outline */}
            <path
              d="M-5.5 50.3 L-4.8 50.5 L-4.2 50.8 L-3.5 51.0 L-3.0 51.2 L-2.5 51.3 L-1.8 51.4 L-1.0 51.3 L-0.2 51.4 L0.5 51.5 L1.3 51.8 L1.6 52.0 L1.8 52.5 L1.7 52.8 L1.4 53.0 L0.5 52.9 L0.2 53.2 L-0.2 53.4 L-0.8 53.3 L-1.2 53.5 L-1.5 53.8 L-2.0 54.0 L-2.8 54.1 L-3.0 54.5 L-2.5 54.8 L-1.8 55.0 L-1.5 55.5 L-2.0 55.8 L-2.5 56.0 L-3.0 56.2 L-3.5 56.5 L-4.0 56.8 L-4.5 57.0 L-5.0 57.5 L-5.5 57.8 L-5.0 58.0 L-4.0 58.2 L-3.5 58.5 L-3.0 58.0 L-2.5 57.5 L-1.8 57.2 L-2.0 56.8 L-1.5 56.3 L-1.2 55.8 L-1.5 55.3 L-0.5 55.0 L-0.2 54.5 L-0.5 54.0 L-1.0 53.8 L-0.8 53.2 L0.0 53.5 L0.5 53.4 L-0.2 53.0 L0.3 52.5 L1.2 52.8 L1.5 52.3 L1.0 51.8 L0.3 51.6 L-0.5 51.5 L-1.5 51.3 L-2.5 51.2 L-3.5 51.0 L-4.5 50.7 L-5.5 50.3 Z"
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="0.03"
            />
            {/* Ireland outline (simplified) */}
            <path
              d="M-6.5 51.5 L-6.0 51.8 L-5.5 52.5 L-6.0 53.0 L-6.5 53.5 L-7.0 54.0 L-7.5 54.5 L-7.0 55.0 L-6.5 55.3 L-6.0 55.0 L-5.5 54.5 L-5.8 54.0 L-6.0 53.5 L-5.5 53.0 L-5.8 52.5 L-6.0 52.0 L-6.5 51.5 Z"
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="0.03"
            />

            {/* Data centre pins */}
            {filtered.map(dc => (
              <g
                key={dc.code}
                className="cursor-pointer"
                onClick={() => setSelectedDC(dc)}
                style={{ transition: "transform 0.2s" }}
              >
                <circle
                  cx={dc.lng}
                  cy={-dc.lat + 105}
                  r={dc.severity >= 3 ? 0.18 : 0.14}
                  fill={SEV_COLORS[dc.severity]}
                  stroke={selectedDC?.code === dc.code ? "white" : "rgba(0,0,0,0.5)"}
                  strokeWidth={selectedDC?.code === dc.code ? 0.04 : 0.02}
                  opacity={dc.severity >= 3 ? 1 : 0.85}
                />
                {dc.severity >= 3 && (
                  <circle
                    cx={dc.lng}
                    cy={-dc.lat + 105}
                    r={0.25}
                    fill="none"
                    stroke={SEV_COLORS[dc.severity]}
                    strokeWidth={0.02}
                    opacity={0.5}
                  >
                    <animate attributeName="r" from="0.18" to="0.35" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            ))}
          </svg>

          {/* Filter buttons */}
          <div className="absolute top-4 left-4 flex gap-2">
            {[
              { key: "all", label: `All (${dcList.length})` },
              { key: "alerts", label: `Alerts (${alertCount})` },
              { key: "normal", label: `Normal (${dcList.length - alertCount})` },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-teal-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar — DC list + detail panel */}
        <div className="w-96 border-l border-gray-800 overflow-y-auto">
          {selectedDC ? (
            <div className="p-4">
              <button
                onClick={() => setSelectedDC(null)}
                className="text-gray-400 text-sm hover:text-white mb-3"
              >
                &larr; Back to list
              </button>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: SEV_COLORS[selectedDC.severity] }}
                />
                <div>
                  <h2 className="font-bold text-lg">{selectedDC.name}</h2>
                  <p className="text-gray-400 text-sm">{selectedDC.city} | {selectedDC.code}</p>
                </div>
              </div>

              <div
                className="px-4 py-2 rounded-lg text-sm font-medium mb-4"
                style={{
                  backgroundColor: selectedDC.severity >= 3 ? "#7f1d1d" : selectedDC.severity >= 1 ? "#78350f" : "#14532d",
                  color: "white",
                }}
              >
                {SEV_LABELS[selectedDC.severity]}
                {selectedDC.last_event && (
                  <span className="text-xs opacity-70 ml-2">
                    {new Date(selectedDC.last_event).toLocaleTimeString()}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xl font-bold">{selectedDC.racks}</div>
                  <div className="text-xs text-gray-400">Total Racks</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xl font-bold">{selectedDC.kw.toLocaleString()} kW</div>
                  <div className="text-xs text-gray-400">Power Capacity</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xl font-bold text-green-400">
                    {selectedDC.devices_online}/{selectedDC.devices_total}
                  </div>
                  <div className="text-xs text-gray-400">Devices Online</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xl font-bold">4</div>
                  <div className="text-xs text-gray-400">Subsystems</div>
                </div>
              </div>

              <h3 className="text-sm font-medium text-gray-400 mb-2">Monitoring Subsystems</h3>
              <div className="space-y-2">
                {[
                  { name: "Battery Off-Gas", icon: "H2", status: selectedDC.severity >= 1 ? "alert" : "normal" },
                  { name: "VESDA Aspiration", icon: "VA", status: "normal" },
                  { name: "Suppression System", icon: "SP", status: "normal" },
                  { name: "Fire Panel", icon: "FP", status: "normal" },
                ].map(sub => (
                  <div key={sub.name} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-gray-700 px-2 py-0.5 rounded">{sub.icon}</span>
                      <span className="text-sm">{sub.name}</span>
                    </div>
                    <span className={`text-xs font-medium ${sub.status === "alert" ? "text-yellow-400" : "text-green-400"}`}>
                      {sub.status === "alert" ? "Alert" : "Normal"}
                    </span>
                  </div>
                ))}
              </div>

              <Link
                href="/dashboard"
                className="block mt-4 text-center bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg text-sm font-medium transition"
              >
                Open Device Dashboard
              </Link>
            </div>
          ) : (
            <div>
              <div className="p-4 border-b border-gray-800">
                <h2 className="font-bold text-sm text-gray-400 uppercase tracking-wide">
                  Data Centres ({filtered.length})
                </h2>
              </div>
              <div className="divide-y divide-gray-800">
                {filtered
                  .sort((a, b) => b.severity - a.severity)
                  .map(dc => (
                    <button
                      key={dc.code}
                      onClick={() => setSelectedDC(dc)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-800/50 transition flex items-center gap-3"
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: SEV_COLORS[dc.severity] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{dc.name}</div>
                        <div className="text-xs text-gray-500">{dc.city} | {dc.devices_online}/{dc.devices_total} online</div>
                      </div>
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: dc.severity >= 3 ? "#7f1d1d" : dc.severity >= 1 ? "#78350f" : "#14532d",
                          color: "white",
                        }}
                      >
                        {SEV_LABELS[dc.severity]}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
