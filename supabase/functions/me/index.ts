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

  const { data: location } = await sb.from("locations").select("id, company_name, timezone")
    .eq("id", user.location_id).maybeSingle();

  return json({ user, location });
});
