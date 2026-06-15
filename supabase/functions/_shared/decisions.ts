// Pure, I/O-free registry that maps a tap-link's action to its effect: which
// state-machine trigger it fires and which follow-on notifications it enqueues.
// This is the data behind the owner/crew decision spine (action-decision). No Deno
// or remote imports so the registry and its lookup are unit-testable under vitest.

import type { TransitionTrigger } from "./state-machine.ts";

// Who a follow-on notification goes to. Resolved to a concrete Uptiq recipient at
// send time by action-decision — kept abstract here so the registry stays pure.
export type FollowupAudience = "owner" | "office" | "crew_lead" | "customer";

export interface FollowupSpec {
  audience: FollowupAudience;
  channel: "sms" | "email";
  template_key: string;
  // When set, the follow-up carries a single-use action link: enqueueFollowups mints a
  // job-bound token for `action` and embeds the URL (APP_BASE_URL + path) in the payload,
  // so a decision can hand its recipient the next branded form without a separate cron.
  link?: { action: string; path: string };
}

export interface DecisionSpec {
  action: string;
  // The state-machine trigger this decision fires; null means acknowledge only
  // (no state change — e.g. an owner deferring a decision).
  trigger: TransitionTrigger | null;
  // Enqueued after the transition actually advances the job. A replayed tap that
  // changes nothing stays silent unless followupsOnNoChange is set.
  followups: FollowupSpec[];
  followupsOnNoChange?: boolean;
}

// Every tap-link decision the system understands. Adding a decision here is what
// lets a new owner/crew link flow through the spine without touching the handler.
const REGISTRY: Record<string, DecisionSpec> = {
  // Inspection outcomes notify the owner (it happened) and the crew lead (advance
  // to the next phase on pass, redo the work on fail). On fail the job reverts to
  // its work state, reopening the fix-details path the owner fills in separately.
  inspection_pass: {
    action: "inspection_pass",
    trigger: "pass",
    followups: [
      { audience: "owner", channel: "sms", template_key: "decision_outcome" },
      { audience: "crew_lead", channel: "sms", template_key: "decision_outcome" },
    ],
  },
  inspection_fail: {
    action: "inspection_fail",
    trigger: "fail",
    followups: [
      // The owner gets a link to record what the inspector flagged; the crew lead is told
      // it failed now and receives the actual fix list once the owner submits the form.
      {
        audience: "owner", channel: "sms", template_key: "inspection_fix_details_link",
        link: { action: "inspection_fix_details", path: "/forms/inspection-fix-details" },
      },
      { audience: "crew_lead", channel: "sms", template_key: "decision_outcome" },
    ],
  },
  finish_walkthrough_yes: {
    action: "finish_walkthrough_yes",
    trigger: "progress_100_owner_yes",
    followups: [{ audience: "crew_lead", channel: "sms", template_key: "decision_outcome" }],
  },
  // The owner says the job isn't ready yet: acknowledge only, no state change. The crew
  // keeps working and the ask re-fires on the next 100% check-in (a new day's dedupe key).
  finish_walkthrough_no: {
    action: "finish_walkthrough_no",
    trigger: null,
    followups: [],
  },
  walkthrough_approve: {
    action: "walkthrough_approve",
    trigger: "walkthrough_approved",
    followups: [{ audience: "office", channel: "sms", template_key: "decision_outcome" }],
  },
  // The owner tapped RESCHEDULE during the final walkthrough (or the post-punch-list
  // re-ask): acknowledge only, NO state change (the job stays in walkthrough). Both the
  // owner and office are told a reschedule was requested so the office can rebook; the
  // owner keeps the live APPROVE/STILL-ISSUES tokens to act on later.
  walkthrough_reschedule: {
    action: "walkthrough_reschedule",
    trigger: null,
    followups: [
      { audience: "owner", channel: "sms", template_key: "decision_outcome" },
      { audience: "office", channel: "sms", template_key: "decision_outcome" },
    ],
  },
  // The owner tapped PUNCH LIST during the final walkthrough: acknowledge only (the job
  // stays in walkthrough, not yet approved) and hand the owner a link to the form where
  // they record the items still to fix. Mirrors inspection_fail → fix-details. The crew
  // lead is notified with the actual list once the owner submits that form.
  walkthrough_punch_list: {
    action: "walkthrough_punch_list",
    trigger: null,
    followups: [
      {
        audience: "owner", channel: "sms", template_key: "walkthrough_punch_list_link",
        link: { action: "walkthrough_punch_details", path: "/forms/walkthrough-punch-list" },
      },
    ],
  },
  // STILL ISSUES on the post-punch-list re-ask: same effect as walkthrough_punch_list
  // (acknowledge only, hand the owner the punch-list form again) but a distinct action so
  // the re-ask's link is its own single-use token and the audit/event copy stays distinct.
  walkthrough_still_issues: {
    action: "walkthrough_still_issues",
    trigger: null,
    followups: [
      {
        audience: "owner", channel: "sms", template_key: "walkthrough_punch_list_link",
        link: { action: "walkthrough_punch_details", path: "/forms/walkthrough-punch-list" },
      },
    ],
  },
};

export function resolveDecision(action: string): DecisionSpec | null {
  return REGISTRY[action] ?? null;
}

// Stable dedupe key for a decision's effect on a job, so a double-tapped link can
// never enqueue the same follow-up twice (paired with the unique constraint).
export function followupDedupeKey(action: string, jobId: string, audience: FollowupAudience): string {
  return `decision_followup:${action}:${jobId}:${audience}`;
}
