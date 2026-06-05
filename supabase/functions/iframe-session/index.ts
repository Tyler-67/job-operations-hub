// POST /iframe-session
// Body: { location_id, user_email, user_name?, phone? }
// Phase 1: trust params + verify location matches the deployed tenant.
// Phase 2: also verify user_email is an active Uptiq user via users-by-location.
import { corsHeaders, json, preflight, serviceClient, signSession, logEvent } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { location_id, user_email, user_name, phone } = body ?? {};
  if (!location_id || !user_email) return json({ error: "missing_params" }, 400);

  const sb = serviceClient();
  const { data: loc, error: locErr } = await sb
    .from("locations").select("id, uptiq_location_id, company_name")
    .eq("uptiq_location_id", location_id).maybeSingle();
  if (locErr) return json({ error: locErr.message }, 500);
  if (!loc) return json({ error: "unknown_location" }, 403);

  // Determine role: bootstrap admin if matches env, else upsert as viewer.
  const bootstrap = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ?? "").toLowerCase();
  const desiredRole = bootstrap && bootstrap === String(user_email).toLowerCase() ? "owner_admin" : null;

  const { data: existing } = await sb.from("app_users")
    .select("id, role").eq("location_id", loc.id).eq("email", user_email).maybeSingle();

  let appUserId: string; let role: string;
  if (existing) {
    appUserId = existing.id; role = desiredRole ?? existing.role;
    await sb.from("app_users").update({
      name: user_name ?? null, phone: phone ?? null,
      role, last_seen_at: new Date().toISOString(), active: true,
    }).eq("id", appUserId);
  } else {
    const { data: created, error: cErr } = await sb.from("app_users").insert({
      location_id: loc.id, email: user_email, name: user_name, phone,
      role: desiredRole ?? "viewer", last_seen_at: new Date().toISOString(),
    }).select("id, role").single();
    if (cErr) return json({ error: cErr.message }, 500);
    appUserId = created.id; role = created.role;
  }

  const session = await signSession({ sub: appUserId, loc: loc.id, email: user_email, role });
  await logEvent({ source: "form", kind: "iframe_session_issued", location_id: loc.id,
    payload: { email: user_email, role } });

  return json({
    session,
    user: { id: appUserId, email: user_email, name: user_name, role },
    location: { id: loc.id, company_name: loc.company_name },
  });
});
