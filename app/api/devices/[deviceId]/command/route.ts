import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import mqtt from "mqtt";

// POST /api/devices/[deviceId]/command
// Body: { "cmd": "silence" | "test" | "recalibrate" | "reboot" | "identify", ...params }

export async function POST(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  const { deviceId } = params;
  const body = await request.json();
  const { cmd, ...rest } = body;

  if (!cmd) {
    return NextResponse.json({ error: "Missing cmd field" }, { status: 400 });
  }

  const validCommands = ["silence", "test", "recalibrate", "reboot", "identify"];
  if (!validCommands.includes(cmd)) {
    return NextResponse.json({ error: `Invalid command: ${cmd}` }, { status: 400 });
  }

  // Look up device to get org slug for topic routing
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

  // Publish command to MQTT
  const topic = `${process.env.MQTT_TOPIC_PREFIX || "smokesense"}/${orgSlug}/${deviceId}/cmd`;
  const payload = JSON.stringify({ cmd, ...rest });

  try {
    await publishMqtt(topic, payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: "MQTT publish failed", detail: err.message },
      { status: 502 }
    );
  }

  // Log command as event
  await supabase.from("events").insert({
    device_id: deviceId,
    org_id: device.org_id,
    event_type: "cmd_sent",
    payload: { cmd, ...rest, topic },
  });

  return NextResponse.json({ ok: true, topic, cmd });
}

// ── MQTT publish helper (connect, publish, disconnect) ──
// For low-frequency command publishing, a transient connection
// is simpler than maintaining a persistent client in a serverless
// environment. For high-frequency use, switch to a shared client.

function publishMqtt(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://broker.hivemq.com:1883";
    const opts: mqtt.IClientOptions = {
      clientId: `smokesense-api-${Date.now()}`,
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
      client.publish(topic, payload, { qos: 1 }, (err) => {
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
