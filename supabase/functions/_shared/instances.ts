// Per-instance (tenant) plumbing for the two-app / shared-backend topology.
//
// A `locations` row may carry its own frontend origin (app_base_url) and its own Uptiq
// sync target (uptiq_sync_location_id) — see migration 20260722190000. Null columns fall
// back to the single-tenant globals, so the production tenant behaves exactly as it did
// before these columns existed.
//
// No Deno-only globals at module scope (guarded access below), and the injected client is
// typed loosely (like app-user.ts) so the pure helpers run under vitest.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type InstanceLocation = {
  id?: string;
  app_base_url?: string | null;
  uptiq_location_id?: string | null;
  uptiq_sync_location_id?: string | null;
} | null | undefined;

// Guarded env read: Deno.env in the edge runtime, "" under vitest/Node.
function envGet(name: string): string {
  const d = (globalThis as any).Deno;
  return d?.env?.get?.(name) ?? "";
}

// Frontend origin for links minted for this tenant. Null/blank column -> the APP_BASE_URL
// secret (the production app). Trailing slashes trimmed so callers can always do
// `${base}/forms/...`.
export function appBaseUrlFor(location: InstanceLocation, envBase?: string | null): string {
  const own = (location?.app_base_url ?? "").trim();
  const fallback = (envBase ?? envGet("APP_BASE_URL")).trim();
  return (own || fallback).replace(/\/+$/, "");
}

// GHL location id for contact pulls + calendar sync. The Development instance keeps a
// synthetic iframe binding (uptiq_location_id, UNIQUE) but syncs against the real staging
// location via the bridge column. Conversation debug tools deliberately do NOT use this —
// they stay on the raw binding so a dev-instance operator can't touch real threads.
export function uptiqApiLocationId(location: InstanceLocation): string | null {
  const bridge = (location?.uptiq_sync_location_id ?? "").trim();
  const own = (location?.uptiq_location_id ?? "").trim();
  return bridge || own || null;
}

// One-select convenience for handlers that only hold a location id.
export async function resolveAppBaseUrl(sb: any, locationId: string | null | undefined): Promise<string> {
  if (!locationId) return appBaseUrlFor(null);
  const { data } = await sb
    .from("locations").select("id, app_base_url").eq("id", locationId).maybeSingle();
  return appBaseUrlFor(data as InstanceLocation);
}
