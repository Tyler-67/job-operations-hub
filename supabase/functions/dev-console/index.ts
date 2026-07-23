// POST/GET /dev-console — the Developer dashboard's backend. dev_super ONLY, gated on the
// FRESH role from the DB (never the token claim alone) so a demotion locks the console
// immediately. Everything here is an "overhead" operation that previously required direct
// SQL: instance lifecycle + the ops overview.
//   GET                                   -> { instances: [...+metrics], crons: {last ticks} }
//   POST { action: "create_instance", company_name, timezone?, uptiq_location_id,
//          app_base_url?, uptiq_sync_location_id?, clone_states_from? }   -> overview (201)
//   POST { action: "update_instance", location_id, ...patchable fields }  -> overview
//   POST { action: "delete_instance", location_id }  (empty instances only) -> overview
import { json, preflight, serviceClient, verifySession, logEvent } from "../_shared/util.ts";
import {
  createInstance, deleteInstance, instanceOverview, updateInstance, validateInstanceInput,
} from "../_shared/instance-admin.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const sb = serviceClient();
  const { data: actor } = await sb
    .from("app_users").select("id, email, role, active").eq("id", claims.sub as string).maybeSingle();
  if (!actor || !actor.active) return json({ error: "inactive" }, 403);
  if (actor.role !== "dev_super") return json({ error: "forbidden" }, 403);

  try {
    if (req.method === "GET") return json(await instanceOverview(sb));
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "create_instance") {
      const input = validateInstanceInput(body);
      if (!input.ok) return json({ error: input.error }, 400);
      const cloneFrom = typeof body.clone_states_from === "string" && body.clone_states_from.trim()
        ? body.clone_states_from.trim()
        : (claims.loc as string); // default: clone the caller's current instance's state set
      const newId = await createInstance(sb, input.value, cloneFrom);
      await logEvent({
        source: "dev", kind: "instance.created", location_id: newId,
        payload: { by: actor.email, company_name: input.value.company_name, binding: input.value.uptiq_location_id, cloned_from: cloneFrom },
      });
      return json(await instanceOverview(sb), 201);
    }

    if (action === "update_instance") {
      const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
      if (!locationId) return json({ error: "location_id_required" }, 400);
      await updateInstance(sb, locationId, body);
      await logEvent({
        source: "dev", kind: "instance.updated", location_id: locationId,
        payload: { by: actor.email, fields: Object.keys(body).filter((k) => k !== "action" && k !== "location_id") },
      });
      return json(await instanceOverview(sb));
    }

    if (action === "delete_instance") {
      const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
      if (!locationId) return json({ error: "location_id_required" }, 400);
      await deleteInstance(sb, locationId, claims.loc as string);
      // No location_id on purpose: the row it referenced no longer exists.
      await logEvent({
        source: "dev", kind: "instance.deleted",
        payload: { by: actor.email, deleted_location_id: locationId },
      });
      return json(await instanceOverview(sb));
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      ["company_name_required", "company_name_too_long", "uptiq_location_id_required",
        "uptiq_location_id_invalid", "timezone_invalid", "app_base_url_invalid",
        "location_id_required"].includes(message) ? 400
        : ["binding_in_use", "instance_not_empty", "cannot_delete_current"].includes(message) ? 409
          : 500;
    return json({ error: message }, status);
  }
});
