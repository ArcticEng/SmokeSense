// ════════════════════════════════════════════════════════════════════
//  SmokeSense DataGuard — Device Simulator
//  Emits the FULL current telemetry contract (gas / env / vesda / chamber /
//  suppression / classifier / particles + flat optical) so the live
//  dashboard lights up end-to-end with no physical hardware.
//
//  Pipeline:  this sim ──MQTT──▶ broker ──▶ mqtt-bridge ──▶ Supabase ──▶ dashboard
//
//  Prerequisites for it to appear on the dashboard:
//    1. The three Supabase migrations have been applied.
//    2. The mqtt-bridge is running and pointed at the SAME broker + Supabase.
//    3. SIM_ORG matches the org slug your dashboard login belongs to (demo).
//
//  Run:        node dataguard_sim.mjs
//  Dry-run:    SIM_DRYRUN=1 node dataguard_sim.mjs      (prints frames, no MQTT)
//  Faster:     SIM_SPEED=4 node dataguard_sim.mjs
//  Config:     BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_TOPIC_PREFIX,
//              SIM_ORG, SIM_DEVICE, TICK_MS, SIM_SPEED, SIM_DRYRUN
// ════════════════════════════════════════════════════════════════════

const CFG = {
  broker:   process.env.BROKER_URL || process.env.MQTT_BROKER_URL || "mqtt://switchback.proxy.rlwy.net:35720",
  username: process.env.MQTT_USERNAME || "dataguard",
  password: process.env.MQTT_PASSWORD || "DG_Device_Secret_2026!",
  prefix:   process.env.MQTT_TOPIC_PREFIX || "smokesense",
  org:      process.env.SIM_ORG || "demo",
  device:   process.env.SIM_DEVICE || "DG-SIM-001",
  tickMs:   parseInt(process.env.TICK_MS || "3000"),
  speed:    parseFloat(process.env.SIM_SPEED || "1"),
  dryrun:   process.env.SIM_DRYRUN === "1",
};

const STAGE_NAMES = ["normal", "early_warning", "pre_alarm", "critical", "emergency"];
const FIRE_TYPE_NAMES  = ["none","nuisance","battery_early","battery_runaway","smouldering","flaming","electrical"];
const FIRE_TYPE_LABELS = ["Normal","Nuisance (false alarm)","Battery off-gas (early)","Battery thermal runaway","Smouldering fire","Flaming fire","Electrical fault"];
const ACTION_NAMES  = ["monitor","alert","pre_alarm","critical","emergency"];
const ACTION_LABELS = ["Monitoring","Alert — investigate","Pre-alarm — prepare","Critical — suppression","Emergency — evacuate"];

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const norm  = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
const jit   = (x, p) => x + (Math.random() - 0.5) * 2 * p;
const lerp  = (a, b, x) => a + (b - a) * clamp(x, 0, 1);

// ── Scenario timeline (seconds). Loops continuously. ──
// normal → battery off-gas → smouldering escalation → flaming/critical → emergency → clearing
function scenario(t) {
  if (t < 30)  return { ft: 0, h2: 5,   co: 2,  voc: 60,   tRate: 0.1, smoke: 0,  temp: 22.5 };
  if (t < 70)  return { ft: 2, h2: lerp(5,55,(t-30)/40),    co: lerp(2,10,(t-30)/40),    voc: lerp(60,500,(t-30)/40),    tRate: 0.3, smoke: lerp(0,4,(t-30)/40),    temp: 23 };
  if (t < 110) return { ft: 4, h2: lerp(55,110,(t-70)/40),  co: lerp(10,45,(t-70)/40),   voc: lerp(500,1200,(t-70)/40),  tRate: 1.2, smoke: lerp(4,32,(t-70)/40),   temp: 26 };
  if (t < 140) return { ft: 3, h2: lerp(110,200,(t-110)/30),co: lerp(45,80,(t-110)/30),  voc: lerp(1200,2200,(t-110)/30),tRate: 4.0, smoke: lerp(32,68,(t-110)/30),temp: 34 };
  if (t < 160) return { ft: 3, h2: 210, co: 95, voc: 2400, tRate: 6.5, smoke: 82, temp: 44, discharge: true };
  return         { ft: 0, h2: lerp(210,8,(t-160)/30), co: lerp(95,3,(t-160)/30), voc: lerp(2400,80,(t-160)/30), tRate: 0.2, smoke: lerp(82,1,(t-160)/30), temp: lerp(44,24,(t-160)/30) };
}
const LOOP = 190; // seconds

