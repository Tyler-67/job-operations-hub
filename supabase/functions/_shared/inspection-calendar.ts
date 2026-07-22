/* eslint-disable @typescript-eslint/no-explicit-any */
// Creates (or re-schedules) the Uptiq/LeadConnector calendar appointment for a job's inspection.
// Shared by the owner SMS date-form (forms-inspection-date) and the office job form (jobs) so both
// land the inspection on the company's Uptiq inspections calendar identically.
//
// Best-effort: the caller has ALREADY written jobs.inspection_date authoritatively; a calendar
// failure is RETURNED (with the real provider status/error) but never thrown, so recording the date
// never depends on the calendar. The created appointment id is stored on jobs.inspection_appointment_id
// so a later date change UPDATEs the same event instead of duplicating it.
import { appointmentTimesWithZone, slotLabel, type InspectionSlot } from "./inspection.ts";
import { uptiq } from "./uptiq.ts";
import { uptiqApiLocationId } from "./instances.ts";

export interface InspectionCalendarResult {
  ok: boolean;
  action: "created" | "updated" | "cancelled" | "skipped_no_calendar" | "skipped_no_date" | "skipped_no_appointment" | "failed";
  status?: number;
  error?: string;
  detail?: string;
  appointment_id?: string | null;
}

// The same machinery schedules WALKTHROUGH appointments (2026-07-20 parity): identical flow,
// different job columns + event title. Both kinds land on the company's one configured Uptiq
// calendar (inspections_calendar_id) — the title tells them apart on the calendar.
export type AppointmentKind = "inspection" | "walkthrough";
const KIND_CONFIG: Record<AppointmentKind, { dateCol: string; idCol: string; slotCol: string; title: string; logKind: string }> = {
  inspection: { dateCol: "inspection_date", idCol: "inspection_appointment_id", slotCol: "inspection_slot", title: "Inspection", logKind: "calendar.inspection_appointment" },
  walkthrough: { dateCol: "walkthrough_date", idCol: "walkthrough_appointment_id", slotCol: "walkthrough_slot", title: "Walkthrough", logKind: "calendar.walkthrough_appointment" },
};

function slotOf(value: unknown): InspectionSlot | null {
  return value === "9am" || value === "1pm" ? value : null;
}

// LeadConnector's appointment create/update responses nest the id differently across versions;
// probe the known shapes so a reschedule can target the same event.
function appointmentIdFrom(data: unknown): string | null {
  const d = data as Record<string, any> | null;
  return (d?.id ?? d?.appointment?.id ?? d?.event?.id ?? d?.calendarEvent?.id ?? null) as string | null;
}

