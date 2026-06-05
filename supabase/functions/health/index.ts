import { json, preflight, serviceClient } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const sb = serviceClient();
  const { count, error } = await sb.from("locations")
    .select("*", { count: "exact", head: true });
  return json({
    ok: !error,
    db: error ? "error" : "ok",
    locations: count ?? 0,
    time: new Date().toISOString(),
    version: "v2",
  }, error ? 500 : 200);
});
