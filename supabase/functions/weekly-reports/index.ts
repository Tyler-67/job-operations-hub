/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /weekly-reports  -> the most recent stored weekly_reports snapshots for the caller's
// location. Read-only, app-facing: gated by the signed app session (verify_jwt + verifySession),
// scoped to claims.loc, served via the service client. The weekly preview page renders these.
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const DEFAULT_LIMIT = 12;

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  const locationId = claims.loc as string;

  const sb = serviceClient();
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 52 ? limitParam : DEFAULT_LIMIT;

  const { data, error } = await sb
    .from("weekly_reports")
    .select("id, period_start, period_end, snapshot, created_at")
    .eq("location_id", locationId)
    .order("period_start", { ascending: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);

  return json({ reports: data ?? [] });
});