// ── Derive classifier outputs from the simulated sensor values ──
function classify(s) {
  const scores = {
    h2:    norm(s.h2,   10, 200),
    co:    norm(s.co,   5,  80),
    voc:   norm(s.voc,  150, 2000),
    temp:  norm(s.tRate, 0.5, 5),
    smoke: norm(s.smoke, 3, 60),
  };
  const arr = Object.values(scores);
  const active = arr.filter((x) => x > 0.15);
  const mx = Math.max(...arr);
  const avg = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0;
  let confidence = Math.round(100 * (0.5 * mx + 0.5 * avg));
  if (s.ft === 0) confidence = Math.min(confidence, 12);
  const action = confidence >= 90 ? 4 : confidence >= 75 ? 3 : confidence >= 55 ? 2 : confidence >= 30 ? 1 : 0;
  const sensorsActive = arr.filter((x) => x > 0.3).length;
  return { scores, confidence, action, sensorsActive };
}

let tick = 0;
const boot = Date.now();
let prevSev = 0;
let sustainedMs = 0;
let silenced = false;

function build() {
  const elapsed = (tick * CFG.tickMs / 1000) * CFG.speed;
  const t = elapsed % LOOP;
  const s = scenario(t);
  const c = classify(s);
  const sev = c.action;
  const fireType = sev === 0 ? 0 : s.ft;
  if (sev >= 2) sustainedMs += CFG.tickMs; else sustainedMs = 0;
  const confirmed = sustainedMs >= 6000;

  const smoke = clamp(jit(s.smoke, 0.6), 0, 100);
  const flaming = s.ft === 5;
  const irBlue = r2(flaming ? jit(1.7, 0.1) : jit(1.0, 0.08));
  const fwdBack = r2(flaming ? jit(0.8, 0.05) : jit(1.4, 0.08));
  const delta = Math.round(smoke * 600 + jit(0, 50));
  const fwdIr = Math.round(20000 + smoke * 350 + jit(0, 80));
  const bckIr = Math.round(18000 + smoke * 300 + jit(0, 80));
  const t_rtd = r1(jit(s.temp, 0.15));
  const hum = Math.round(jit(45, 2));
  const fireHint = smoke < 3 ? 0 : flaming ? 2 : 1;

  return {
    dev: CFG.device, ts: Date.now(), fw: "2.0.0-sim", type: "dataguard",
    uptime: Math.round((Date.now() - boot) / 1000),
    sev, stage: STAGE_NAMES[Math.min(sev, 4)],
    source: sev > 0 ? FIRE_TYPE_NAMES[fireType] : "none",
    silenced, panel_alarm: false,
    smoke: sev >= 1, smoulder: !flaming && smoke > 3, mq2_alm: false,
    gas: {
      h2_ppm: r1(jit(s.h2, 1)), co_ppm: r1(jit(s.co, 0.6)), voc_ppb: Math.round(jit(s.voc, 8)),
      h2_delta: r1(s.h2 - 5), co_delta: r1(s.co - 2), voc_delta: Math.round(s.voc - 60),
      h2_rate: r1(s.tRate * 6), co_rate: r1(s.tRate * 2),
      h2_we_mv: Math.round(300 + s.h2), co_we_mv: Math.round(280 + s.co), h2_bl: 5, co_bl: 2,
    },
    env: {
      temp_bme: r1(t_rtd + 0.4), temp_rtd: t_rtd, humidity: hum,
      pressure: r1(jit(1013, 0.5)), voc_kohm: r1(jit(120 - s.voc / 30, 1)), temp_rate: r1(s.tRate),
    },
    vesda: { present: false, ma: 0, smoke_pct: 0, sev: 0 },
    chamber: { smoke_pct: r1(smoke), sev: smoke > 40 ? 3 : smoke > 15 ? 2 : smoke > 3 ? 1 : 0, source: "chamber" },
    suppression: {
      pressure_bar: r1(s.discharge ? 6 : jit(25, 0.3)), pressure_pct: Math.round(s.discharge ? 14 : 60),
      pressure_low: !!s.discharge, discharged: !!s.discharge, door_open: false,
    },
    classifier: {
      fire_type: FIRE_TYPE_NAMES[fireType], fire_label: FIRE_TYPE_LABELS[fireType],
      confidence: c.confidence, action: ACTION_NAMES[sev], action_label: ACTION_LABELS[sev],
      sensors_active: c.sensorsActive, sensors_agreeing: Math.max(0, c.sensorsActive - 1),
      confirmed, sustained_ms: sustainedMs,
      h2_score: Math.round(c.scores.h2 * 100), co_score: Math.round(c.scores.co * 100),
      voc_score: Math.round(c.scores.voc * 100), temp_score: Math.round(c.scores.temp * 100),
      vesda_score: Math.round(c.scores.smoke * 100),
    },
    particles: {
      pm1_0: Math.round(smoke * 1.1), pm2_5: Math.round(smoke * 2.2), pm10: Math.round(smoke * 2.6),
      cnt_0_3: Math.round(smoke * 30), cnt_1_0: Math.round(smoke * 12), cnt_2_5: Math.round(smoke * 4), cnt_10: Math.round(smoke),
      density: Math.round(smoke * 2), ratio: r2(flaming ? 0.85 : 0.45), fire_hint: fireHint,
    },
    delta, ir_blue: irBlue, fwd_back: fwdBack,
    raw: { fwd_ir: fwdIr, fwd_blu: Math.round(fwdIr * irBlue), bck_ir: bckIr, bck_blu: Math.round(bckIr * irBlue), mq2: 0, temp: t_rtd, hum },
    baseline: { fwd: 20000, back: 18000, mq2: 0 },
    rssi: -48 + Math.round(jit(0, 3)), heap: 210000 + Math.round(jit(0, 4000)), buffered: 0,
  };
}

