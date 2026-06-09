/* eslint-disable @typescript-eslint/no-explicit-any */
// When a crew check-in reports the current work state at 100%, the owner is asked
// whether the job is ready for the final walkthrough (YES advances the job; NO just
// acknowledges and the crew keeps working). This mints the YES/NO decision tokens and
// enqueues the owner SMS — but only when the job's current state actually offers a
// progress_100_owner_yes transition, so inspection/terminal states never trigger it.
// Split out of forms-daily-check-in so the gating + enqueue is integration-testable
// with a mock sb client; takes sb as a parameter rather than importing the Deno client.

import { buildActionLink, mintActionToken } from "./action-tokens.ts";

const DECISION_PATH = "/action/decision";
const FINISH_TRIGGER = "progress_100_owner_yes";

export interface FinishWalkthroughJob {
  id: string;
  location_id: string;
  state_set_id: string;
  current_state_id: string | null;
  address: string | null;
}

export interface FinishWalkthroughAskOptions {
  // Required to build the YES/NO links; without it the ask is skipped.
  appBaseUrl?: string;
  // The check-in's log date, so one ask is enqueued per job per day.
  logDate: string;
}

// Pure gate: the owner is asked only when the crew reports the state fully complete AND
// the current state offers the finish-walkthrough transition. Inspection/terminal states
// (which never carry a progress_100_owner_yes transition) therefore never ask.
export function shouldAskFinishWalkthrough(stateProgressPct: number | null, hasFinishTransition: boolean): boolean {
  return stateProgressPct === 100 && hasFinishTransition;
}

// Does the job's current state have a progress_100_owner_yes transition in its set?
async function hasFinishTransition(sb: any, stateSetId: string, fromStateId: string | null): Promise<boolean> {
  if (!fromStateId) return false;
  const { data, error } = await sb
    .from("job_state_transitions")
    .select("id")
    .eq("state_set_id", stateSetId)
    .eq("from_state_id", fromStateId)
    .eq("trigger", FINISH_TRIGGER)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function ownerContactId(sb: any, locationId: string): Promise<string | null> {
  const { data } = await sb
    .from("company_settings")
    .select("owner_contact_id")
    .eq("location_id", locationId)
    .maybeSingle();
  return (data?.owner_contact_id ?? "").trim() || null;
}

// Mints YES/NO decision tokens and enqueues the owner's "ready for the walkthrough?" SMS.
// Returns true only when an ask was enqueued; no-ops (returns false) when progress isn't
// 100, no appBaseUrl is configured, the state offers no finish transition, or no owner
// contact is set. A duplicate dedupe_key (replayed check-in) is swallowed silently.
export async function enqueueFinishWalkthroughAsk(
  sb: any,
  job: FinishWalkthroughJob,
  stateProgressPct: number | null,
  opts: FinishWalkthroughAskOptions,
): Promise<boolean> {
  if (stateProgressPct !== 100 || !opts.appBaseUrl) return false;

  const hasTransition = await hasFinishTransition(sb, job.state_set_id, job.current_state_id);
  if (!shouldAskFinishWalkthrough(stateProgressPct, hasTransition)) return false;

  const owner = await ownerContactId(sb, job.location_id);
  if (!owner) return false;

  const payload = { address: job.address ?? null };
  const yes = await mintActionToken(sb, { action: "finish_walkthrough_yes", jobId: job.id, contactId: null, payload });
  const no = await mintActionToken(sb, { action: "finish_walkthrough_no", jobId: job.id, contactId: null, payload });

  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: job.location_id,
    job_id: job.id,
    channel: "sms",
    recipient: owner,
    template_key: "finish_walkthrough_ask",
    payload: {
      address: job.address ?? null,
      yes_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, yes.token),
      no_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, no.token),
    },
    scheduled_for: new Date().toISOString(),
    dedupe_key: `notif:finish_wt:${job.id}:${opts.logDate}`,
  });
  if (error && !String(error.message ?? error).toLowerCase().includes("duplicate")) throw error;
  return true;
}
