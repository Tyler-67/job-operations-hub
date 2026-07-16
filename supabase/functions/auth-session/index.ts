// POST /auth-session
// Body: { access_token }  — a Supabase Auth access token (JWT) obtained by the standalone
// (non-Uptiq) login door after magic-link or password sign-in.
//
// The BRIDGE: we re-verify the token server-side, map its verified email to an app_users
// row, and mint the SAME custom x-app-session the Uptiq iframe door mints (see
// iframe-session/index.ts). Downstream (me, users, every function) is unchanged — both
// doors resolve to one internal session currency and the DB (app_users) identity/role.
import { json, preflight, serviceClient, signSession, logEvent } from "../_shared/util.ts";
import { RESERVED_DEMO_EMAIL, resolveAppUser } from "../_shared/app-user.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
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
    if (e instanceof Error && e.message === "ambiguous_account") return json({ error: "ambiguous_account" }, 409);
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
    user: { id: resolved.id, email: resolved.email, name: resolved.name, role: resolved.role, debug_access: resolved.debug_access },
    location: { id: resolved.location.id, company_name: resolved.location.company_name },
  });
});
