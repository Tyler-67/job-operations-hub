// POST /action-decision  { token }
// The tap-link decision spine. A single-use token carries an `action` (e.g.
// inspection_pass); consuming it advances the job's state via the configurable
// state machine and enqueues the decision's follow-on notifications. One mechanism
// backs every owner/crew tap decision — PASS/FAIL, finish-work YES, walkthrough
// approve — so each step layers its specifics onto this same flow rather than
// re-implementing consume + transition + notify.
import { json, preflight, serviceClient, logEvent } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { applyTransition } from "../_shared/state-machine.ts";
import { resolveDecision, followupDedupeKey, type DecisionSpec, type FollowupAudience } from "../_shared/decisions.ts";

interface JobRow {
  id: string;
  location_id: string;
  address: string | null;
  current_state_id: string | null;
}

// Resolves an abstract audience to the Uptiq contact id the drain cron will text.
// crew_lead/customer come off the job; owner/office are the text contact ids stored
// directly on company_settings (already Uptiq ids, mirroring scheduled_notifications.recipient).
// deno-lint-ignore no-explicit-any
async function resolveRecipient(sb: any, audience: FollowupAudience, job: JobRow): Promise<string | null> {
  if (audience === "crew_lead") {
    const { data } = await sb.from("job_crew")
      .select("contacts(uptiq_contact_id)").eq("job_id", job.id).eq("is_lead", true).limit(1).maybeSingle();
    return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
  }
  if (audience === "customer") {
    const { data } = await sb.from("job_customers")
      .select("contacts(uptiq_contact_id)").eq("job_id", job.id).eq("is_primary", true).limit(1).maybeSingle();
    return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
  }
  const { data: cs } = await sb.from("company_settings")
    .select("owner_contact_id, office_contact_id").eq("location_id", job.location_id).maybeSingle();
  const id = audience === "owner" ? cs?.owner_contact_id : cs?.office_contact_id;
  return (id ?? "").trim() || null;
}

// deno-lint-ignore no-explicit-any
async function enqueueFollowups(sb: any, decision: DecisionSpec, job: JobRow): Promise<number> {
  let enqueued = 0;
  for (const f of decision.followups) {
    const recipient = await resolveRecipient(sb, f.audience, job);
    if (!recipient) continue; // no contact configured for this audience — skip silently
    const { error } = await sb.from("scheduled_notifications").insert({
      location_id: job.location_id,
      job_id: job.id,
      channel: f.channel,
      recipient,
      template_key: f.template_key,
      payload: { address: job.address ?? null, action: decision.action, audience: f.audience },
      scheduled_for: new Date().toISOString(),
      dedupe_key: followupDedupeKey(decision.action, job.id, f.audience),
    });
    if (error) {
      if (String(error.message ?? error).toLowerCase().includes("duplicate")) continue;
      throw error;
    }
    enqueued++;
  }
  return enqueued;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { token } = await req.json().catch(() => ({}));
  if (!token) return json({ error: "missing_token" }, 400);

  const sb = serviceClient();
  const now = new Date().toISOString();
  const hash = await hashActionToken(token, resolveActionSecret());

  // Atomically consume: flip used_at only while still unused + unexpired. A replayed
  // tap matches nothing here and 410s, so the transition below can't double-fire.
  const { data: tok, error: cErr } = await sb.from("action_tokens")
    .update({ used_at: now })
    .eq("token_hash", hash)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("action, payload, job_id, contact_id")
    .maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!tok) return json({ error: "invalid_or_expired" }, 410);

  const decision = resolveDecision(tok.action);
  if (!decision) return json({ error: "unknown_decision", action: tok.action }, 422);
  if (!tok.job_id) return json({ error: "token_missing_job" }, 422);

  const { data: job, error: jErr } = await sb.from("jobs")
    .select("id, location_id, address, current_state_id").eq("id", tok.job_id).maybeSingle();
  if (jErr) return json({ error: jErr.message }, 500);
  if (!job) return json({ error: "job_not_found" }, 404);

  let changed = false;
  let toStateId: string | null = null;
  let reason: string | null = null;
  if (decision.trigger) {
    const result = await applyTransition(sb, {
      locationId: job.location_id,
      jobId: job.id,
      trigger: decision.trigger,
      actorContactId: tok.contact_id ?? null,
      dedupeKey: `decision:${tok.action}:${job.id}`,
    });
    changed = result.changed;
    toStateId = result.toStateId;
    reason = result.reason ?? null;
  }

  // Notify only when the job actually moved (or a no-trigger ack, or an explicit
  // opt-in). A replayed tap that changed nothing stays silent.
  const shouldEnqueue = changed || !decision.trigger || decision.followupsOnNoChange === true;
  const enqueued = shouldEnqueue ? await enqueueFollowups(sb, decision, job) : 0;

  await logEvent({
    source: "action",
    kind: `decision.${tok.action}`,
    location_id: job.location_id,
    payload: { job_id: job.id, trigger: decision.trigger, changed, to_state_id: toStateId, enqueued },
  });

  return json({ ok: true, action: tok.action, changed, to_state_id: toStateId, reason, enqueued });
});
