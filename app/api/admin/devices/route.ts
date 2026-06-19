import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireSuperadmin } from "@/lib/auth";

// GET /api/admin/devices — all devices across all orgs, with their reported
// runtime config. Superadmin only. Uses the service role to bypass org RLS.
export async function GET() {
  const admin = await requireSuperadmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServerSupabase();

  const { data: devices, error } = await supabase
    .from("devices")
    .select(
      "id, device_id, name, zone, org_id, firmware, ip_address, rssi, is_online, last_seen, last_severity, organizations(name, slug)"
    )
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: configs } = await supabase
    .from("device_config")
    .select("device_id, config, updated_at");

  const cfgMap = new Map((configs || []).map((c) => [c.device_id, c]));

  const merged = (devices || []).map((d) => ({
    ...d,
    org_name: (d as any).organizations?.name ?? null,
    org_slug: (d as any).organizations?.slug ?? null,
    config: cfgMap.get(d.device_id)?.config ?? null,
    config_updated_at: cfgMap.get(d.device_id)?.updated_at ?? null,
  }));

  return NextResponse.json({ devices: merged });
}
