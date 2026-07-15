/* eslint-disable @typescript-eslint/no-explicit-any */
// Enqueues the owner's "pick the inspection date" SMS: mints a single-use inspection_date token and
// queues the branded date-picker link. Shared by TWO callers so they stay in lockstep:
//   • cron-inspection-reminders — the daily nudge while a job sits in an inspection phase with no date.
//   • forms-daily-check-in — sends it IMMEDIATELY when a crew marks a phase ready for inspection, so
//     the owner gets the actionable link right away instead of waiting for the reminder cron.
// The per-day dedupe key format lives HERE (one source), keyed on the company-local date, so an
// immediate send and a same-day cron run collapse to one message. Returns false when deduped.
import { mintActionToken, buildActionLink } from "./action-tokens.ts";

const INSPECTION_DATE_ACTION = "inspection_date";
const INSPECTION_DATE_PATH = "/forms/inspection-date";

function isDuplicate(error: unknown): boolean {
  return String((error as { message?: unknown })?.message ?? error).toLowerCase().includes("duplicate");
}

export async function queueInspectionDateAsk(sb: any, opts: {
  locationId: string;
  jobId: string;
  address: string | null;
  ownerContactId: string;
  appBaseUrl: string;
  localDate: string;
  // Forced testing runs (Settings "run cron") skip dedupe so a repeat click is never swallowed.
  force?: boolean;
}): Promise<boolean> {
  const minted = await mintActionToken(sb, {
    action: INSPECTION_DATE_ACTION, jobId: opts.jobId, contactId: null,
    payload: { address: opts.address ?? null },
  });
  const link = buildActionLink(opts.appBaseUrl, INSPECTION_DATE_PATH, minted.token);
  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: opts.locationId,
    job_id: opts.jobId,
    channel: "sms",
    recipient: opts.ownerContactId,
    template_key: "inspection_date_link",
    payload: { link, address: opts.address ?? null },
    scheduled_for: new Date().toISOString(),
    dedupe_key: opts.force ? null : `notif:insp_date:${opts.jobId}:${opts.localDate}`,
  });
  if (error) { if (isDuplicate(error)) return false; throw error; }
  return true;
}
