/**
 * ═══════════════════════════════════════════════════════════
 *  SmokeSense — MQTT → Supabase Bridge Service
 *  Arctic Engineering — April 2026
 * ═══════════════════════════════════════════════════════════
 *
 *  Subscribes to all device MQTT topics, writes telemetry
 *  and events to Supabase, updates device status, and
 *  broadcasts realtime updates to connected dashboards.
 *
 *  Deploy: Railway / Fly.io / any Node.js host
 *  Run:    node mqtt_bridge.js
 *
 *  MQTT topics handled:
 *    smokesense/+/+/telemetry  → INSERT telemetry row
 *    smokesense/+/+/event      → INSERT event row + push notification
 *    smokesense/+/+/status     → UPDATE device online/offline
 *    smokesense/+/+/heartbeat  → UPDATE device last_seen
 */

import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ── Config ──────────────────────────────────────────
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  mqttUrl: process.env.MQTT_BROKER_URL || "mqtt://broker.hivemq.com:1883",
  mqttUser: process.env.MQTT_USERNAME || "",
  mqttPass: process.env.MQTT_PASSWORD || "",
  topicPrefix: process.env.MQTT_TOPIC_PREFIX || "smokesense",
  port: parseInt(process.env.PORT || "3500"),
  logLevel: process.env.LOG_LEVEL || "info",
};

// ── Validate ────────────────────────────────────────
if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

// ── Supabase client (service role — bypasses RLS) ───
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: false },
});

// ── State ───────────────────────────────────────────
const deviceCache = new Map(); // device_id → org_id lookup cache
let mqttClient = null;
let stats = {
  telemetry_count: 0,
  event_count: 0,
  status_count: 0,
  errors: 0,
  started_at: new Date().toISOString(),
};

// ── Telemetry batch buffer ──────────────────────────
// Batching prevents hammering Supabase with individual
// inserts at 2s intervals × N devices.
let telemetryBuffer = [];
const BATCH_SIZE = 20;
const BATCH_INTERVAL_MS = 5000; // flush every 5 seconds

// ═════════════════════════════════════════════════════
//  MQTT CONNECTION
// ═════════════════════════════════════════════════════

