/* eslint-disable @typescript-eslint/no-explicit-any */
// The owner-facing inspection asks, shared between the reminder CRON and the user-action paths
// so both stay in lockstep. The rule (per Tyler): crons only own SCHEDULED sends — the daily
// nudge while a date is unset, and the day-of result ask at the reminder hour. Anything a USER
// does that queues one of these (crew requests an inspection, owner/office picks a date) sends
// immediately and unconditionally — action callers pass force:true so no cron-cadence dedupe can
// ever swallow a genuine request. The per-day/per-date dedupe keys below therefore only guard the
// CRON against re-sending on its own schedule.
import { mintActionToken, buildActionLink } from "./action-tokens.ts";
import { appointmentTimesWithZone } from "./inspection.ts";

const INSPECTION_DATE_ACTION = "inspection_date";
const INSPECTION_DATE_PATH = "/forms/inspection-date";
const DECISION_PATH = "/action/decision";

function isDuplicate(error: unknown): boolean {
  return String((error as { message?: unknown })?.message ?? error).toLowerCase().includes("duplicate");
}

// The job's current stage label ("Rough-In Inspection") so every inspection text says WHICH
// inspection it is. Callers that already hold the label (the reminder cron's state map) pass
// it via opts to skip the lookup; user-action callers omit it and this resolves it. At every
// enqueue site the job is already IN the inspection state, so current_state_id is the stage.
async function resolvePhaseLabel(sb: any, jobId: string, provided?: string | null): Promise<string | null> {
  if (typeof provided === "string" && provided.trim()) return provided.trim();
  const { data: job } = await sb.from("jobs").select("current_state_id").eq("id", jobId).maybeSingle();
  if (!job?.current_state_id) return null;
  const { data: state } = await sb.from("job_states").select("label").eq("id", job.current_state_id).maybeSingle();
  const label = (state?.label ?? "").trim();
  return label || null;
}

// The owner's "pick the inspection date" SMS: mints a single-use inspection_date token and
// queues the branded date-picker link. Callers: cron-inspection-reminders (daily nudge, deduped
// per local day) and forms-daily-check-in (immediate on a ready-for-inspection advance, force —
// a re-requested inspection must re-text the owner even if a nudge already went out that day).
export async function queueInspectionDateAsk(sb: any, opts: {
  locationId: string;
  jobId: string;
  address: string | null;
  ownerContactId: string;
  appBaseUrl: string;
  localDate: string;
  force?: boolean;
  phaseLabel?: string | null;
}): Promise<boolean> {
  const phaseLabel = await resolvePhaseLabel(sb, opts.jobId, opts.phaseLabel);
  const minted = await mintActionToken(sb, {
    action: INSPECTION_DATE_ACTION, jobId: opts.jobId, contactId: null,
    payload: { address: opts.address ?? null, phase_label: phaseLabel },
  });
  const link = buildActionLink(opts.appBaseUrl, INSPECTION_DATE_PATH, minted.token);
  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: opts.locationId,
    job_id: opts.jobId,
    channel: "sms",
    recipient: opts.ownerContactId,
    template_key: "inspection_date_link",
    payload: { link, address: opts.address ?? null, phase_label: phaseLabel },
    scheduled_for: new Date().toISOString(),
    dedupe_key: opts.force ? null : `notif:insp_date:${opts.jobId}:${opts.localDate}`,
  });
  if (error) { if (isDuplicate(error)) return false; throw error; }
  return true;
}

// The day-of "PASS or FAIL?" ask: mints both single-use decision tokens and queues the owner SMS
// (plus the office heads-up copy). Callers: cron-inspection-reminders Branch B (reminder hour,
// deduped per job+inspection date) and the date-set paths (owner SMS form / office job form) when
// the date lands on TODAY — the cron's today-check has already passed by then, so without the
// immediate send the ask would never go out. Action callers pass force:true and only fire on a
// REAL date change, so a no-op re-save can't double-text while a genuine re-inspection always does.
export async function queueInspectionResultAsk(sb: any, opts: {
  locationId: string;
  jobId: string;
  address: string | null;
  inspectionDate: string; // YYYY-MM-DD, the job's recorded inspection date
  ownerContactId: string;
  officeContactId?: string | null;
  appBaseUrl: string;
  force?: boolean;
  phaseLabel?: string | null;
}): Promise<boolean> {
  const phaseLabel = await resolvePhaseLabel(sb, opts.jobId, opts.phaseLabel);

  // WHEN to ask: at the appointment window's start, not the moment the date lands. Setting
  // today's date in the morning with a 1pm window must not fire PASS/FAIL immediately — the
  // inspection hasn't happened yet. Uses the job's stored time window (morning default when
  // none was chosen); if the window already passed, ask now. The 15-min delivery sweep
  // carries it out once scheduled_for arrives.
  const [{ data: slotRow }, { data: locRow }] = await Promise.all([
    sb.from("jobs").select("inspection_slot").eq("id", opts.jobId).maybeSingle(),
    sb.from("locations").select("timezone").eq("id", opts.locationId).maybeSingle(),
  ]);
  const slot = slotRow?.inspection_slot === "1pm" ? "1pm" as const : "9am" as const;
  const windowStart = new Date(appointmentTimesWithZone(opts.inspectionDate, slot, (locRow?.timezone as string | null) ?? null).start);
  const scheduledFor = Number.isFinite(windowStart.getTime()) && windowStart.getTime() > Date.now()
    ? windowStart.toISOString()
    : new Date().toISOString();

  // PASS and FAIL are one text: share a batch so answering one burns the other.
  const batchId = crypto.randomUUID();
  const pass = await mintActionToken(sb, {
    action: "inspection_pass", jobId: opts.jobId, contactId: null, batchId,
    payload: { address: opts.address ?? null, phase_label: phaseLabel },
  });
  const fail = await mintActionToken(sb, {
    action: "inspection_fail", jobId: opts.jobId, contactId: null, batchId,
    payload: { address: opts.address ?? null, phase_label: phaseLabel },
  });
  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: opts.locationId,
    job_id: opts.jobId,
    channel: "sms",
    recipient: opts.ownerContactId,
    template_key: "inspection_result_ask",
    payload: {
      address: opts.address ?? null,
      phase_label: phaseLabel,
      pass_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, pass.token),
      fail_link: buildActionLink(opts.appBaseUrl, DECISION_PATH, fail.token),
    },
    scheduled_for: scheduledFor,
    dedupe_key: opts.force ? null : `notif:insp_result:${opts.jobId}:${opts.inspectionDate}`,
  });
  if (error) { if (isDuplicate(error)) return false; throw error; }

  const officeContactId = (opts.officeContactId ?? "").trim();
  if (officeContactId) {
    const { error: oErr } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "sms",
      recipient: officeContactId,
      template_key: "inspection_reminder_office_notice",
      payload: { phase: "result", address: opts.address ?? null, phase_label: phaseLabel },
      scheduled_for: scheduledFor,
      dedupe_key: opts.force ? null : `notif:insp_result_office:${opts.jobId}:${opts.inspectionDate}`,
    });
    if (oErr && !isDuplicate(oErr)) throw oErr;
  }
  return true;
}
