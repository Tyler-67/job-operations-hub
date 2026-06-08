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
  let verifiedUser: VerifiedUptiqUser | null = null;

  if (!isDemoBootstrap) {
    try {
      verifiedUser = await verifyUptiqUser(String(location_id), lowerEmail, loc.uptiq_company_id);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "uptiq_user_verification_failed" }, 502);
    }
    if (!verifiedUser) return json({ error: "user_not_in_uptiq_location" }, 403);
  }

  // Determine role: bootstrap admin if verified and matches env, else upsert as viewer.
  const desiredRole = (bootstrap && bootstrap === lowerEmail) || isDemoBootstrap ? "owner_admin" : null;
  const effectiveName = stringOrNull(user_name) ?? verifiedUser?.name ?? null;
  const effectivePhone = stringOrNull(phone) ?? verifiedUser?.phone ?? null;
  const verifiedAt = verifiedUser ? new Date().toISOString() : null;

  const { data: existing } = await sb.from("app_users")
    .select("id, role, active").eq("location_id", loc.id).eq("email", lowerEmail).maybeSingle();

  let appUserId: string; let role: string;
  if (existing) {
    if (!existing.active && !desiredRole) return json({ error: "inactive_user" }, 403);
    appUserId = existing.id; role = desiredRole ?? existing.role;
    await sb.from("app_users").update({
      name: effectiveName, phone: effectivePhone,
      uptiq_user_id: verifiedUser?.id ?? null, last_verified_at: verifiedAt,
      role, last_seen_at: new Date().toISOString(), active: existing.active || Boolean(desiredRole),
    }).eq("id", appUserId);
  } else {
    const { data: created, error: cErr } = await sb.from("app_users").insert({
      location_id: loc.id, email: lowerEmail, name: effectiveName, phone: effectivePhone,
      uptiq_user_id: verifiedUser?.id ?? null, last_verified_at: verifiedAt,
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
