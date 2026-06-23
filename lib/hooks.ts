"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createBrowserSupabase, Device, TelemetryRow, EventRow, Organization } from "./supabase";
import type { User, RealtimeChannel } from "@supabase/supabase-js";

const supabase = createBrowserSupabase();

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return { user, loading, signIn, signUp, signOut };
}

export function useOrganization() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("org_members")
        .select("org_id, organizations(*)")
        .limit(1)
        .maybeSingle();

      if (data?.organizations) {
        setOrg(data.organizations as unknown as Organization);
      }
      setLoading(false);
    }
    load();
  }, []);

  return { org, loading };
}

export function useDevices(orgId: string | undefined) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    async function load() {
      const { data } = await supabase
        .from("devices")
        .select("*")
        .eq("org_id", orgId)
        .order("name");

      if (data) setDevices(data);
      setLoading(false);
    }
    load();
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel("devices-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `org_id=eq.${orgId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setDevices((prev) => [...prev, payload.new as Device]);
          } else if (payload.eventType === "UPDATE") {
            setDevices((prev) =>
              prev.map((d) =>
                d.id === (payload.new as Device).id ? { ...d, ...(payload.new as Device) } : d
              )
            );
          } else if (payload.eventType === "DELETE") {
            setDevices((prev) => prev.filter((d) => d.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`org:${orgId}`)
      .on("broadcast", { event: "telemetry" }, ({ payload }) => {
        if (!payload) return;
        setDevices((prev) =>
          prev.map((d) =>
            d.device_id === payload.device_id
              ? {
                  ...d,
                  last_severity: payload.severity ?? d.last_severity,
                  last_seen: new Date().toISOString(),
                  is_online: true,
                  rssi: payload.rssi ?? d.rssi,
                }
              : d
          )
        );
      })
      .on("broadcast", { event: "event" }, ({ payload }) => {
        if (!payload) return;
        setDevices((prev) =>
          prev.map((d) =>
            d.device_id === payload.device_id
              ? { ...d, last_severity: payload.severity ?? d.last_severity }
              : d
          )
        );
      })
      .on("broadcast", { event: "status" }, ({ payload }) => {
        if (!payload) return;
        setDevices((prev) =>
          prev.map((d) =>
            d.device_id === payload.device_id
              ? { ...d, is_online: payload.is_online ?? d.is_online }
              : d
          )
        );
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  return { devices, loading };
}

export function useTelemetryHistory(deviceId: string | null, hours: number = 24) {
  const [data, setData] = useState<TelemetryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(() => {
    if (!deviceId) return;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    supabase
      .from("telemetry")
      .select("id, device_id, severity, stage, fire_type, fire_label, confidence, action, sensors_active, confirmed, h2_ppm, co_ppm, voc_ppb, vesda_pct, vesda_present, optical_pct, is_smoke, is_smouldering, scatter_delta, ir_blue_ratio, fwd_back_ratio, mq2, temperature, humidity, rssi, recorded_at")
      .eq("device_id", deviceId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })  // newest first…
      .limit(500)
      .then(({ data: rows }) => {
        if (rows) setData(rows.slice().reverse());  // …then flip to chronological for the chart
        setLoading(false);
      });
  }, [deviceId, hours]);

  useEffect(() => {
    if (!deviceId) { setData([]); return; }
    setLoading(true);
    fetchData();
  }, [deviceId, hours, fetchData]);

  useEffect(() => {
    if (!deviceId) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [deviceId, fetchData]);

  useEffect(() => {
    if (!deviceId) return;
    const channel = supabase
      .channel(`telem-history:${deviceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry", filter: `device_id=eq.${deviceId}` },
        (payload) => {
          setData((prev) => {
            const updated = [...prev, payload.new as TelemetryRow];
            return updated.length > 500 ? updated.slice(-500) : updated;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [deviceId]);

  return { data, loading };
}

export function useLatestTelemetry(deviceId: string | null, orgId: string | undefined) {
  const [telemetry, setTelemetry] = useState<TelemetryRow | null>(null);

  const fetchLatest = useCallback(() => {
    if (!deviceId) return;
    supabase
      .from("telemetry")
      .select("*")
      .eq("device_id", deviceId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setTelemetry(data);
      });
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    fetchLatest();
  }, [deviceId, fetchLatest]);

  // Poll every 3 seconds — ensures all fields (including VESDA, VOC) update live
  useEffect(() => {
    if (!deviceId) return;
    const interval = setInterval(fetchLatest, 3000);
    return () => clearInterval(interval);
  }, [deviceId, fetchLatest]);

  return telemetry;
}

// Per-device runtime config (thresholds etc.) — used to colour the gauges.
export function useDeviceConfig(deviceId: string | null) {
  const [config, setConfig] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (!deviceId) { setConfig(null); return; }
    let cancelled = false;
    const load = () =>
      supabase
        .from("device_config")
        .select("config")
        .eq("device_id", deviceId)
        .maybeSingle()
        .then(({ data }) => { if (!cancelled) setConfig(((data?.config as Record<string, any>) || null)); });
    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [deviceId]);

  return config;
}

export function useEvents(orgId: string | undefined, limit: number = 50) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    supabase
      .from("events")
      .select("*")
      .eq("org_id", orgId)
      .order("recorded_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (data) setEvents(data);
        setLoading(false);
      });
  }, [orgId, limit]);

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel("events-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `org_id=eq.${orgId}` },
        (payload) => {
          setEvents((prev) => [payload.new as EventRow, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId, limit]);

  return { events, loading };
}

export function useDeviceCommands() {
  const sendCommand = useCallback(async (deviceId: string, command: string, params: Record<string, any> = {}) => {
    const res = await fetch(`/api/devices/${deviceId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: command, ...params }),
    });
    return res.ok;
  }, []);

  const silence   = (deviceId: string) => sendCommand(deviceId, "silence");
  const test      = (deviceId: string) => sendCommand(deviceId, "test");
  const recalibrate = (deviceId: string) => sendCommand(deviceId, "recalibrate");
  const reboot    = (deviceId: string) => sendCommand(deviceId, "reboot");
  const identify  = (deviceId: string) => sendCommand(deviceId, "identify");

  return { sendCommand, silence, test, recalibrate, reboot, identify };
}

export function useUpdateDevice() {
  return useCallback(async (deviceId: string, fields: Partial<Pick<Device, "name" | "zone">>) => {
    const { error } = await supabase
      .from("devices")
      .update(fields)
      .eq("device_id", deviceId);
    return { error };
  }, []);
}

export function useAcknowledgeEvent() {
  return useCallback(async (eventId: number, userId: string) => {
    const { error } = await supabase
      .from("events")
      .update({
        acknowledged: true,
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", eventId);
    return { error };
  }, []);
}
