import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const token = req.headers.get("x-app-session");
  const claims = await verifySession(token);
  if (!claims) return json({ error: "unauthorized" }, 401);

  const sb = serviceClient();
  const { data: user } = await sb.from("app_users").select("id, email, name, role, location_id, active, debug_tools")
    .eq("id", claims.sub as string).maybeSingle();
  if (!user || !user.active) return json({ error: "inactive" }, 403);

  // The ACTIVE instance is the session's `loc` claim, not the user's home row — a dev_super
  // may have switched instances (auth-session action:"switch"). Identical for normal
  // sessions, where loc always equals the home location_id.
  const { data: location } = await sb.from("locations").select("id, company_name, timezone")
    .eq("id", (claims.loc as string) ?? user.location_id).maybeSingle();

  return json({ user, location });
});
