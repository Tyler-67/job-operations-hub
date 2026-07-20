/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /forms-walkthrough-date  { token, walkthrough_date, slot? }
//
// The owner's branded "schedule the walkthrough" form submits here — the walkthrough twin
// of forms-inspection-date. The action token (minted on walkthrough entry / by the reminder
// cron / on a RESCHEDULE tap, action "walkthrough_date") binds the submission to one job, so
// the body carries only the chosen date + slot. The token is single-use and consumed FIRST:
// a replayed submit returns 410, which also makes the calendar write below safe without its
// own dedupe key. Setting the date is the authoritative effect; the Uptiq calendar
// appointment is best-effort so an unconfigured or unreachable calendar can never block the
// owner from recording the date. Picking TODAY fires the APPROVE / PUNCH-LIST ask
// immediately (the reminder cron's today-check may already be past for the day).
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { normalizeInspectionDateInput } from "../_shared/inspection.ts";
import { syncInspectionAppointment } from "../_shared/inspection-calendar.ts";
import { enqueueWalkthroughResultAsk, stateOffersWalkthroughApproved } from "../_shared/walkthrough.ts";
import { WALKTHROUGH_DATE_ACTION } from "../_shared/walkthrough-notify.ts";
import { localContext } from "../_shared/check-in-schedule.ts";
import { triggerDrain } from "../_shared/drain.ts";

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
    .eq("action", WALKTHROUGH_DATE_ACTION)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, job_id, contact_id, payload")
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

    // Same body shape as the inspection form; the walkthrough_date field name is accepted
    // via the shared normalizer's inspection_date key too, so read both.
    const rawDate = typeof body.walkthrough_date === "string" ? body.walkthrough_date : body.inspection_date;
    const input = normalizeInspectionDateInput({ ...body, inspection_date: rawDate });
    if (!input.inspectionDate) return json({ error: "invalid_date" }, 422);
    const chosenDate = input.inspectionDate;

    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, location_id, address, walkthrough_date, state_set_id, current_state_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);
    const oldDate = job.walkthrough_date ? String(job.walkthrough_date).slice(0, 10) : null;

    // 1. Authoritative write: record the chosen walkthrough date on the job.
    const { error: updErr } = await sb.from("jobs").update({ walkthrough_date: chosenDate }).eq("id", jobId);
    if (updErr) throw updErr;

    // 2. Best-effort calendar appointment (same company calendar as inspections; the event
    //    title says Walkthrough). Errors are returned, never thrown.
    const cal = await syncInspectionAppointment(sb, { jobId, slot: input.slot, kind: "walkthrough" });

    // 2b. Picking TODAY makes the APPROVE / PUNCH-LIST ask due NOW. Only on a real date
    //     change (a re-save of the same date leaves the earlier ask's links live), and only
    //     while the job actually sits in a walkthrough-capable state. Keyed per submission
    //     (the consumed token id) — the single-use token blocks replays.
    let resultAsked = false;
    if (chosenDate !== oldDate && job.current_state_id) {
      const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
      const { data: loc } = await sb.from("locations").select("timezone").eq("id", job.location_id).maybeSingle();
      const tz = (typeof loc?.timezone === "string" && loc.timezone.trim()) || "America/Chicago";
      const { date: localToday } = localContext(tz, new Date());
      if (chosenDate === localToday && appBaseUrl &&
        await stateOffersWalkthroughApproved(sb, job.state_set_id, job.current_state_id)) {
        resultAsked = await enqueueWalkthroughResultAsk(
          sb,
          { id: jobId, location_id: job.location_id, state_set_id: job.state_set_id, current_state_id: job.current_state_id, address: job.address ?? null },
          { appBaseUrl, cycleKey: claim.id as string },
        );
      }
    }
    if (resultAsked) await triggerDrain();

    // 3. Idempotent audit entry (date is the natural per-job dedupe key). Records the REAL
    //    calendar outcome (status + error) so a failed sync is diagnosable, not silent.
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.walkthrough_date",
      dedupe_key: `walkthrough_date:${jobId}:${chosenDate}`,
      actor_contact_id: claim.contact_id ?? null,
      payload: {
        job_id: jobId, walkthrough_date: chosenDate, slot: input.slot,
        appointment: cal.action, appointment_status: cal.status ?? null,
        appointment_error: cal.error ?? null, appointment_detail: cal.detail ?? null,
      },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({ ok: true, job_id: jobId, walkthrough_date: chosenDate, slot: input.slot, appointment: cal.action, calendar: cal, result_asked: resultAsked });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
