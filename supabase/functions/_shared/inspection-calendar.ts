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

export interface InspectionCalendarResult {
  ok: boolean;
  action: "created" | "updated" | "skipped_no_calendar" | "skipped_no_date" | "failed";
  status?: number;
  error?: string;
  detail?: string;
  appointment_id?: string | null;
}

// LeadConnector's appointment create/update responses nest the id differently across versions;
// probe the known shapes so a reschedule can target the same event.
function appointmentIdFrom(data: unknown): string | null {
  const d = data as Record<string, any> | null;
  return (d?.id ?? d?.appointment?.id ?? d?.event?.id ?? d?.calendarEvent?.id ?? null) as string | null;
}

// Sync the inspection appointment for a job whose inspection_date is already written.
// slot defaults to the morning window (the office job form has no slot picker).
export async function syncInspectionAppointment(
  sb: any,
  opts: { jobId: string; slot?: InspectionSlot },
): Promise<InspectionCalendarResult> {
  const { data: job } = await sb
    .from("jobs")
    .select("id, location_id, address, inspection_date, inspection_appointment_id")
    .eq("id", opts.jobId)
    .maybeSingle();
  if (!job?.inspection_date) return { ok: false, action: "skipped_no_date" };
  const dateStr = String(job.inspection_date).slice(0, 10);

  // Records every non-trivial outcome (skip/fail/create/update, with the real provider status +
  // error) so a blocked calendar sync is diagnosable from event_log — both the owner SMS date-form
  // and the office job form flow through here, and both previously failed silently.
  const logResult = async (r: InspectionCalendarResult): Promise<InspectionCalendarResult> => {
    await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "app",
      kind: "calendar.inspection_appointment",
      payload: { job_id: job.id, action: r.action, status: r.status ?? null, error: r.error ?? null, detail: r.detail ?? null, appointment_id: r.appointment_id ?? null },
    });
    return r;
  };

  const [{ data: settings }, { data: loc }] = await Promise.all([
    sb.from("company_settings").select("inspections_calendar_id, owner_contact_id").eq("location_id", job.location_id).maybeSingle(),
    sb.from("locations").select("uptiq_location_id, timezone").eq("id", job.location_id).maybeSingle(),
  ]);
  const calendarId = (settings?.inspections_calendar_id as string | null)?.trim() || null;
  const ownerContactId = (settings?.owner_contact_id as string | null)?.trim() || null;
  // LeadConnector expects the GHL location id, NOT our internal Supabase UUID.
  const uptiqLocationId = (loc?.uptiq_location_id as string | null)?.trim() || null;
  if (!calendarId || !ownerContactId || !uptiqLocationId) return await logResult({ ok: false, action: "skipped_no_calendar" });

  const slot: InspectionSlot = opts.slot ?? "9am";
  const { start, end } = appointmentTimesWithZone(dateStr, slot, loc?.timezone as string | null);
  const payload: Record<string, unknown> = {
    calendarId,
    locationId: uptiqLocationId,
    contactId: ownerContactId,
    startTime: start,
    endTime: end,
    title: `Inspection — ${job.address ?? "job site"} (${slotLabel(slot)})`,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: true,
  };
  if (job.address) payload.address = job.address;

  const existingId = (job.inspection_appointment_id as string | null)?.trim() || null;
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
  if (newId) await sb.from("jobs").update({ inspection_appointment_id: newId }).eq("id", job.id);
  return await logResult({ ok: true, action: "created", status: res.status, appointment_id: newId });
}
