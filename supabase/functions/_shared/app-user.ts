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
  debug_tools: string[];
  location: { id: string; company_name: string | null };
}

// Multi-instance membership (2026-07-23): the SAME primary email may own an app_users row in
// more than one location — that's how a person belongs to several instances (per-location
// UNIQUE allows it; roles can differ per instance). A bare-email login has to land somewhere:
// prefer ACTIVE rows, then the most recently seen (so login lands where the person last
// worked — and the instance switcher keeps last_seen fresh), then the newest row. An
// inactive-only set returns a row anyway so callers' active checks 403 as "inactive"
// rather than misreporting "not provisioned".
export function pickMembershipRow<T extends {
  active?: boolean | null; last_seen_at?: string | null; created_at?: string | null;
}>(rows: T[]): T | null {
  if (!rows.length) return null;
  const activeRank = (r: T) => (r.active ? 1 : 0);
  return [...rows].sort((a, b) =>
    activeRank(b) - activeRank(a) ||
    (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? "") ||
    (b.created_at ?? "").localeCompare(a.created_at ?? "")
  )[0];
}

// Map a known login email -> its app_users row (joined with the location).
//
// Resolution order is PRIMARY-FIRST: app_users.email is authoritative and resolved first,
// so a user's own primary email always maps to their identity and can never be shadowed by
// a secondary alias planted on another account. Only when no primary matches do we consult
// the app_user_emails alias table (global-unique on lower(email)). Pure lookup — does NOT
// enforce `active` or mint anything; callers apply that policy so the two doors can differ.
// Returns null when unknown; throws on a real DB error. An email owning rows in multiple
// instances resolves via pickMembershipRow (see above) — the instance switcher covers the rest.
export async function resolveAppUser(sb: any, rawEmail: unknown): Promise<ResolvedAppUser | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  // Primary email first (authoritative).
  const { data: primaries, error: primErr } = await sb
    .from("app_users").select("id, active, last_seen_at, created_at").eq("email", email);
  if (primErr) throw primErr;
  let appUserId: string | null = primaries?.length
    ? (pickMembershipRow(primaries)! as { id: string }).id
    : null;

  // Otherwise, a secondary login alias.
  if (!appUserId) {
    const { data: alias, error: aliasErr } = await sb
      .from("app_user_emails").select("app_user_id").eq("email", email).maybeSingle();
    if (aliasErr) throw aliasErr;
    appUserId = alias?.app_user_id ?? null;
  }
  if (!appUserId) return null;

  const { data: user, error: userErr } = await sb
    .from("app_users").select("id, location_id, email, name, role, active, debug_tools")
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
    debug_tools: Array.isArray(user.debug_tools) ? user.debug_tools : [],
    location: {
      id: location?.id ?? user.location_id,
      company_name: location?.company_name ?? null,
    },
  };
}
