import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireSuperadmin } from "@/lib/auth";
import mqtt from "mqtt";

// Device ids must be a strict slug — never allow MQTT wildcards/separators
// (+, #, /) into the topic path.
const DEVICE_ID_RE = /^[A-Za-z0-9_-]+$/;

// POST /api/devices/[deviceId]/config
// Body: a JSON object of ONLY the runtime-config keys to change, e.g.
//   { "vesda_present": false, "thr_vesda_low": 4, "adpd_fullscale": 45000 }
// The device merges, persists to NVS, applies live, and reports confstate.
export async function POST(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  const admin = await requireSuperadmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { deviceId } = params;
  if (!DEVICE_ID_RE.test(deviceId)) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }

  const patch = await request.json();

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "Body must be a config object" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data: device } = await supabase
    .from("devices")
    .select("device_id, org_id, organizations(slug)")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const orgSlug = (device as any).organizations?.slug || "default";
  // Build the topic from the DB-verified device id + slug, never the raw
  // request param.
  const safeDeviceId = (device as any).device_id as string;
  const topic = `${process.env.MQTT_TOPIC_PREFIX || "smokesense"}/${orgSlug}/${safeDeviceId}/config`;

  // Merge the patch onto the last-known config so the retained message always
  // carries complete intended state (a reconnecting device gets everything).
  const { data: existing } = await supabase
    .from("device_config")
    .select("config")
    .eq("device_id", deviceId)
    .maybeSingle();
  const merged = { ...(existing?.config || {}), ...patch };

  try {
    await publishMqtt(topic, JSON.stringify(merged));
  } catch (err: any) {
    return NextResponse.json(
      { error: "MQTT publish failed", detail: err.message },
      { status: 502 }
    );
  }

  await supabase.from("device_config").upsert(
    {
      device_id: deviceId,
      org_id: device.org_id,
      config: merged,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "device_id" }
  );

  await supabase.from("events").insert({
    device_id: deviceId,
    org_id: device.org_id,
    event_type: "config_changed",
    payload: { patch, topic, by: admin.email },
  });

  return NextResponse.json({ ok: true, topic, patch });
}

// Transient MQTT publish (same pattern as the command route).
function publishMqtt(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fail closed: never fall back to the public, unauthenticated broker in
    // production. Only allow the convenience fallback for local dev.
    const brokerUrl =
      process.env.MQTT_BROKER_URL ||
      (process.env.NODE_ENV === "production" ? "" : "mqtt://broker.hivemq.com:1883");
    if (!brokerUrl) {
      reject(new Error("MQTT_BROKER_URL must be set in production"));
      return;
    }
    const opts: mqtt.IClientOptions = {
      clientId: `smokesense-cfg-${Date.now()}`,
      connectTimeout: 5000,
    };
    if (process.env.MQTT_USERNAME) {
      opts.username = process.env.MQTT_USERNAME;
      opts.password = process.env.MQTT_PASSWORD;
    }

    const client = mqtt.connect(brokerUrl, opts);
    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT connection timeout"));
    }, 8000);

    client.on("connect", () => {
      // retain=true so a device that is briefly offline picks up the latest
      // config when it reconnects.
      client.publish(topic, payload, { qos: 1, retain: true }, (err) => {
        clearTimeout(timeout);
        client.end();
        if (err) reject(err);
        else resolve();
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    });
  });
}
