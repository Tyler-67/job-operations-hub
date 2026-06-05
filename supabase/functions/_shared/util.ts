// Shared helpers for all Uptiq edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ALLOWED_FRAME_ANCESTORS =
  Deno.env.get("ALLOWED_FRAME_ANCESTORS") ?? "https://apps.uptiq.net";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-app-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Security-Policy": `frame-ancestors ${ALLOWED_FRAME_ANCESTORS}`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

export function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET");
  const got = req.headers.get("x-cron-secret");
  if (!expected || got !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_SECRET = () =>
  Deno.env.get("APP_SESSION_SECRET") ?? "dev-session-secret-change-me";

export async function signSession(payload: Record<string, unknown>, ttlSec = 1800) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = btoa(JSON.stringify({ ...payload, exp }));
  const sig = await sha256Hex(body + SESSION_SECRET());
  return `${body}.${sig}`;
}

export async function verifySession(token: string | null) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await sha256Hex(body + SESSION_SECRET());
  if (expected !== sig) return null;
  try {
    const decoded = JSON.parse(atob(body));
    if (typeof decoded.exp === "number" && decoded.exp < Date.now() / 1000) return null;
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function logEvent(opts: {
  source: string;
  kind: string;
  dedupe_key?: string;
  payload?: unknown;
  status?: string;
  error?: string;
  location_id?: string;
}) {
  const sb = serviceClient();
  await sb.from("event_log").insert({
    source: opts.source,
    kind: opts.kind,
    dedupe_key: opts.dedupe_key,
    payload: opts.payload ?? {},
    status: opts.status ?? "ok",
    error: opts.error,
    location_id: opts.location_id,
  });
}