// Sync the inspection/walkthrough appointment for a job whose date column is already written.
// Slot resolution: an explicit opts.slot wins, else the slot STORED on the job (written by the
// owner date-forms and the office job form), else the morning window — so a date-only change
// keeps the previously chosen time instead of snapping the event back to 9am.
export async function syncInspectionAppointment(
  sb: any,
  opts: { jobId: string; slot?: InspectionSlot; kind?: AppointmentKind },
): Promise<InspectionCalendarResult> {
  const kind = KIND_CONFIG[opts.kind ?? "inspection"];
  const { data: job } = await sb
    .from("jobs")
    .select(`id, location_id, address, ${kind.dateCol}, ${kind.idCol}, ${kind.slotCol}`)
    .eq("id", opts.jobId)
    .maybeSingle();
  if (!job?.[kind.dateCol]) return { ok: false, action: "skipped_no_date" };
  const dateStr = String(job[kind.dateCol]).slice(0, 10);
  const slot: InspectionSlot = opts.slot ?? slotOf(job[kind.slotCol]) ?? "9am";

  // Records every non-trivial outcome (skip/fail/create/update, with the real provider status +
  // error) so a blocked calendar sync is diagnosable from event_log — both the owner SMS date-form
  // and the office job form flow through here, and both previously failed silently.
  const logResult = async (r: InspectionCalendarResult): Promise<InspectionCalendarResult> => {
    await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "app",
      kind: kind.logKind,
      payload: { job_id: job.id, action: r.action, status: r.status ?? null, error: r.error ?? null, detail: r.detail ?? null, appointment_id: r.appointment_id ?? null, slot },
    });
    return r;
  };

  const [{ data: settings }, { data: loc }] = await Promise.all([
    sb.from("company_settings").select("inspections_calendar_id, owner_contact_id").eq("location_id", job.location_id).maybeSingle(),
    sb.from("locations").select("uptiq_location_id, uptiq_sync_location_id, timezone").eq("id", job.location_id).maybeSingle(),
  ]);
  const calendarId = (settings?.inspections_calendar_id as string | null)?.trim() || null;
  const ownerContactId = (settings?.owner_contact_id as string | null)?.trim() || null;
  // LeadConnector expects the GHL location id, NOT our internal Supabase UUID. The sync
  // bridge lets the Development instance book on the real staging location's calendar.
  const uptiqLocationId = uptiqApiLocationId(loc);
  if (!calendarId || !ownerContactId || !uptiqLocationId) return await logResult({ ok: false, action: "skipped_no_calendar" });

  const { start, end } = appointmentTimesWithZone(dateStr, slot, loc?.timezone as string | null);
  const payload: Record<string, unknown> = {
    calendarId,
    locationId: uptiqLocationId,
    contactId: ownerContactId,
    startTime: start,
    endTime: end,
    title: `${kind.title} — ${job.address ?? "job site"} (${slotLabel(slot)})`,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: true,
  };
  if (job.address) payload.address = job.address;

  const existingId = (job[kind.idCol] as string | null)?.trim() || null;
  const res = existingId
    ? await uptiq.updateAppointment(existingId, payload)
    : await uptiq.createAppointment(payload);

  if (!res.ok) {
    let detail: string | undefined;
    try { detail = res.data ? JSON.stringify(res.data).slice(0, 300) : undefined; } catch { detail = undefined; }
    return await logResult({
      ok: false, action: "failed", status: res.status,
      error: typeof res.error === "string" ? res.error : `HTTP ${res.status}`, detail,
    });
  }

  if (existingId) return await logResult({ ok: true, action: "updated", status: res.status, appointment_id: existingId });

  const newId = appointmentIdFrom(res.data);
  if (newId) await sb.from("jobs").update({ [kind.idCol]: newId }).eq("id", job.id);
  return await logResult({ ok: true, action: "created", status: res.status, appointment_id: newId });
}

// Remove a job's inspection appointment from the Uptiq calendar (job archived, or cleaning up a
// test event). Best-effort + logged; clears jobs.inspection_appointment_id on success so the job
// and calendar stay in sync. No-op when the job has no stored appointment.
export async function cancelInspectionAppointment(
  sb: any,
  opts: { jobId: string; kind?: AppointmentKind },
): Promise<InspectionCalendarResult> {
  const kind = KIND_CONFIG[opts.kind ?? "inspection"];
  const { data: job } = await sb
    .from("jobs")
    .select(`id, location_id, ${kind.idCol}`)
    .eq("id", opts.jobId)
    .maybeSingle();
  const apptId = (job?.[kind.idCol] as string | null)?.trim() || null;
  if (!job || !apptId) return { ok: false, action: "skipped_no_appointment" };

  const res = await uptiq.deleteAppointment(apptId);
  const result: InspectionCalendarResult = res.ok
    ? { ok: true, action: "cancelled", status: res.status, appointment_id: apptId }
    : { ok: false, action: "failed", status: res.status, error: typeof res.error === "string" ? res.error : `HTTP ${res.status}` };
  // Only clear the stored id when the delete actually succeeded, so a failed cancel can be retried.
  if (res.ok) await sb.from("jobs").update({ [kind.idCol]: null }).eq("id", job.id);
  await sb.from("event_log").insert({
    location_id: job.location_id,
    source: "app",
    kind: kind.logKind,
    payload: { job_id: job.id, action: result.action, status: result.status ?? null, error: result.error ?? null, appointment_id: apptId, cancel: true },
  });
  return result;
}