function buildEvent(tel, oldSev, newSev) {
  return {
    dev: CFG.device, ts: Date.now(),
    type: newSev > oldSev ? "escalation" : "de-escalation",
    from_stage: STAGE_NAMES[Math.min(oldSev, 4)], to_stage: STAGE_NAMES[Math.min(newSev, 4)],
    severity: newSev, source: tel.classifier.fire_label,
    fire_type: tel.classifier.fire_type, fire_label: tel.classifier.fire_label,
    confidence: tel.classifier.confidence, action: tel.classifier.action,
    h2_ppm: tel.gas.h2_ppm, co_ppm: tel.gas.co_ppm, h2_rate: tel.gas.h2_rate,
    temp: tel.env.temp_rtd, temp_rate: tel.env.temp_rate, vesda_pct: tel.chamber.smoke_pct,
    discharged: tel.suppression.discharged, is_smoke: tel.smoke,
    delta: tel.delta, ir_blue: tel.ir_blue, mq2: 0, hum: tel.raw.hum,
  };
}

function logLine(tel) {
  const c = tel.classifier;
  console.log(
    `t+${String(tel.uptime).padStart(3)}s  sev=${tel.sev} ${tel.stage.padEnd(13)}` +
    `  H2=${String(tel.gas.h2_ppm).padStart(5)}  CO=${String(tel.gas.co_ppm).padStart(4)}` +
    `  smoke=${String(tel.chamber.smoke_pct).padStart(4)}%  conf=${String(c.confidence).padStart(3)}%` +
    `  ${c.fire_label}`
  );
}

