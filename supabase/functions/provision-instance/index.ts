// POST /provision-instance?secret=<SECRET>   (or header x-provision-secret / x-cron-secret)
//
// Machine-callable tenant provisioning — creates a new instance (locations row + company_settings +
// a state machine cloned from a template instance) from a secret-authenticated call, WITHOUT a
// dev_super session. For scripts / external onboarding (e.g. an Uptiq webhook when a customer signs
// up). The interactive equivalent is dev-console { action: "create_instance" }; both reuse the same
// createInstance recipe, so a provisioned tenant matches the /dev UI exactly.
//
// verify_jwt = false (see config.toml) — no Supabase/app JWT; the SECRET is the only auth. It checks
// PROVISION_SECRET, falling back to CRON_SECRET so this works today; set a dedicated PROVISION_SECRET
// to isolate provisioning power from the cron secret.
//
// body: {
//   company_name,               // required, <= 80
//   uptiq_location_id,          // required, unique binding, [A-Za-z0-9_-]{3,64} (real GHL id or a slug)
//   timezone?,                  // default America/Chicago
//   app_base_url?,              // https URL; per-tenant SMS/form link origin
//   uptiq_sync_location_id?,    // sync bridge to a real GHL location
//   clone_states_from?          // location_id to clone the state machine from;
//                               // default = the oldest instance with a default state set
// }
// -> 201 { ok, location_id, company_name, cloned_states_from }
//    409 binding_in_use · 400 <validation error> · 401 unauthorized
import { json, preflight, serviceClient, logEvent } from "../_shared/util.ts";
import { validateInstanceInput, createInstance } from "../_shared/instance-admin.ts";

// Secret gate: ?secret=, x-provision-secret, or x-cron-secret — matched against PROVISION_SECRET
// (preferred) or CRON_SECRET (fallback). Missing/mismatched secret => 401.
function guard(req: Request): Response | null {
  const expected = Deno.env.get("PROVISION_SECRET") ?? Deno.env.get("CRON_SECRET");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const got = req.headers.get("x-provision-secret") ?? req.headers.get("x-cron-secret") ?? urlSecret;
  if (!expected || !got || got !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const denied = guard(req);
  if (denied) return denied;

  const sb = serviceClient();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const input = validateInstanceInput(body);
    if (!input.ok) return json({ error: input.error }, 400);

    // Which instance's default state set to clone. Explicit clone_states_from wins; otherwise the
    // oldest instance that has a default set (the canonical/original tenant), so a fresh instance
    // always comes up with a working lifecycle.
    let cloneFrom = typeof body.clone_states_from === "string" && body.clone_states_from.trim()
      ? body.clone_states_from.trim()
      : null;
    if (!cloneFrom) {
      const { data: template } = await sb
        .from("job_state_sets")
        .select("location_id, created_at")
        .eq("is_default", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      cloneFrom = (template?.location_id as string | undefined) ?? null;
    }

    const newId = await createInstance(sb, input.value, cloneFrom);
    await logEvent({
      source: "admin",
      kind: "instance.provisioned",
      location_id: newId,
      payload: {
        via: "provision-instance",
        company_name: input.value.company_name,
        binding: input.value.uptiq_location_id,
        cloned_states_from: cloneFrom,
      },
    });
    return json({ ok: true, location_id: newId, company_name: input.value.company_name, cloned_states_from: cloneFrom }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "binding_in_use" ? 409 : 500;
    return json({ error: message }, status);
  }
});
