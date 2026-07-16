// Shared identity resolution for the app's two login doors: the Uptiq iframe
// (iframe-session) and the standalone Supabase-Auth door (auth-session). Both resolve
// an email to the SAME app_users row so they mint identical x-app-session tokens.
//
// No Deno/remote imports here: the Supabase client is injected (typed loosely, like
// users/index.ts), so the pure email logic AND the resolver run under vitest.
/* eslint-disable @typescript-eslint/no-explicit-any */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The reserved demo identity. It must never authenticate through EITHER login door unless
// demo sessions are explicitly enabled (ALLOW_DEMO_SESSION). One definition, used by both
// iframe-session and auth-session so the gate can't drift apart between the doors.
export const RESERVED_DEMO_EMAIL = "dev-admin@uptiq.local";

// Trim + lowercase + validate. Mirrors users/index.ts:cleanEmail so every entry point
// normalizes identically. Returns null for anything that isn't a plausible email.
export function normalizeEmail(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!text.length) return null;
  return EMAIL_RE.test(text) ? text : null;
}

export interface ResolvedAppUser {
  id: string;
  location_id: string;
  // Primary email (app_users.email) — authoritative for display + the session claim,
  // even when the login came in via a secondary alias in app_user_emails.
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  debug_access: boolean;
  location: { id: string; company_name: string | null };
}

// Map a known login email -> its app_users row (joined with the location).
//
// Resolution order is PRIMARY-FIRST: app_users.email is authoritative and resolved first,
// so a user's own primary email always maps to their identity and can never be shadowed by
// a secondary alias planted on another account. Only when no primary matches do we consult
// the app_user_emails alias table (global-unique on lower(email)). Pure lookup — does NOT
// enforce `active` or mint anything; callers apply that policy so the two doors can differ.
// Returns null when unknown; throws on a real DB error, or "ambiguous_account" if the same
// email is the primary of more than one app_users row (per-location UNIQUE allows this).
export async function resolveAppUser(sb: any, rawEmail: unknown): Promise<ResolvedAppUser | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  // Primary email first (authoritative).
  const { data: primaries, error: primErr } = await sb
    .from("app_users").select("id").eq("email", email);
  if (primErr) throw primErr;
  let appUserId: string | null = null;
  if (primaries && primaries.length > 1) throw new Error("ambiguous_account");
  if (primaries && primaries.length === 1) appUserId = primaries[0].id as string;

  // Otherwise, a secondary login alias.
  if (!appUserId) {
    const { data: alias, error: aliasErr } = await sb
      .from("app_user_emails").select("app_user_id").eq("email", email).maybeSingle();
    if (aliasErr) throw aliasErr;
    appUserId = alias?.app_user_id ?? null;
  }
  if (!appUserId) return null;

  const { data: user, error: userErr } = await sb
    .from("app_users").select("id, location_id, email, name, role, active, debug_access")
    .eq("id", appUserId).maybeSingle();
  if (userErr) throw userErr;
  if (!user) return null;

  // Fail closed on a locations DB fault, consistent with the queries above.
  const { data: location, error: locErr } = await sb
    .from("locations").select("id, company_name").eq("id", user.location_id).maybeSingle();
  if (locErr) throw locErr;

  return {
    id: user.id,
    location_id: user.location_id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    active: user.active,
    debug_access: user.debug_access === true,
    location: {
      id: location?.id ?? user.location_id,
      company_name: location?.company_name ?? null,
    },
  };
}
