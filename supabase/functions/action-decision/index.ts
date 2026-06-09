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
import { resolveDecision } from "../_shared/decisions.ts";
import { enqueueFollowups } from "../_shared/decision-followups.ts";
import { enqueueWalkthroughResultAsk } from "../_shared/walkthrough.ts";
import { maybeBuildCompletionReport } from "../_shared/completion-report.ts";

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
    .select("id, location_id, address, state_set_id, current_state_id").eq("id", tok.job_id).maybeSingle();
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
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim() || undefined;
  const enqueued = shouldEnqueue ? await enqueueFollowups(sb, decision, job, { appBaseUrl }) : 0;

  // If this decision advanced the job into the final walkthrough state, hand the owner
  // the APPROVE / PUNCH-LIST links. Gated inside on the new state offering a
  // walkthrough_approved transition, so it only fires on a genuine walkthrough entry.
  let walkthroughAsked = false;
  let completionReportBuilt = false;
  if (changed && toStateId) {
    walkthroughAsked = await enqueueWalkthroughResultAsk(
      sb,
      { id: job.id, location_id: job.location_id, state_set_id: job.state_set_id, current_state_id: toStateId, address: job.address },
      { appBaseUrl },
    );
    // Entering a billing state (walkthrough approved → complete) snapshots the closed job.
    completionReportBuilt = await maybeBuildCompletionReport(sb, job.id, toStateId);
  }

  await logEvent({
    source: "action",
    kind: `decision.${tok.action}`,
    location_id: job.location_id,
    payload: { job_id: job.id, trigger: decision.trigger, changed, to_state_id: toStateId, enqueued, walkthrough_asked: walkthroughAsked, completion_report_built: completionReportBuilt },
  });

  return json({ ok: true, action: tok.action, changed, to_state_id: toStateId, reason, enqueued, walkthrough_asked: walkthroughAsked, completion_report_built: completionReportBuilt });
});
