// SmokeSense DataGuard Simulator — run with: node dataguard_sim.mjs
// Simulates battery off-gas thermal runaway event for demo/pitch

import mqtt from "mqtt";

const DEVICE_ID = "DG-SIMULATOR";
const ORG = "nvidia-dc-uk";
const BROKER = "mqtt://broker.hivemq.com:1883";
const client = mqtt.connect(BROKER, { clientId: `dg-sim-${Date.now()}` });

let tick = 0;
let h2 = 5, co = 2, voc = 50, temp = 22;
let supp_pressure = 25.0;
let discharged = false;
let phase = "normal"; // normal, offgas, escalating, critical, emergency, clearing

client.on("connect", () => {
  console.log("DataGuard Simulator connected to MQTT\n");
  console.log("Phases: normal(0-40s) → offgas(40-80s) → escalating(80-120s) → critical(120-150s) → emergency(150-170s) → clearing(170s+)\n");

  client.publish(`smokesense/${ORG}/${DEVICE_ID}/status`,
    JSON.stringify({ status: "online", device: DEVICE_ID, firmware: "1.0.0-sim", type: "dataguard", ip: "10.0.1.50", rssi: -35 }),
    { retain: true });

  client.subscribe(`smokesense/${ORG}/${DEVICE_ID}/cmd`);

  setInterval(() => {
    tick++;
    const t = tick * 2; // seconds elapsed

    // Simulate thermal runaway timeline
    if (t < 40) {
      phase = "normal";
      h2 = 5 + Math.random() * 2;
      co = 2 + Math.random() * 1;
      voc = 50 + Math.random() * 20;
      temp = 22 + Math.random() * 0.5;
    } else if (t < 80) {
      phase = "offgas";
      h2 = 5 + (t - 40) * 0.8 + Math.random() * 3;
      co = 2 + (t - 40) * 0.3 + Math.random() * 2;
      voc = 50 + (t - 40) * 8 + Math.random() * 30;
      temp = 22 + (t - 40) * 0.05;
    } else if (t < 120) {
      phase = "escalating";
      h2 = 40 + (t - 80) * 2 + Math.random() * 5;
      co = 15 + (t - 80) * 0.8 + Math.random() * 3;
      voc = 400 + (t - 80) * 20 + Math.random() * 50;
      temp = 24 + (t - 80) * 0.1;
    } else if (t < 150) {
      phase = "critical";
      h2 = 120 + (t - 120) * 3 + Math.random() * 10;
      co = 50 + (t - 120) * 1.5;
      voc = 1200 + (t - 120) * 30;
      temp = 28 + (t - 120) * 0.2;
    } else if (t < 170) {
      phase = "emergency";
      h2 = 200 + Math.random() * 30;
      co = 90 + Math.random() * 15;
      voc = 2000 + Math.random() * 200;
      temp = 34 + Math.random() * 2;
      if (t === 160 && !discharged) {
        discharged = true;
        supp_pressure = 0;
        console.log("\n>>> SUPPRESSION DISCHARGED <<<\n");
      }
    } else {
      phase = "clearing";
      h2 = Math.max(5, h2 * 0.92);
      co = Math.max(2, co * 0.94);
      voc = Math.max(50, voc * 0.90);
      temp = Math.max(22, temp - 0.1);
      if (t > 220) { discharged = false; supp_pressure = 25; tick = 0; } // restart cycle
    }

    // Calculate severity
    const h2_delta = Math.max(0, h2 - 5);
    const co_delta = Math.max(0, co - 2);
    let sev = 0;
    if (h2_delta >= 150 || discharged) sev = 4;
    else if (h2_delta >= 50) sev = 3;
    else if (h2_delta >= 15 && co_delta >= 10) sev = 2;
    else if (h2_delta >= 15 || co_delta >= 10) sev = 1;

    const stages = ["normal", "early_warning", "pre_alarm", "critical", "emergency"];
    const vesda_pct = Math.min(100, h2_delta * 0.3);

    const telemetry = {
      dev: DEVICE_ID, ts: Date.now(), fw: "1.0.0-sim", type: "dataguard",
      uptime: t, sev, stage: stages[sev], source: sev > 0 ? "h2_offgas" : "none",
      silenced: false,
      gas: {
        h2_ppm: Math.round(h2 * 10) / 10,
        co_ppm: Math.round(co * 10) / 10,
        voc_ppb: Math.round(voc),
        h2_delta: Math.round(h2_delta * 10) / 10,
        co_delta: Math.round(co_delta * 10) / 10,
        voc_delta: Math.round(Math.max(0, voc - 50)),
        h2_rate: Math.round((h2_delta / Math.max(1, (t - 40) / 60)) * 10) / 10,
        co_rate: Math.round((co_delta / Math.max(1, (t - 40) / 60)) * 10) / 10,
        h2_bl: 5, co_bl: 2,
      },
      env: { temp: Math.round(temp * 10) / 10, temp_rate: 0.1 },
      vesda: { ma: 4 + vesda_pct * 0.16, smoke_pct: Math.round(vesda_pct * 10) / 10, sev: Math.min(4, Math.floor(vesda_pct / 20)) },
      suppression: {
        pressure_bar: Math.round(supp_pressure * 10) / 10,
        pressure_pct: Math.round((supp_pressure / 25) * 100),
        pressure_low: supp_pressure < 20,
        discharged, door_open: false, manual_release: false,
      },
      panel_alarm: sev >= 3,
      // Dashboard compatibility
      smoke: sev >= 1, smoulder: false, mq2_alm: false,
      delta: Math.round(h2_delta * 10) / 10,
      ir_blue: 0, fwd_back: 0,
      raw: { fwd_ir: 0, fwd_blu: 0, bck_ir: 0, bck_blu: 0, mq2: 0, temp: Math.round(temp * 10) / 10, hum: 45 },
      baseline: { fwd: 0, back: 0, mq2: 0 },
      rssi: -35, heap: 200000,
    };

    client.publish(`smokesense/${ORG}/${DEVICE_ID}/telemetry`, JSON.stringify(telemetry));

    const sevBars = ["░░░░░", "█░░░░", "██░░░", "███░░", "████░", "█████"];
    const colors = { normal: "\x1b[32m", offgas: "\x1b[33m", escalating: "\x1b[33m", critical: "\x1b[31m", emergency: "\x1b[91m", clearing: "\x1b[36m" };
    console.log(
      `${colors[phase]}[${phase.padEnd(11)}]\x1b[0m ${sevBars[sev]} ` +
      `H2=${h2.toFixed(1).padStart(6)} CO=${co.toFixed(1).padStart(5)} VOC=${voc.toFixed(0).padStart(5)} ` +
      `T=${temp.toFixed(1)}C Supp=${supp_pressure.toFixed(0)}bar${discharged ? " \x1b[91mDISCHARGED\x1b[0m" : ""}`
    );
  }, 2000);

  setInterval(() => {
    client.publish(`smokesense/${ORG}/${DEVICE_ID}/heartbeat`,
      JSON.stringify({ dev: DEVICE_ID, ts: Date.now(), type: "dataguard", uptime: tick * 2, rssi: -35, heap: 200000, msgs: tick, sev: 0, fw: "1.0.0-sim", supp_pct: Math.round((supp_pressure / 25) * 100) }));
  }, 30000);
});

client.on("message", (topic, msg) => {
  const data = JSON.parse(msg.toString());
  console.log(`\n>> COMMAND: ${data.cmd}\n`);
});

console.log("SmokeSense DataGuard Simulator");
console.log(`Device: ${DEVICE_ID} | Org: ${ORG}`);
console.log("Simulates full thermal runaway cycle every ~4 minutes\n");