function connectMqtt() {
  const opts = {
    clientId: `smokesense-bridge-${Date.now()}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 5000,
  };

  if (CONFIG.mqttUser) {
    opts.username = CONFIG.mqttUser;
    opts.password = CONFIG.mqttPass;
  }

  log("info", `Connecting to MQTT: ${CONFIG.mqttUrl}`);
  mqttClient = mqtt.connect(CONFIG.mqttUrl, opts);

  mqttClient.on("connect", () => {
    log("info", "MQTT connected.");

    // Subscribe to all device channels using wildcards
    const topics = [
      `${CONFIG.topicPrefix}/+/+/telemetry`,
      `${CONFIG.topicPrefix}/+/+/event`,
      `${CONFIG.topicPrefix}/+/+/status`,
      `${CONFIG.topicPrefix}/+/+/heartbeat`,
    ];

    topics.forEach((t) => {
      mqttClient.subscribe(t, { qos: 1 }, (err) => {
        if (err) log("error", `Subscribe failed: ${t}`, err);
        else log("info", `Subscribed: ${t}`);
      });
    });
  });

  mqttClient.on("message", handleMessage);

  mqttClient.on("error", (err) => {
    log("error", "MQTT error:", err.message);
    stats.errors++;
  });

  mqttClient.on("reconnect", () => {
    log("warn", "MQTT reconnecting...");
  });

  mqttClient.on("close", () => {
    log("warn", "MQTT connection closed.");
  });
}

// ═════════════════════════════════════════════════════
//  MESSAGE ROUTER
// ═════════════════════════════════════════════════════

async function handleMessage(topic, payload) {
  try {
    const parts = topic.split("/");
    // Expected: smokesense/{org_id}/{device_id}/{channel}
    if (parts.length < 4) return;

    const [, orgSlug, deviceId, channel] = parts;

    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      log("warn", `Invalid JSON on ${topic}`);
      return;
    }

    // Resolve org_id from slug (cached)
    const orgId = await resolveOrgId(orgSlug);

    switch (channel) {
      case "telemetry":
        await handleTelemetry(deviceId, orgId, data);
        break;
      case "event":
        await handleEvent(deviceId, orgId, data);
        break;
      case "status":
        await handleStatus(deviceId, orgId, data);
        break;
      case "heartbeat":
        await handleHeartbeat(deviceId, orgId, data);
        break;
      default:
        log("debug", `Unknown channel: ${channel}`);
    }
  } catch (err) {
    log("error", `Error handling message on ${topic}:`, err.message);
    stats.errors++;
  }
}

// ═════════════════════════════════════════════════════
//  TELEMETRY — batched insert
// ═════════════════════════════════════════════════════

async function handleTelemetry(deviceId, orgId, data) {
  const row = {
    device_id: deviceId,
    org_id: orgId,
    severity: data.sev ?? 0,
    stage: data.stage ?? "clear",
    is_smoke: data.smoke ?? false,
    is_smouldering: data.smoulder ?? false,
    mq2_alarm: data.mq2_alm ?? false,
    scatter_delta: data.delta ?? 0,
    ir_blue_ratio: data.ir_blue ?? 0,
    fwd_back_ratio: data.fwd_back ?? 0,
    pd_fwd_ir: data.raw?.fwd_ir ?? 0,
    pd_fwd_blue: data.raw?.fwd_blu ?? 0,
    pd_back_ir: data.raw?.bck_ir ?? 0,
    pd_back_blue: data.raw?.bck_blu ?? 0,
    mq2: data.raw?.mq2 ?? 0,
    temperature: data.raw?.temp ?? 0,
    humidity: data.raw?.hum ?? 0,
    baseline_fwd: data.baseline?.fwd ?? 0,
    baseline_back: data.baseline?.back ?? 0,
    baseline_mq2: data.baseline?.mq2 ?? 0,
    rssi: data.rssi ?? 0,
    heap: data.heap ?? 0,
    uptime_s: data.uptime ?? 0,
  };

  telemetryBuffer.push(row);
  stats.telemetry_count++;

  // Flush if buffer is full
  if (telemetryBuffer.length >= BATCH_SIZE) {
    await flushTelemetry();
  }

  // Also update device record with latest values
  await updateDeviceLive(deviceId, data);

  // Broadcast to Supabase Realtime channel for live dashboards
  // (Cheaper than putting telemetry table on realtime publication)
  await broadcastRealtime(orgId, deviceId, "telemetry", row);
}

async function flushTelemetry() {
  if (telemetryBuffer.length === 0) return;

  const batch = [...telemetryBuffer];
  telemetryBuffer = [];

  const { error } = await supabase.from("telemetry").insert(batch);

  if (error) {
    log("error", `Telemetry batch insert failed (${batch.length} rows):`, error.message);
    stats.errors++;
    // Don't re-queue — telemetry is expendable, events are not
  } else {
    log("debug", `Telemetry batch: ${batch.length} rows inserted.`);
  }
}

// ═════════════════════════════════════════════════════
//  EVENTS — individual insert + push notification
// ═════════════════════════════════════════════════════

async function handleEvent(deviceId, orgId, data) {
  const row = {
    device_id: deviceId,
    org_id: orgId,
    event_type: data.type ?? "unknown",
    from_stage: data.from_stage,
    to_stage: data.to_stage,
    severity: data.severity ?? 0,
    scatter_delta: data.delta,
    ir_blue_ratio: data.ir_blue,
    is_smoke: data.is_smoke,
    temperature: data.temp,
    humidity: data.hum,
    mq2: data.mq2,
    payload: data,
  };

  const { error } = await supabase.from("events").insert(row);

  if (error) {
    log("error", `Event insert failed for ${deviceId}:`, error.message);
    stats.errors++;
  } else {
    stats.event_count++;
    log("info", `EVENT [${deviceId}] ${data.type}: ${data.from_stage} → ${data.to_stage} (sev=${data.severity})`);
  }

  // Broadcast event to realtime
  await broadcastRealtime(orgId, deviceId, "event", row);

  // Push notification for escalations
  if (data.type === "escalation" && (data.severity ?? 0) >= 3) {
    await sendPushNotification(orgId, deviceId, data);
  }
}

// ═════════════════════════════════════════════════════
//  STATUS — device online/offline (LWT)
// ═════════════════════════════════════════════════════

async function handleStatus(deviceId, orgId, data) {
  const isOnline = data.status === "online";

  const update = {
    is_online: isOnline,
    last_seen: new Date().toISOString(),
  };

  if (isOnline) {
    update.firmware = data.firmware;
    update.ip_address = data.ip;
    update.rssi = data.rssi;
  }

  await upsertDevice(deviceId, orgId, update);
  stats.status_count++;

  log("info", `STATUS [${deviceId}] ${data.status}${isOnline ? ` (fw=${data.firmware}, ip=${data.ip})` : ""}`);

  // Broadcast status change
  await broadcastRealtime(orgId, deviceId, "status", { device_id: deviceId, ...update });
}

// ═════════════════════════════════════════════════════
//  HEARTBEAT — update last_seen + health
// ═════════════════════════════════════════════════════

async function handleHeartbeat(deviceId, orgId, data) {
  await upsertDevice(deviceId, orgId, {
    is_online: true,
    last_seen: new Date().toISOString(),
    rssi: data.rssi,
    firmware: data.fw,
    last_severity: data.sev ?? 0,
  });
}

// ═════════════════════════════════════════════════════
//  DEVICE UPSERT + LIVE UPDATE
// ═════════════════════════════════════════════════════

async function upsertDevice(deviceId, orgId, fields) {
  // Try update first (faster for existing devices)
  const { data, error } = await supabase
    .from("devices")
    .update(fields)
    .eq("device_id", deviceId)
    .select("id")
    .maybeSingle();

  if (!data && !error) {
    // Device doesn't exist — create it (auto-register)
    const { error: insertErr } = await supabase.from("devices").insert({
      device_id: deviceId,
      org_id: orgId,
      name: deviceId,       // default name, user renames in dashboard
      zone: "Unassigned",
      ...fields,
    });
    if (insertErr) {
      log("error", `Device auto-register failed for ${deviceId}:`, insertErr.message);
    } else {
      log("info", `Auto-registered new device: ${deviceId}`);
    }
  }
}

async function updateDeviceLive(deviceId, data) {
  const update = {
    last_seen: new Date().toISOString(),
    last_severity: data.sev ?? 0,
    rssi: data.rssi,
    is_online: true,
  };

  if (data.baseline) {
    update.baseline_fwd = data.baseline.fwd;
    update.baseline_back = data.baseline.back;
    update.baseline_mq2 = data.baseline.mq2;
  }

  await supabase.from("devices").update(update).eq("device_id", deviceId);
}

// ═════════════════════════════════════════════════════
//  ORG ID RESOLUTION (slug → UUID, cached)
// ═════════════════════════════════════════════════════

async function resolveOrgId(slug) {
  if (deviceCache.has(`org:${slug}`)) {
    return deviceCache.get(`org:${slug}`);
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (data) {
    deviceCache.set(`org:${slug}`, data.id);
    return data.id;
  }

  // Auto-create org if it doesn't exist (first device from this org)
  const { data: newOrg, error: createErr } = await supabase
    .from("organizations")
    .insert({ name: slug, slug: slug })
    .select("id")
    .single();

  if (newOrg) {
    deviceCache.set(`org:${slug}`, newOrg.id);
    log("info", `Auto-created org: ${slug} (${newOrg.id})`);
    return newOrg.id;
  }

  log("error", `Failed to resolve org: ${slug}`, createErr?.message);
  return null;
}

// ═════════════════════════════════════════════════════
//  SUPABASE REALTIME BROADCAST
// ═════════════════════════════════════════════════════

async function broadcastRealtime(orgId, deviceId, type, payload) {
  // Broadcast on org-scoped channel so only that org's dashboards receive it
  const channelName = `org:${orgId}`;

  try {
    const channel = supabase.channel(channelName);
    await channel.send({
      type: "broadcast",
      event: type,
      payload: { device_id: deviceId, ...payload },
    });
    // Unsubscribe immediately — bridge is fire-and-forget
    supabase.removeChannel(channel);
  } catch (err) {
    // Realtime broadcast failures are non-critical
    log("debug", `Realtime broadcast failed for ${channelName}:`, err.message);
  }
}

// ═════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS (FCM — optional)
// ═════════════════════════════════════════════════════

async function sendPushNotification(orgId, deviceId, eventData) {
  if (!process.env.FCM_SERVER_KEY || process.env.FCM_ENABLED !== "true") {
    return; // FCM not configured
  }

  // Get device name for readable notification
  const { data: device } = await supabase
    .from("devices")
    .select("name, zone")
    .eq("device_id", deviceId)
    .maybeSingle();

  const deviceName = device?.name || deviceId;
  const zone = device?.zone || "";

  const severity = eventData.severity ?? 0;
  const stageLabels = ["Clear", "Alert", "Action", "Fire 1", "FIRE 2"];
  const stageName = stageLabels[Math.min(severity, 4)];

  const title = severity >= 4
    ? `FIRE ALARM — ${deviceName}`
    : `${stageName} — ${deviceName}`;

  const body = severity >= 4
    ? `Evacuate immediately. ${zone}. Smoke level critical.`
    : `Smoke detected at ${deviceName} (${zone}). Stage: ${stageName}.`;

  // Get FCM tokens for all users in this org
  // (Store FCM tokens in a separate table — out of scope here,
  //  but the pattern is: query org_members → get user FCM tokens → send)
  log("info", `PUSH: [${orgId}] ${title} — ${body}`);

  // TODO: Implement FCM HTTP v1 API call here
  // fetch('https://fcm.googleapis.com/v1/projects/{project}/messages:send', ...)
}

// ═════════════════════════════════════════════════════
//  MQTT → DEVICE COMMANDS (dashboard → device)
// ═════════════════════════════════════════════════════

// Call this from your Next.js API route to send commands
// back to devices. The bridge itself doesn't expose HTTP
// for commands — instead, your Next.js API publishes
// directly to MQTT. But if you want the bridge to proxy:

function sendCommand(orgSlug, deviceId, command, params = {}) {
  if (!mqttClient || !mqttClient.connected) {
    log("error", "Cannot send command — MQTT not connected.");
    return false;
  }

  const topic = `${CONFIG.topicPrefix}/${orgSlug}/${deviceId}/cmd`;
  const payload = JSON.stringify({ cmd: command, ...params });

  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      log("error", `Command publish failed: ${topic}`, err.message);
    } else {
      log("info", `CMD → [${deviceId}] ${command}`);
    }
  });

  return true;
}

// Export for use as a module (e.g., from an Express API)
export { sendCommand };

// ═════════════════════════════════════════════════════
//  HEALTH CHECK HTTP SERVER
// ═════════════════════════════════════════════════════

import http from "http";

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          mqtt: mqttClient?.connected ?? false,
          stats,
          uptime: process.uptime(),
          buffer: telemetryBuffer.length,
        })
      );
    } else if (req.url === "/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(CONFIG.port, () => {
    log("info", `Health server on port ${CONFIG.port}`);
  });
}

// ═════════════════════════════════════════════════════
//  LOGGING
// ═════════════════════════════════════════════════════

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, ...args) {
  if (LOG_LEVELS[level] >= LOG_LEVELS[CONFIG.logLevel]) {
    const ts = new Date().toISOString().slice(11, 23);
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      `[${ts}] [${level.toUpperCase()}]`,
      ...args
    );
  }
}

// ═════════════════════════════════════════════════════
//  STARTUP
// ═════════════════════════════════════════════════════

log("info", "═══════════════════════════════════════");
log("info", "  SmokeSense MQTT Bridge v1.0");
log("info", "  Arctic Engineering");
log("info", "═══════════════════════════════════════");
log("info", `Supabase: ${CONFIG.supabaseUrl}`);
log("info", `MQTT:     ${CONFIG.mqttUrl}`);
log("info", `Prefix:   ${CONFIG.topicPrefix}`);

connectMqtt();
startHealthServer();

// Periodic telemetry flush
setInterval(flushTelemetry, BATCH_INTERVAL_MS);

// Periodic device offline check — mark devices as offline
// if no heartbeat received in 2 minutes
setInterval(async () => {
  const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
  const { error } = await supabase
    .from("devices")
    .update({ is_online: false })
    .eq("is_online", true)
    .lt("last_seen", twoMinAgo);

  if (error) {
    log("error", "Offline check failed:", error.message);
  }
}, 60_000);

// Graceful shutdown
process.on("SIGTERM", async () => {
  log("info", "Shutting down...");
  await flushTelemetry();
  mqttClient?.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  log("info", "Interrupted. Flushing...");
  await flushTelemetry();
  mqttClient?.end();
  process.exit(0);
});
