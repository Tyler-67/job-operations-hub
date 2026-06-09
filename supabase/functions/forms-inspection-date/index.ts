/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /forms-inspection-date  { token, inspection_date, slot? }
//
// The owner's branded "set the inspection date" form submits here. The action token
// (minted by cron-inspection-reminders, action "inspection_date") binds the submission
// to one job, so the form body carries only the chosen date + slot. The token is
// single-use and consumed FIRST: a replayed submit returns 410, which also makes the
// calendar write below safe without its own dedupe key. Setting the date is the
// authoritative effect; the Uptiq calendar appointment is best-effort so an unconfigured
// or unreachable calendar can never block the owner from recording the date.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { buildAppointmentTimes, normalizeInspectionDateInput, slotLabel } from "../_shared/inspection.ts";
import { uptiq } from "../_shared/uptiq.ts";

const INSPECTION_DATE_ACTION = "inspection_date";

function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}

async function consumeToken(sb: any, token: string) {
  const hash = await hashActionToken(token, resolveActionSecret());
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("action_tokens")
    .update({ used_at: now })
    .eq("token_hash", hash)
    .eq("action", INSPECTION_DATE_ACTION)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("job_id, contact_id, payload")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = serviceClient();

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return json({ error: "missing_token" }, 400);

    const claim = await consumeToken(sb, token);
    if (!claim) return json({ error: "invalid_or_expired" }, 410);
    if (!claim.job_id) return json({ error: "token_not_bound" }, 422);
    const jobId = claim.job_id as string;

    const input = normalizeInspectionDateInput(body);
    if (!input.inspectionDate) return json({ error: "invalid_date" }, 422);

    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, location_id, address")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);

    // 1. Authoritative write: record the chosen calendar date on the job.
    const { error: updErr } = await sb.from("jobs").update({ inspection_date: input.inspectionDate }).eq("id", jobId);
    if (updErr) throw updErr;

    // 2. Best-effort calendar appointment on the company's inspections calendar. Gated on
    //    a configured calendar + owner contact; any Uptiq error is captured, not thrown,
    //    so the recorded date stands regardless of calendar state.
    let appointment = "skipped_no_calendar";
    const { data: settings } = await sb
      .from("company_settings")
      .select("inspections_calendar_id, owner_contact_id")
      .eq("location_id", job.location_id)
      .maybeSingle();
    const calendarId = (settings?.inspections_calendar_id as string | null)?.trim() || null;
    const ownerContactId = (settings?.owner_contact_id as string | null)?.trim() || null;
    if (calendarId && ownerContactId) {
      const { startLocal, endLocal } = buildAppointmentTimes(input.inspectionDate, input.slot);
      // Field shape follows the Uptiq (LeadConnector) appointments API.
      const res = await uptiq.createAppointment({
        calendarId,
        locationId: job.location_id,
        contactId: ownerContactId,
        startTime: startLocal,
        endTime: endLocal,
        title: `Inspection — ${job.address ?? "job site"} (${slotLabel(input.slot)})`,
        ignoreFreeSlotValidation: true,
      });
      appointment = res.ok ? "created" : "failed";
    }

    // 3. Idempotent audit entry (date is the natural per-job dedupe key).
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.inspection_date",
      dedupe_key: `inspection_date:${jobId}:${input.inspectionDate}`,
      actor_contact_id: claim.contact_id ?? null,
      payload: { job_id: jobId, inspection_date: input.inspectionDate, slot: input.slot, appointment },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({ ok: true, job_id: jobId, inspection_date: input.inspectionDate, slot: input.slot, appointment });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
