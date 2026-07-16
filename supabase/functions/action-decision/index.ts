// POST /action-decision  { token }
// The tap-link decision spine. A single-use token carries an `action` (e.g.
// inspection_pass); consuming it advances the job's state via the configurable
// state machine and enqueues the decision's follow-on notifications. One mechanism
// backs every owner/crew tap decision — PASS/FAIL, finish-work YES, walkthrough
// approve — so each step layers its specifics onto this same flow rather than
// re-implementing consume + transition + notify.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { followupDedupeKey, resolveDecision } from "../_shared/decisions.ts";
import { applyDecision } from "../_shared/apply-decision.ts";

// If this decision hands the OWNER a form link (inspection fix-details / walkthrough punch list),
// pull the single-use token out of the row applyDecision just enqueued so the tap page can render
// that form INLINE — the owner fills it in the same visit instead of hunting for a second SMS. The
// link SMS is still sent (same token) as a fallback if they close the page. Matched by the exact
// dedupe key of this tap's row (followup key + the consumed token id) so it can't grab a stale link.
async function ownerFormLink(
  sb: any,
  decision: ReturnType<typeof resolveDecision>,
  jobId: string,
  cycleKey: string,
): Promise<{ action: string; token: string } | null> {
  const followup = decision?.followups.find((f) => f.link && f.audience === "owner");
  if (!followup?.link) return null;
  const dedupeKey = `${followupDedupeKey(decision!.action, jobId, "owner")}:${cycleKey}`;
  const { data } = await sb
    .from("scheduled_notifications")
    .select("payload")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  const link = (data?.payload as { link?: string } | null)?.link;
  if (!link) return null;
  try {
    const token = new URL(link).searchParams.get("token");
    return token ? { action: followup.link.action, token } : null;
  } catch {
    return null;
  }
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
    .select("id, action, payload, job_id, contact_id")
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

  // Everything past the token consume is the shared decision spine (state advance +
  // follow-ups + walkthrough ask + completion report + review tag + audit). The office
  // "fire a result" button runs the exact same helper via the jobs function. Here the
  // actor is the tapping contact and the follow-up cycle key is the consumed token id.
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim() || undefined;
  const result = await applyDecision(sb, decision, job, {
    actorContactId: tok.contact_id ?? null,
    appBaseUrl,
    cycleKey: tok.id as string,
    source: "action",
  });

  const form = await ownerFormLink(sb, decision, job.id, tok.id as string);

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
    form,
  });
});
