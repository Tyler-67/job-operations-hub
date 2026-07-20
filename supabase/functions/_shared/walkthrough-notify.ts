/* eslint-disable @typescript-eslint/no-explicit-any */
// The owner's "pick the walkthrough date" ask — the walkthrough twin of
// inspection-notify.ts's queueInspectionDateAsk, sharing its rules: crons only own
// SCHEDULED sends (the daily nudge while the date is unset), and every USER action that
// queues this (job promoted into walkthrough via a decision or the office dropdown, owner
// tapped RESCHEDULE) passes force:true so no cron-cadence dedupe can swallow it. The day-of
// APPROVE / PUNCH-LIST ask is walkthrough.ts's enqueueWalkthroughResultAsk — the cron calls
// it with cycleKey `day:<date>` (one ask per walkthrough day), user actions with a unique key.
import { mintActionToken, buildActionLink } from "./action-tokens.ts";
import { stateOffersWalkthroughApproved, type WalkthroughJob } from "./walkthrough.ts";

export const WALKTHROUGH_DATE_ACTION = "walkthrough_date";
export const WALKTHROUGH_DATE_PATH = "/forms/walkthrough-date";

function isDuplicate(error: unknown): boolean {
  return String((error as { message?: unknown })?.message ?? error).toLowerCase().includes("duplicate");
}

// Mints a single-use walkthrough_date token and queues the owner's date-picker link.
export async function queueWalkthroughDateAsk(sb: any, opts: {
  locationId: string;
  jobId: string;
  address: string | null;
  ownerContactId: string;
  appBaseUrl: string;
  localDate: string;
  force?: boolean;
}): Promise<boolean> {
  const minted = await mintActionToken(sb, {
    action: WALKTHROUGH_DATE_ACTION, jobId: opts.jobId, contactId: null,
    payload: { address: opts.address ?? null },
  });
  const link = buildActionLink(opts.appBaseUrl, WALKTHROUGH_DATE_PATH, minted.token);
  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: opts.locationId,
    job_id: opts.jobId,
    channel: "sms",
    recipient: opts.ownerContactId,
    template_key: "walkthrough_date_link",
    payload: { link, address: opts.address ?? null },
    scheduled_for: new Date().toISOString(),
    dedupe_key: opts.force ? null : `notif:wt_date:${opts.jobId}:${opts.localDate}`,
  });
  if (error) { if (isDuplicate(error)) return false; throw error; }
  return true;
}

// The USER-ACTION schedule ask, shared by every path that (re)opens a walkthrough scheduling
// cycle: a job promoted into walkthrough (decision spine or office dropdown) and the owner's
// RESCHEDULE tap. Voids any stale walkthrough_date from a prior cycle (the reminder cron then
// nudges daily until a new date is picked — the walkthrough twin of the 9887475 inspection
// stale-date rule; the appointment id is kept so re-picking a date UPDATEs the same calendar
// event) and texts the owner a fresh date link unconditionally (force — per the always-send
// rule, no cron-cadence dedupe may swallow a genuine user action). Self-gates on the state
// actually offering walkthrough_approved + an owner contact, so any other state is a silent
// no-op and callers can invoke it on every state change.
export async function queueWalkthroughScheduleAsk(
  sb: any,
  job: WalkthroughJob,
  opts: { appBaseUrl?: string },
): Promise<boolean> {
  if (!opts.appBaseUrl) return false;
  if (!(await stateOffersWalkthroughApproved(sb, job.state_set_id, job.current_state_id))) return false;
  const { data: cs } = await sb
    .from("company_settings").select("owner_contact_id").eq("location_id", job.location_id).maybeSingle();
  const ownerContactId = (cs?.owner_contact_id ?? "").trim();
  if (!ownerContactId) return false;

  await sb.from("jobs").update({ walkthrough_date: null }).eq("id", job.id);
  return await queueWalkthroughDateAsk(sb, {
    locationId: job.location_id, jobId: job.id, address: job.address ?? null,
    ownerContactId, appBaseUrl: opts.appBaseUrl,
    localDate: new Date().toISOString().slice(0, 10), force: true,
  });
}
