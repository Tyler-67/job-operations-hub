/* eslint-disable @typescript-eslint/no-explicit-any */
// When a job enters the final walkthrough state (the owner tapped YES on the
// finish-work ask), the owner is handed two single-use decision links: APPROVE
// (advances the job to complete, ready to invoice) and PUNCH LIST (records the
// items still to fix and keeps the job in walkthrough). This mints both tokens and
// enqueues the owner SMS — but only when the job's new state actually offers a
// walkthrough_approved transition, so non-walkthrough states never trigger it.
// Split out of action-decision so the gating + enqueue is integration-testable with
// a mock sb client; takes sb as a parameter rather than importing the Deno client.

import { buildActionLink, mintActionToken } from "./action-tokens.ts";

const DECISION_PATH = "/action/decision";
const APPROVE_TRIGGER = "walkthrough_approved";

export interface WalkthroughJob {
  id: string;
  location_id: string;
  state_set_id: string;
  current_state_id: string | null;
  address: string | null;
}

export interface WalkthroughResultAskOptions {
  // Required to build the APPROVE/PUNCH-LIST links; without it the ask is skipped.
  appBaseUrl?: string;
  // Per-ENTRY discriminator for the dedupe key (the decision spine's cycle key — consumed
  // token id or office-fire uuid — or a fresh uuid on the office state-dropdown path). The
  // key used to be (job, state)-scoped, which silently swallowed the ask every time a job
  // RE-entered walkthrough for the rest of its life (found live 2026-07-20: second pass
  // into walkthrough → owner never texted). Real replay protection is upstream: the
  // transition CHANGE gate + single-use decision tokens.
  cycleKey: string;
}

// Does the job's (new) current state have a walkthrough_approved transition in its set?
// This is the data-driven gate: only a genuine walkthrough state offers it, so the ask
// never fires on work/inspection/terminal states even if some other decision lands there.
async function hasApproveTransition(sb: any, stateSetId: string, fromStateId: string | null): Promise<boolean> {
  if (!fromStateId) return false;
  const { data, error } = await sb
    .from("job_state_transitions")
    .select("id")
    .eq("state_set_id", stateSetId)
    .eq("from_state_id", fromStateId)
    .eq("trigger", APPROVE_TRIGGER)
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

// Mints APPROVE/PUNCH-LIST decision tokens and enqueues the owner's "approve the
// walkthrough?" SMS. Returns true only when an ask was enqueued; no-ops (returns false)
// when no appBaseUrl is configured, the state offers no walkthrough_approved transition,
// or no owner contact is set. A duplicate dedupe_key (replayed entry) is swallowed.
export async function enqueueWalkthroughResultAsk(
  sb: any,
  job: WalkthroughJob,
  opts: WalkthroughResultAskOptions,
): Promise<boolean> {
  if (!opts.appBaseUrl) return false;

  const hasTransition = await hasApproveTransition(sb, job.state_set_id, job.current_state_id);
  if (!hasTransition) return false;

  const owner = await ownerContactId(sb, job.location_id);
  if (!owner) return false;

  const payload = { address: job.address ?? null };
  const approve = await mintActionToken(sb, { action: "walkthrough_approve", jobId: job.id, contactId: null, payload });
  const punch = await mintActionToken(sb, { action: "walkthrough_punch_list", jobId: job.id, contactId: null, payload });
  const reschedule = await mintActionToken(sb, { action: "walkthrough_reschedule", jobId: job.id, contactId: null, payload });

  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: job.location_id,
    job_id: job.id,
    channel: "sms",
    recipient: owner,
    template_key: "walkthrough_result_ask",
    payload: {
      address: job.address ?? null,
      approve_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, approve.token),
      punch_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, punch.token),
      reschedule_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, reschedule.token),
    },
    scheduled_for: new Date().toISOString(),
    dedupe_key: `notif:walkthrough_ask:${job.id}:${opts.cycleKey}`,
  });
  if (error && !String(error.message ?? error).toLowerCase().includes("duplicate")) throw error;
  return true;
}

export interface WalkthroughReaskOptions {
  // Required to build the APPROVE / STILL-ISSUES / RESCHEDULE links; without it the re-ask is skipped.
  appBaseUrl?: string;
  // Per-submission discriminator (the consumed punch-list token id) for the re-ask dedupe key,
  // so each completed punch list enqueues a fresh re-ask instead of colliding once per day.
  cycleKey: string;
}

// Re-asks the owner after a punch list is completed: mints fresh APPROVE / STILL-ISSUES
// (restart the punch-list form) / RESCHEDULE decision tokens and enqueues the
// walkthrough_reask SMS. Same gating as the initial ask (state still offers
// walkthrough_approved + an owner contact), so it closes the loop only while the job is
// genuinely sitting in the walkthrough state. A duplicate dedupe_key (replayed submit) is
// swallowed. Returns true only when a re-ask was enqueued.
export async function enqueueWalkthroughReask(
  sb: any,
  job: WalkthroughJob,
  opts: WalkthroughReaskOptions,
): Promise<boolean> {
  if (!opts.appBaseUrl) return false;

  const hasTransition = await hasApproveTransition(sb, job.state_set_id, job.current_state_id);
  if (!hasTransition) return false;

  const owner = await ownerContactId(sb, job.location_id);
  if (!owner) return false;

  const payload = { address: job.address ?? null };
  const approve = await mintActionToken(sb, { action: "walkthrough_approve", jobId: job.id, contactId: null, payload });
  const still = await mintActionToken(sb, { action: "walkthrough_still_issues", jobId: job.id, contactId: null, payload });
  const reschedule = await mintActionToken(sb, { action: "walkthrough_reschedule", jobId: job.id, contactId: null, payload });

  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: job.location_id,
    job_id: job.id,
    channel: "sms",
    recipient: owner,
    template_key: "walkthrough_reask",
    payload: {
      address: job.address ?? null,
      approve_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, approve.token),
      still_issues_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, still.token),
      reschedule_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, reschedule.token),
    },
    scheduled_for: new Date().toISOString(),
    dedupe_key: `notif:walkthrough_reask:${job.id}:${opts.cycleKey}`,
  });
  if (error && !String(error.message ?? error).toLowerCase().includes("duplicate")) throw error;
  return true;
}
