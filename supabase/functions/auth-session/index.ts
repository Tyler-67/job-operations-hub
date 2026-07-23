// POST /auth-session
// Body: { access_token }  — a Supabase Auth access token (JWT) obtained by the standalone
// (non-Uptiq) login door after magic-link or password sign-in.
//
// The BRIDGE: we re-verify the token server-side, map its verified email to an app_users
// row, and mint the SAME custom x-app-session the Uptiq iframe door mints (see
// iframe-session/index.ts). Downstream (me, users, every function) is unchanged — both
// doors resolve to one internal session currency and the DB (app_users) identity/role.
import { json, preflight, serviceClient, signSession, verifySession, logEvent } from "../_shared/util.ts";
import { RESERVED_DEMO_EMAIL, resolveAppUser } from "../_shared/app-user.ts";

// Instance actions (generalized 2026-07-23): ANY account may belong to several instances —
// membership = an ACTIVE app_users row with the same primary email in another location, with
// a per-instance id/role/debug grants. dev_super stays app-wide (one home row, every
// instance). Switching RE-MINTS the session for the target instance: dev_super keeps their
// one identity, everyone else becomes their row IN that instance. Gated on FRESH DB state
// (not token claims) so demotions/deactivations take effect immediately.
//   { action: "instances" }                  -> the caller's instances + the current one
//   { action: "switch", location_id: <id> }  -> new session token scoped to that instance
async function handleInstanceAction(req: Request, action: string, body: Record<string, unknown>) {
  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const sb = serviceClient();
  const { data: user } = await sb
    .from("app_users").select("id, email, name, role, active, debug_tools")
    .eq("id", claims.sub as string).maybeSingle();
  if (!user || !user.active) return json({ error: "inactive" }, 403);

  const isSuper = user.role === "dev_super";
  const { data: locations } = await sb
    .from("locations").select("id, company_name").order("created_at");

  // Rows this account can act as, keyed by location. dev_super: the home row everywhere.
  type MemberRow = { id: string; location_id: string; email: string; name: string | null; role: string; debug_tools: string[] };
  let members = new Map<string, MemberRow>();
  if (isSuper) {
    for (const l of locations ?? []) members.set(l.id as string, { ...user, location_id: l.id as string });
  } else {
    const { data: rows } = await sb
      .from("app_users").select("id, location_id, email, name, role, debug_tools")
      .eq("email", user.email).eq("active", true);
    members = new Map((rows ?? []).map((r: MemberRow) => [r.location_id, r]));
  }

  const instances = (locations ?? [])
    .filter((l: { id: string }) => members.has(l.id))
    .map((l: { id: string; company_name: string | null }) => ({
      id: l.id, company_name: l.company_name, current: l.id === (claims.loc as string),
    }));

  if (action === "instances") return json({ instances });

  const targetId = typeof body?.location_id === "string" ? body.location_id.trim() : "";
  const target = (locations ?? []).find((l: { id: string }) => l.id === targetId);
  const identity = target ? members.get(targetId) : undefined;
  if (!target || !identity) return json({ error: "unknown_instance" }, 404);

  const session = await signSession({ sub: identity.id, loc: target.id, email: identity.email, role: identity.role });
  await sb.from("app_users").update({ last_seen_at: new Date().toISOString() }).eq("id", identity.id);
  await logEvent({
    source: "auth", kind: "auth_session_switched", location_id: target.id,
    payload: { email: identity.email, from: claims.loc, to: target.id },
  });

  return json({
    session,
    user: { id: identity.id, email: identity.email, name: identity.name, role: identity.role, debug_tools: identity.debug_tools },
    location: { id: target.id, company_name: target.company_name },
    instances,
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const action = typeof body?.action === "string" ? body.action : "bridge";
  if (action === "instances" || action === "switch") return handleInstanceAction(req, action, body);
  if (action !== "bridge") return json({ error: "unknown_action" }, 400);

  const accessToken = typeof body?.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) return json({ error: "missing_access_token" }, 400);

  const sb = serviceClient();

  // The ONLY trusted email source is the verified token — NEVER the request body.
  // getUser(jwt) validates the signature + expiry against the project's JWT secret and
  // returns the token's user; a forged/expired/cross-project token yields error/no user.
  let verifiedEmail: string | null = null;
  let emailConfirmed = false;
  try {
    const { data, error } = await sb.auth.getUser(accessToken);
    if (error || !data?.user) return json({ error: "invalid_token" }, 401);
    verifiedEmail = typeof data.user.email === "string" ? data.user.email : null;
    emailConfirmed = Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at);
  } catch (_e) {
    // Auth API unreachable — fail closed. Do NOT trust anything from the request.
    return json({ error: "verification_unavailable" }, 503);
  }
  if (!verifiedEmail) return json({ error: "invalid_token" }, 401);
  if (!emailConfirmed) return json({ error: "email_unverified" }, 401);

  // Parity with the iframe door: the reserved demo identity must never authenticate through
  // the standalone bridge either, unless demo sessions are explicitly enabled.
  const demoAllowed = (Deno.env.get("ALLOW_DEMO_SESSION") ?? "").toLowerCase() === "true";
  if (!demoAllowed && verifiedEmail.toLowerCase() === RESERVED_DEMO_EMAIL) {
    return json({ error: "demo_disabled" }, 403);
  }

  let resolved;
  try {
    resolved = await resolveAppUser(sb, verifiedEmail);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "lookup_failed" }, 500);
  }

  // The standalone door NEVER self-provisions (authentication != authorization): a valid
  // Supabase login with no app_users ACL row gets nothing. Provisioning is admin-only
  // via the users function. Revocation stays an in-app control (active=false).
  if (!resolved) return json({ error: "not_provisioned" }, 403);
  if (!resolved.active) return json({ error: "inactive_user" }, 403);

  await sb.from("app_users").update({ last_seen_at: new Date().toISOString() }).eq("id", resolved.id);

  const session = await signSession({
    sub: resolved.id, loc: resolved.location.id, email: resolved.email, role: resolved.role,
  });
  await logEvent({
    source: "auth", kind: "auth_session_issued", location_id: resolved.location.id,
    payload: { email: resolved.email, role: resolved.role, method: "supabase_auth" },
  });

  return json({
    session,
    user: { id: resolved.id, email: resolved.email, name: resolved.name, role: resolved.role, debug_tools: resolved.debug_tools },
    location: { id: resolved.location.id, company_name: resolved.location.company_name },
  });
});
