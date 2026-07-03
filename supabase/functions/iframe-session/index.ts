// POST /iframe-session
// Body: { location_id, user_email, user_name?, phone? }
// Verifies location and Uptiq user membership before issuing an app session.
import { corsHeaders, json, preflight, serviceClient, signSession, logEvent } from "../_shared/util.ts";
import { uptiq } from "../_shared/uptiq.ts";

type VerifiedUptiqUser = {
  id: string | null;
  email: string;
  name: string | null;
  phone: string | null;
};

function stringOrNull(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function usersFromResponse(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (typeof data !== "object" || data === null) return [];
  const users = (data as { users?: unknown }).users;
  return Array.isArray(users) ? users.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

function verifiedUserFromResponse(data: unknown, email: string): VerifiedUptiqUser | null {
  const lowerEmail = email.toLowerCase();
  const user = usersFromResponse(data).find((candidate) => {
    const candidateEmail = stringOrNull(candidate.email)?.toLowerCase();
    return candidateEmail === lowerEmail && candidate.deleted !== true;
  });
  if (!user) return null;

  const fallbackName = [stringOrNull(user.firstName), stringOrNull(user.lastName)].filter(Boolean).join(" ");
  return {
    id: stringOrNull(user.id),
    email: lowerEmail,
    name: stringOrNull(user.name) ?? (fallbackName || null),
    phone: stringOrNull(user.phone),
  };
}

async function verifyUptiqUser(locationId: string, email: string, companyId?: string | null): Promise<VerifiedUptiqUser | null> {
  const locationResult = await uptiq.getUsersByLocation({ locationId });
  if (locationResult.ok) {
    const user = verifiedUserFromResponse(locationResult.data, email);
    if (user || !companyId) return user;
  } else if (!companyId) {
    throw new Error(locationResult.error || `uptiq_user_lookup_${locationResult.status}`);
  }

  const companyResult = await uptiq.searchUsers({ companyId: companyId!, locationId, query: email, limit: 10 });
  if (!companyResult.ok) throw new Error(companyResult.error || `uptiq_user_lookup_${companyResult.status}`);
  return verifiedUserFromResponse(companyResult.data, email);
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { location_id, user_email, user_name, phone } = body ?? {};
  const rawEmail = stringOrNull(user_email);
  if (!location_id || !rawEmail) return json({ error: "missing_params" }, 400);
  const lowerEmail = rawEmail.toLowerCase();

  const sb = serviceClient();
  const { data: loc, error: locErr } = await sb
    .from("locations").select("id, uptiq_location_id, uptiq_company_id, company_name")
    .eq("uptiq_location_id", location_id).maybeSingle();
  if (locErr) return json({ error: locErr.message }, 500);
  if (!loc) return json({ error: "unknown_location" }, 403);

  const bootstrap = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ?? "").toLowerCase();
  const isDemoBootstrap = location_id === "DEMO_LOCATION" && lowerEmail === "dev-admin@uptiq.local";
  const desiredRole = (bootstrap && bootstrap === lowerEmail) || isDemoBootstrap ? "owner_admin" : null;

  // app_users is the source of truth for who has access — look it up first.
  const { data: existing } = await sb.from("app_users")
    .select("id, role, active, uptiq_user_id, last_verified_at")
    .eq("location_id", loc.id).eq("email", lowerEmail).maybeSingle();

  // Verify against Uptiq as IDENTITY PROVISIONING + a best-effort refresh — NOT a hard per-login gate.
  // A Uptiq outage, or a user removed/renamed in Uptiq, must not lock out an already-provisioned app user.
  let verifiedUser: VerifiedUptiqUser | null = null;
  let verifyErrored = false;
  if (!isDemoBootstrap) {
    try {
      verifiedUser = await verifyUptiqUser(String(location_id), lowerEmail, loc.uptiq_company_id);
    } catch (_error) {
      verifyErrored = true; // Uptiq unreachable — fall back to the app_users record below.
    }
  }

  // First-time provisioning still requires a live Uptiq verification, so not just anyone with the iframe
  // URL (+ the public anon key) can self-provision. Already-provisioned users are governed by app_users.
  if (!existing && !isDemoBootstrap) {
    if (verifyErrored) return json({ error: "verification_unavailable" }, 503);
    if (!verifiedUser) return json({ error: "user_not_in_uptiq_location" }, 403);
  }
  // Revocation is an in-app control: deactivate the user on the Users page. Uptiq removal alone won't do it.
  if (existing && !existing.active && !desiredRole) return json({ error: "inactive_user" }, 403);

  const effectiveName = stringOrNull(user_name) ?? verifiedUser?.name ?? null;
  const effectivePhone = stringOrNull(phone) ?? verifiedUser?.phone ?? null;
  const verifiedNow = verifiedUser ? new Date().toISOString() : null;

  let appUserId: string; let role: string;
  if (existing) {
    appUserId = existing.id; role = desiredRole ?? existing.role;
    await sb.from("app_users").update({
      // Only refresh Uptiq-sourced fields when we actually verified this login; else keep prior values.
      name: effectiveName ?? undefined, phone: effectivePhone ?? undefined,
      uptiq_user_id: verifiedUser?.id ?? existing.uptiq_user_id ?? null,
      last_verified_at: verifiedNow ?? existing.last_verified_at ?? null,
      role, last_seen_at: new Date().toISOString(), active: existing.active || Boolean(desiredRole),
    }).eq("id", appUserId);
  } else {
    const { data: created, error: cErr } = await sb.from("app_users").insert({
      location_id: loc.id, email: lowerEmail, name: effectiveName, phone: effectivePhone,
      uptiq_user_id: verifiedUser?.id ?? null, last_verified_at: verifiedNow,
      role: desiredRole ?? "viewer", last_seen_at: new Date().toISOString(),
    }).select("id, role").single();
    if (cErr) return json({ error: cErr.message }, 500);
    appUserId = created.id; role = created.role;
  }

  const session = await signSession({ sub: appUserId, loc: loc.id, email: lowerEmail, role });
  await logEvent({ source: "form", kind: "iframe_session_issued", location_id: loc.id,
    payload: { email: lowerEmail, role, verified: Boolean(verifiedUser) || isDemoBootstrap } });

  return json({
    session,
    user: { id: appUserId, email: lowerEmail, name: effectiveName, role },
    location: { id: loc.id, company_name: loc.company_name },
  });
});