// ── Dry-run: print a sweep of frames, no network ──
if (CFG.dryrun) {
  console.log("DRY-RUN — telemetry frames (no MQTT). One full scenario loop:\n");
  const frames = Math.ceil((LOOP / CFG.speed) / (CFG.tickMs / 1000)) + 2;
  for (let i = 0; i < frames; i++) {
    const tel = build();
    if (tel.sev !== prevSev) { console.log(`   ↳ EVENT ${prevSev}→${tel.sev}: ${buildEvent(tel, prevSev, tel.sev).type}`); prevSev = tel.sev; }
    logLine(tel);
    tick++;
  }
  console.log("\nSample full telemetry frame (mid-fire):");
  tick = Math.round((110 / CFG.speed) / (CFG.tickMs / 1000));
  console.log(JSON.stringify(build(), null, 2));
  process.exit(0);
}

// ── Live MQTT mode ──
const mqtt = (await import("mqtt")).default;
const topic = (ch) => `${CFG.prefix}/${CFG.org}/${CFG.device}/${ch}`;
const willPayload = JSON.stringify({ status: "offline", device: CFG.device });

const client = mqtt.connect(CFG.broker, {
  clientId: `dg-sim-${Date.now()}`,
  username: CFG.username, password: CFG.password,
  will: { topic: topic("status"), payload: willPayload, qos: 1, retain: true },
});

client.on("connect", () => {
  console.log(`DataGuard simulator connected → ${CFG.broker}`);
  console.log(`Publishing as ${CFG.device} under org "${CFG.org}". Ctrl-C to stop.\n`);
  client.publish(topic("status"), JSON.stringify({
    status: "online", device: CFG.device, firmware: "2.0.0-sim", type: "dataguard", ip: "10.0.1.50", rssi: -48,
  }), { retain: true });
  client.subscribe(topic("cmd"));
  client.subscribe(topic("config"));

  setInterval(() => {
    const tel = build();
    client.publish(topic("telemetry"), JSON.stringify(tel));
    if (tel.sev !== prevSev) {
      const ev = buildEvent(tel, prevSev, tel.sev);
      client.publish(topic("event"), JSON.stringify(ev));
      console.log(`   ↳ EVENT ${prevSev}→${tel.sev} (${ev.type})`);
      prevSev = tel.sev;
    }
    logLine(tel);
    tick++;
  }, CFG.tickMs);

  setInterval(() => {
    client.publish(topic("heartbeat"), JSON.stringify({
      dev: CFG.device, ts: Date.now(), type: "dataguard", uptime: Math.round((Date.now() - boot) / 1000),
      fw: "2.0.0-sim", sev: prevSev, rssi: -48, heap: 210000, msgs: tick,
    }));
  }, 15000);
});

client.on("message", (topicIn, payload) => {
  let msg = {}; try { msg = JSON.parse(payload.toString()); } catch {}
  if (topicIn.endsWith("/cmd")) {
    console.log(`   ← CMD received: ${msg.cmd}`);
    if (msg.cmd === "silence") silenced = true;
    if (msg.cmd === "reset_config" || msg.cmd === "test") silenced = false;
    client.publish(topic("event"), JSON.stringify({ dev: CFG.device, ts: Date.now(), type: "cmd_ack", cmd: msg.cmd, severity: prevSev }));
  } else if (topicIn.endsWith("/config")) {
    console.log(`   ← CONFIG patch received (${Object.keys(msg).length} keys); echoing confstate`);
    client.publish(topic("confstate"), JSON.stringify({ config: msg }), { retain: true });
  }
});

client.on("error", (e) => console.error("MQTT error:", e.message));
process.on("SIGINT", () => {
  console.log("\nStopping — marking offline.");
  client.publish(topic("status"), willPayload, { retain: true }, () => { client.end(); process.exit(0); });
});
