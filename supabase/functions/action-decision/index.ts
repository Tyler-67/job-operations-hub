// POST /action-decision  { token }
// The tap-link decision spine. A single-use token carries an `action` (e.g.
// inspection_pass); consuming it advances the job's state via the configurable
// state machine and enqueues the decision's follow-on notifications. One mechanism
// backs every owner/crew tap decision — PASS/FAIL, finish-work YES, walkthrough
// approve — so each step layers its specifics onto this same flow rather than
// re-implementing consume + transition + notify.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { resolveAppBaseUrl } from "../_shared/instances.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { decisionAllowedForState, resolveDecision } from "../_shared/decisions.ts";
import { applyDecision } from "../_shared/apply-decision.ts";

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
    .select("id, action, payload, job_id, contact_id, batch_id")
    .maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!tok) return json({ error: "invalid_or_expired" }, 410);

  // BURN THE SIBLINGS: the options of one multi-link text share a batch_id, and answering
  // any of them retires the whole text — the unused partner links flip to used so a later
  // tap 410s ("already used") instead of soft-acting. This closes the real cross-fire
  // hazard (inspection PASS advanced the job to walkthrough; the leftover FAIL from the
  // same text also carries the `fail` trigger and would have matched walkthrough's
  // punch-revert edge). Best-effort: a burn failure never blocks the tapped decision.
  if (tok.batch_id) {
    const { error: burnErr } = await sb.from("action_tokens")
      .update({ used_at: now })
      .eq("batch_id", tok.batch_id)
      .is("used_at", null);
    if (burnErr) console.error("sibling burn failed", burnErr.message ?? burnErr);
  }

  const decision = resolveDecision(tok.action);
  if (!decision) return json({ error: "unknown_decision", action: tok.action }, 422);
  if (!tok.job_id) return json({ error: "token_missing_job" }, 422);

  const { data: job, error: jErr } = await sb.from("jobs")
    .select("id, location_id, address, state_set_id, current_state_id").eq("id", tok.job_id).maybeSingle();
  if (jErr) return json({ error: jErr.message }, 500);
  if (!job) return json({ error: "job_not_found" }, 404);

  // STALE-LINK GATE (mirrors the office fire_decision path): the decision must fit the job's
  // CURRENT state kind. Sibling burning retires an answered text, but a text can also go
  // stale without ever being answered — e.g. the office clicks "Mark passed" and the job
  // moves on while the owner's PASS/FAIL links are still outstanding. Without this check a
  // leftover FAIL could match the walkthrough punch-revert edge (both ride the `fail`
  // trigger). The token is already consumed above — spending a dead link is correct — and
  // the owner just sees the "no longer valid" page.
  const { data: curState } = await sb.from("job_states")
    .select("is_inspection, is_walkthrough, slug").eq("id", job.current_state_id).maybeSingle();
  if (!decisionAllowedForState(tok.action, curState)) {
    return json({ error: "stale_decision", action: tok.action }, 410);
  }

  // Everything past the token consume is the shared decision spine (state advance +
  // follow-ups + walkthrough ask + completion report + review tag + audit). The office
  // "fire a result" button runs the exact same helper via the jobs function. Here the
  // actor is the tapping contact and the follow-up cycle key is the consumed token id.
  // suppressOwnerFormSms: the owner is in the browser, so hand the fix-details / punch-list
  // form token back for the tap page to render INLINE instead of texting a redundant link.
  const appBaseUrl = (await resolveAppBaseUrl(sb, job.location_id)) || undefined;
  const result = await applyDecision(sb, decision, job, {
    actorContactId: tok.contact_id ?? null,
    appBaseUrl,
    cycleKey: tok.id as string,
    source: "action",
    suppressOwnerFormSms: true,
  });

  return json({
    ok: true,
    action: tok.action,
    changed: result.changed,
    to_state_id: result.toStateId,
    reason: result.reason,
    enqueued: result.enqueued,
    walkthrough_asked: result.walkthroughAsked,
    completion_report_built: result.completionReportBuilt,
    review_request_queued: result.reviewRequestQueued,
    // Present only when the owner should now fill a form (fix details / punch list) — the tap
    // page renders it inline. { action, token } → POST to the matching forms-* endpoint.
    form: result.form,
  });
});
