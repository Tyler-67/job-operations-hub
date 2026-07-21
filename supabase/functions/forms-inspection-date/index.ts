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
import { normalizeInspectionDateInput } from "../_shared/inspection.ts";
import { syncInspectionAppointment } from "../_shared/inspection-calendar.ts";
import { queueInspectionResultAsk } from "../_shared/inspection-notify.ts";
import { localContext } from "../_shared/check-in-schedule.ts";
import { triggerDrain } from "../_shared/drain.ts";

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
      .select("id, location_id, address, inspection_date, current_state_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);
    const oldDate = job.inspection_date ? String(job.inspection_date).slice(0, 10) : null;

    // 1. Authoritative write: record the chosen calendar date AND time window on the job —
    //    the stored slot is what keeps a later office date change from re-timing the
    //    appointment back to the default morning window.
    const { error: updErr } = await sb.from("jobs").update({ inspection_date: input.inspectionDate, inspection_slot: input.slot }).eq("id", jobId);
    if (updErr) throw updErr;

    // 2. Best-effort calendar appointment on the company's inspections calendar (shared helper,
    //    also used by the office job form). Any Uptiq error is returned, not thrown, so the
    //    recorded date stands regardless of calendar/scope state.
    const cal = await syncInspectionAppointment(sb, { jobId, slot: input.slot });

    // 2b. Picking TODAY makes the day-of PASS/FAIL ask due NOW — the reminder cron's today-check
    //     may already be past for the day, so waiting on it would mean the ask never sends. Only
    //     on a real date change (a re-save of the same date leaves the earlier ask's links live),
    //     and only while the job actually sits in an inspection phase (cron Branch-B parity —
    //     PASS/FAIL links are no-ops anywhere else).
    let resultAsked = false;
    if (input.inspectionDate !== oldDate && job.current_state_id) {
      const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
      const [{ data: state }, { data: loc }, { data: cs }] = await Promise.all([
        sb.from("job_states").select("is_inspection").eq("id", job.current_state_id).maybeSingle(),
        sb.from("locations").select("timezone").eq("id", job.location_id).maybeSingle(),
        sb.from("company_settings").select("owner_contact_id, office_contact_id").eq("location_id", job.location_id).maybeSingle(),
      ]);
      const tz = (typeof loc?.timezone === "string" && loc.timezone.trim()) || "America/Chicago";
      const { date: localToday } = localContext(tz, new Date());
      const ownerContactId = (cs?.owner_contact_id ?? "").trim();
      if (state?.is_inspection === true && input.inspectionDate === localToday && ownerContactId && appBaseUrl) {
        resultAsked = await queueInspectionResultAsk(sb, {
          locationId: job.location_id, jobId, address: job.address ?? null,
          inspectionDate: input.inspectionDate, ownerContactId,
          officeContactId: cs?.office_contact_id ?? null, appBaseUrl, force: true,
        });
      }
    }
    if (resultAsked) await triggerDrain();

    // 3. Idempotent audit entry (date is the natural per-job dedupe key). Records the REAL
    //    calendar outcome (status + error) so a failed sync is diagnosable, not silent.
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.inspection_date",
      dedupe_key: `inspection_date:${jobId}:${input.inspectionDate}`,
      actor_contact_id: claim.contact_id ?? null,
      payload: {
        job_id: jobId, inspection_date: input.inspectionDate, slot: input.slot,
        appointment: cal.action, appointment_status: cal.status ?? null,
        appointment_error: cal.error ?? null, appointment_detail: cal.detail ?? null,
      },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({ ok: true, job_id: jobId, inspection_date: input.inspectionDate, slot: input.slot, appointment: cal.action, calendar: cal, result_asked: resultAsked });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
