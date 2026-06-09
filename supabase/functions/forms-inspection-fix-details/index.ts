/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /forms-inspection-fix-details  { token, details }
//
// The owner's branded "what needs fixing" form submits here after a failed inspection.
// The action token (minted by the decision spine on inspection_fail, action
// "inspection_fix_details") binds the submission to one job, so the body carries only the
// free-text details. The token is single-use and consumed FIRST: a replayed submit returns
// 410, which also makes the note append + crew notice below safe without their own dedupe.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { appendFixDetailsNote, normalizeFixDetailsInput } from "../_shared/fix-details.ts";

const FIX_DETAILS_ACTION = "inspection_fix_details";

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
    .eq("action", FIX_DETAILS_ACTION)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("job_id, contact_id, payload")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// The lead crew's Uptiq contact id, so the drain cron can deliver the fix list to them.
async function crewLeadContactId(sb: any, jobId: string): Promise<string | null> {
  const { data } = await sb
    .from("job_crew")
    .select("contacts(uptiq_contact_id)")
    .eq("job_id", jobId)
    .eq("is_lead", true)
    .limit(1)
    .maybeSingle();
  return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
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

    const { details } = normalizeFixDetailsInput(body);
    if (!details) return json({ error: "missing_details" }, 422);

    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, location_id, address, notes")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);

    const today = new Date().toISOString().slice(0, 10);

    // 1. Authoritative write: append the dated fix list to the job's running notes.
    const { error: updErr } = await sb
      .from("jobs")
      .update({ notes: appendFixDetailsNote(job.notes ?? null, today, details) })
      .eq("id", jobId);
    if (updErr) throw updErr;

    // 2. Notify the crew lead with the actual fix list (best-effort: skipped if none configured).
    let notified = false;
    const crewLead = await crewLeadContactId(sb, jobId);
    if (crewLead) {
      const { error: notifErr } = await sb.from("scheduled_notifications").insert({
        location_id: job.location_id,
        job_id: jobId,
        channel: "sms",
        recipient: crewLead,
        template_key: "inspection_fix_details_notice",
        payload: { address: job.address ?? null, details },
        scheduled_for: new Date().toISOString(),
        dedupe_key: `notif:fix_details:${jobId}:${today}`,
      });
      if (notifErr && !isDuplicateKeyError(notifErr)) throw notifErr;
      notified = true;
    }

    // 3. Idempotent audit entry (one fix-details submission per job per day).
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.inspection_fix_details",
      dedupe_key: `inspection_fix_details:${jobId}:${today}`,
      actor_contact_id: claim.contact_id ?? null,
      payload: { job_id: jobId, details, crew_notified: notified },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({ ok: true, job_id: jobId, crew_notified: notified });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
