import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// ── Browser client (used in components) ──
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Server client (used in API routes / server components) ──
export function createServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Types ──
export type AlarmStage = "clear" | "alert" | "action" | "fire1" | "fire2";

export interface Device {
  id: string;
  org_id: string;
  device_id: string;
  name: string;
  zone: string | null;
  firmware: string | null;
  ip_address: string | null;
  rssi: number | null;
  is_online: boolean;
  last_seen: string | null;
  last_severity: number;
  battery_pct: number | null;
  baseline_fwd: number | null;
  baseline_back: number | null;
  baseline_mq2: number | null;
  created_at: string;
}

export interface TelemetryRow {
  id: number;
  device_id: string;
  severity: number;
  stage: string;
  is_smoke: boolean;
  is_smouldering: boolean;
  scatter_delta: number;
  ir_blue_ratio: number;
  fwd_back_ratio: number;
  mq2: number;
  temperature: number;
  humidity: number;
  rssi: number;
  recorded_at: string;
}

export interface EventRow {
  id: number;
  device_id: string;
  event_type: string;
  from_stage: string | null;
  to_stage: string | null;
  severity: number;
  scatter_delta: number | null;
  is_smoke: boolean | null;
  temperature: number | null;
  payload: any;
  acknowledged: boolean;
  recorded_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  max_devices: number;
}

export const STAGE_META: Record<number, { key: AlarmStage; label: string; color: string; bg: string; border: string; desc: string }> = {
  0: { key: "clear",  label: "Clear",  color: "#22c55e", bg: "#052e16", border: "#166534", desc: "Normal air quality" },
  1: { key: "alert",  label: "Alert",  color: "#eab308", bg: "#422006", border: "#854d0e", desc: "Above normal — investigate" },
  2: { key: "action", label: "Action", color: "#f97316", bg: "#431407", border: "#9a3412", desc: "Rising smoke — respond now" },
  3: { key: "fire1",  label: "Fire 1", color: "#ef4444", bg: "#450a0a", border: "#991b1b", desc: "Pre-alarm — danger imminent" },
  4: { key: "fire2",  label: "Fire 2", color: "#dc2626", bg: "#2a0000", border: "#dc2626", desc: "FIRE — evacuate immediately" },
};
