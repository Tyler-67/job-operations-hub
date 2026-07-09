/* eslint-disable @typescript-eslint/no-explicit-any */
// Self-service password change for the LOGGED-IN user. The x-app-session proves identity
// (claims.sub + claims.email), so any authenticated, active user can change THEIR OWN password
// with no admin role and no email involved. Sets the Supabase Auth password AND the
// admin-viewable app_users.login_password (BETA) so the two stay in sync.
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

// Set the auth.users password (create the row if it doesn't exist yet — e.g. an iframe user
// who never had a standalone password). Throws on failure so we never report success without
// actually changing the credential.
async function setAuthPassword(sb: any, email: string, password: string) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = (data?.users ?? []).find((u: any) => String(u.email ?? "").toLowerCase() === email);
  if (existing) {
    const { error: upErr } = await sb.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (upErr) throw upErr;
  } else {
    const { error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr) throw cErr;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const email = String(claims.email ?? "").toLowerCase();
  const sub = String(claims.sub ?? "");
  const loc = String(claims.loc ?? "");
  if (!email || !sub || !loc) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const password = cleanText(body.password);
  if (!password) return json({ error: "password_required" }, 400);
  if (password.length < 8) return json({ error: "password_too_short" }, 400);

  const sb = serviceClient();
  try {
    const { data: user, error } = await sb
      .from("app_users").select("id, active").eq("id", sub).eq("location_id", loc).maybeSingle();
    if (error) throw error;
    if (!user || !user.active) return json({ error: "inactive" }, 403);

    await setAuthPassword(sb, email, password);
    const { error: updErr } = await sb
      .from("app_users").update({ login_password: password }).eq("id", sub).eq("location_id", loc);
    if (updErr) throw updErr;

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
