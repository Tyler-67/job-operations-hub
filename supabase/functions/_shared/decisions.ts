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
  inspection_pass: {
    action: "inspection_pass",
    trigger: "pass",
    followups: [{ audience: "crew_lead", channel: "sms", template_key: "decision_outcome" }],
  },
  inspection_fail: {
    action: "inspection_fail",
    trigger: "fail",
    followups: [{ audience: "crew_lead", channel: "sms", template_key: "decision_outcome" }],
  },
  finish_walkthrough_yes: {
    action: "finish_walkthrough_yes",
    trigger: "progress_100_owner_yes",
    followups: [{ audience: "crew_lead", channel: "sms", template_key: "decision_outcome" }],
  },
  walkthrough_approve: {
    action: "walkthrough_approve",
    trigger: "walkthrough_approved",
    followups: [{ audience: "office", channel: "sms", template_key: "decision_outcome" }],
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
