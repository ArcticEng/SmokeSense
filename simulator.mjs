// SmokeSense Device Simulator — run with: node simulator.js
// Publishes fake telemetry to HiveMQ so the full stack lights up

import mqtt from "mqtt";

const DEVICE_ID = "SS-SIMULATOR";
const ORG = "demo";
const BROKER = "mqtt://switchback.proxy.rlwy.net:35720";

const client = mqtt.connect(BROKER, { clientId: `sim-${Date.now()}`, username: "node", password: "SS_Node_Secret_2026!" });

let severity = 0;
let delta = 0;
let tick = 0;

client.on("connect", () => {
  console.log("Connected to MQTT broker");

  // Publish online status
  client.publish(`smokesense/${ORG}/${DEVICE_ID}/status`,
    JSON.stringify({ status: "online", device: DEVICE_ID, firmware: "1.3.0-sim", ip: "192.168.1.99", rssi: -45 }),
    { retain: true }
  );

  // Subscribe to commands
  client.subscribe(`smokesense/${ORG}/${DEVICE_ID}/cmd`);

  // Telemetry every 2s
  setInterval(() => {
    tick++;

    // Simulate a smoke event every 60s (ramps up then clears)
    const cycle = tick % 60;
    if (cycle < 20) { delta = Math.min(delta + 15 + Math.random() * 20, 800); }
    else if (cycle < 30) { delta = Math.max(delta - 30, 0); }
    else { delta = Math.random() * 15; }

    // Classify
    if (delta > 700) severity = 4;
    else if (delta > 400) severity = 3;
    else if (delta > 200) severity = 2;
    else if (delta > 80) severity = 1;
    else severity = 0;

    const stages = ["clear", "alert", "action", "fire1", "fire2"];
    const temp = 22 + Math.random() * 3;
    const hum = 45 + Math.random() * 10;

    const telemetry = {
      dev: DEVICE_ID,
      ts: Date.now(),
      fw: "1.3.0-sim",
      uptime: tick * 2,
      sev: severity,
      stage: stages[severity],
      smoke: delta > 80,
      smoulder: delta > 200 && Math.random() > 0.5,
      mq2_alm: delta > 600,
      silenced: false,
      delta: Math.round(delta),
      ir_blue: delta > 50 ? 1.4 + Math.random() * 0.5 : 0.9,
      fwd_back: delta > 100 ? 2.5 + Math.random() : 1.1,
      raw: {
        fwd_ir: Math.round(200 + delta),
        fwd_blu: Math.round(150 + delta * 0.6),
        bck_ir: Math.round(100 + delta * 0.3),
        bck_blu: Math.round(80 + delta * 0.2),
        mq2: Math.round(300 + delta * 0.8),
        temp: Math.round(temp * 10) / 10,
        hum: Math.round(hum),
      },
      baseline: { fwd: 200, back: 100, mq2: 300 },
      rssi: -40 - Math.round(Math.random() * 20),
      heap: 180000 + Math.round(Math.random() * 20000),
    };

    client.publish(`smokesense/${ORG}/${DEVICE_ID}/telemetry`, JSON.stringify(telemetry));

    const bar = "█".repeat(Math.min(severity + 1, 5)) + "░".repeat(5 - Math.min(severity + 1, 5));
    console.log(`[${stages[severity].padEnd(6)}] ${bar} delta=${Math.round(delta).toString().padStart(3)} temp=${temp.toFixed(1)} mq2=${telemetry.raw.mq2}`);
  }, 2000);

  // Heartbeat every 30s
  setInterval(() => {
    client.publish(`smokesense/${ORG}/${DEVICE_ID}/heartbeat`,
      JSON.stringify({ dev: DEVICE_ID, ts: Date.now(), uptime: tick * 2, rssi: -45, heap: 190000, msgs: tick, sev: severity, fw: "1.3.0-sim" })
    );
  }, 30000);
});

// Handle commands from dashboard
client.on("message", (topic, msg) => {
  const data = JSON.parse(msg.toString());
  console.log(`\n>> COMMAND: ${data.cmd}\n`);

  if (data.cmd === "test") {
    client.publish(`smokesense/${ORG}/${DEVICE_ID}/event`,
      JSON.stringify({ type: "self_test", ir: true, blue: true, mq2: true, dht: true, wifi: true, mqtt: true, pass: true }));
  }
});

console.log(`\nSmokeSense Simulator — ${DEVICE_ID}`);
console.log(`Publishing to ${BROKER} on smokesense/${ORG}/${DEVICE_ID}/telemetry`);
console.log("Smoke event cycles every 60 ticks (~2 min)\n");
