/* eslint-disable @typescript-eslint/no-explicit-any */
// The decision spine, extracted from action-decision so BOTH paths run the identical
// effect:
//   - the tokenized tap-link path (owner/crew acting over SMS), and
//   - the authenticated office path (a manager clicking a result button in the app).
// It advances the job's state via the configurable state machine, enqueues the
// decision's follow-on notifications, hands the owner the walkthrough APPROVE/PUNCH-LIST
// links on a genuine walkthrough entry, snapshots the completion report + schedules the
// review tag on a billing entry, and writes the audit row. Takes sb + a resolved decision
// + the loaded job, so it is agnostic to how the caller authorized the decision.

import { applyTransition } from "./state-machine.ts";
import type { DecisionSpec } from "./decisions.ts";
import { enqueueFollowups } from "./decision-followups.ts";
import { enqueueWalkthroughResultAsk } from "./walkthrough.ts";
import { maybeBuildCompletionReport } from "./completion-report.ts";
import { maybeEnqueueReviewRequest } from "./review-request.ts";
import { logEvent } from "./util.ts";
import { triggerDrain } from "./drain.ts";

export interface ApplyDecisionJob {
  id: string;
  location_id: string;
  address: string | null;
  state_set_id: string;
  current_state_id: string | null;
}

export interface ApplyDecisionOptions {
  // Who is acting, for the follow-up recipients' audit + the transition/event rows.
  // The tokenized path passes the tapping contact; the office path passes the signed-in user.
  actorContactId?: string | null;
  actorAppUserId?: string | null;
  // Base URL for link-bearing follow-ups + the walkthrough ask; without it those are skipped.
  appBaseUrl?: string;
  // Per-invocation discriminator for a re-askable decision's follow-up dedupe key, so
  // walkthrough_still_issues/_reschedule enqueue a fresh follow-up each cycle instead of
  // colliding on a static key. The tokenized path passes the consumed (single-use) token id;
  // the office path passes a fresh uuid (there is no token, and the applyTransition from-state
  // guard already blocks a double state-advance).
  cycleKey: string;
  // event_log source: "action" for a tap-link, "app" for the office button.
  source?: string;
  // Inline-form flow (owner tapped the decision in the browser): suppress the owner's form-link
  // SMS and return the minted token as `form` instead, so the tap page shows the fix-details /
  // punch-list form inline. Off for the office button (the owner isn't present → keep the SMS).
  suppressOwnerFormSms?: boolean;
}

export interface ApplyDecisionResult {
  changed: boolean;
  toStateId: string | null;
  reason: string | null;
  enqueued: number;
  walkthroughAsked: boolean;
  completionReportBuilt: boolean;
  reviewRequestQueued: boolean;
  // Set (with suppressOwnerFormSms) when this decision hands the owner an inline form — the
  // minted { action, token } for the fix-details / punch-list form. Null otherwise.
  form: { action: string; token: string } | null;
}

// Applies a resolved decision to an already-loaded job. Identical to the tail of
// action-decision's handler (post token-consume): the only per-caller inputs are the
// actor, the app base URL, the follow-up cycle key, and the audit source.
export async function applyDecision(
  sb: any,
  decision: DecisionSpec,
  job: ApplyDecisionJob,
  opts: ApplyDecisionOptions,
): Promise<ApplyDecisionResult> {
  let changed = false;
  let toStateId: string | null = null;
  let reason: string | null = null;
  if (decision.trigger) {
    const result = await applyTransition(sb, {
      locationId: job.location_id,
      jobId: job.id,
      trigger: decision.trigger,
      actorContactId: opts.actorContactId ?? null,
      actorAppUserId: opts.actorAppUserId ?? null,
      dedupeKey: `decision:${decision.action}:${job.id}`,
    });
    changed = result.changed;
    toStateId = result.toStateId;
    reason = result.reason ?? null;
  }

  // Notify only when the job actually moved (or a no-trigger ack, or an explicit opt-in).
  // A replayed/no-op decision that changed nothing stays silent.
  const shouldEnqueue = changed || !decision.trigger || decision.followupsOnNoChange === true;
  const ownerFormLinks: Array<{ action: string; token: string }> = [];
  const enqueued = shouldEnqueue
    ? await enqueueFollowups(sb, decision, job, {
      appBaseUrl: opts.appBaseUrl,
      cycleKey: opts.cycleKey,
      suppressOwnerFormSms: opts.suppressOwnerFormSms,
      ownerFormLinksOut: ownerFormLinks,
    })
    : 0;
  const form = ownerFormLinks[0] ?? null;

  // On a genuine walkthrough entry, hand the owner APPROVE / PUNCH-LIST / RESCHEDULE links.
  // Gated inside on the new state offering a walkthrough_approved transition. Entering a
  // billing state (walkthrough approved -> complete) snapshots the closed job + schedules
  // the delayed customer review-request tag. All three self-guard + are idempotent.
  let walkthroughAsked = false;
  let completionReportBuilt = false;
  let reviewRequestQueued = false;
  if (changed && toStateId) {
    walkthroughAsked = await enqueueWalkthroughResultAsk(
      sb,
      { id: job.id, location_id: job.location_id, state_set_id: job.state_set_id, current_state_id: toStateId, address: job.address },
      { appBaseUrl: opts.appBaseUrl },
    );
    completionReportBuilt = await maybeBuildCompletionReport(sb, job.id, toStateId);
    reviewRequestQueued = await maybeEnqueueReviewRequest(sb, job.id, toStateId);
  }

  await logEvent({
    source: opts.source ?? "action",
    kind: `decision.${decision.action}`,
    location_id: job.location_id,
    payload: {
      job_id: job.id,
      trigger: decision.trigger,
      changed,
      to_state_id: toStateId,
      enqueued,
      walkthrough_asked: walkthroughAsked,
      completion_report_built: completionReportBuilt,
      review_request_queued: reviewRequestQueued,
      actor_contact_id: opts.actorContactId ?? null,
      actor_app_user_id: opts.actorAppUserId ?? null,
    },
  });

  // A completed decision's follow-ups (outcome SMS, the fail -> fix-details link, the pass ->
  // walkthrough ask) are user-facing and time-sensitive, so flush them now instead of waiting up
  // to ~15 min for the drain cron. Best-effort; the drain cron is still the backstop. Only fired
  // when something was actually queued.
  if (enqueued > 0 || walkthroughAsked) await triggerDrain();

  return { changed, toStateId, reason, enqueued, walkthroughAsked, completionReportBuilt, reviewRequestQueued, form };
}
