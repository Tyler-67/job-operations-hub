/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /forms-quick-log  { token, job_id?, hours_worked?, state_progress_pct?, note? }
//
// The lightweight SMS quick-log form submits here. The action token (minted by inbound-sms
// on the LOG keyword, action "quick_log") binds the submission to the texting crew contact.
// The token is single-use and consumed FIRST: a replayed submit returns 410. The crew
// member's chosen job_id is re-validated against their active crew membership server-side,
// so the token payload's job list can never be used to log against someone else's job.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { normalizeQuickLogInput, buildQuickLogLogFields } from "../_shared/quick-log.ts";

const QUICK_LOG_ACTION = "quick_log";

function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}

// Atomically claims the token while it is still unused and unexpired.
async function consumeToken(sb: any, token: string) {
  const hash = await hashActionToken(token, resolveActionSecret());
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("action_tokens")
    .update({ used_at: now })
    .eq("token_hash", hash)
    .eq("action", QUICK_LOG_ACTION)
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
    if (!claim.contact_id) return json({ error: "token_not_bound" }, 422);
    const crewContactId = claim.contact_id as string;

    const input = normalizeQuickLogInput(body);
    // Effective job: the form's chosen job, falling back to a token-bound single job.
    const jobId = input.jobId ?? (claim.job_id as string | null);
    if (!jobId) return json({ error: "job_required" }, 422);

    // Re-validate: the contact must actually be crew on this job, and the job active.
    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, location_id, current_state_id, address, active")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job || job.active !== true) return json({ error: "job_not_found" }, 404);

    const { data: membership, error: memErr } = await sb
      .from("job_crew")
      .select("job_id")
      .eq("job_id", jobId)
      .eq("contact_id", crewContactId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return json({ error: "not_crew_on_job" }, 403);

    // 1. Upsert the daily log (UNIQUE(log_date, job_id, crew_contact_id) keeps it idempotent).
    const { data: log, error: logErr } = await sb
      .from("daily_logs")
      .upsert({
        ...buildQuickLogLogFields(input),
        job_id: jobId,
        crew_contact_id: crewContactId,
        state_id: job.current_state_id,
      }, { onConflict: "log_date,job_id,crew_contact_id" })
      .select("id")
      .single();
    if (logErr) throw logErr;
    const dailyLogId = log.id as string;

    // 2. Roll authoritative total hours onto the job (recomputed from the sum, so replays
    //    never double-count) and apply this log's progress when provided.
    const { data: logs, error: logsErr } = await sb.from("daily_logs").select("hours_worked").eq("job_id", jobId);
    if (logsErr) throw logsErr;
    const totalHours = (logs ?? []).reduce((sum: number, r: any) => sum + Number(r.hours_worked ?? 0), 0);
    const jobPatch: Record<string, unknown> = { total_hours: totalHours };
    if (input.stateProgressPct !== null) jobPatch.state_progress_pct = input.stateProgressPct;
    const { error: jobPatchErr } = await sb.from("jobs").update(jobPatch).eq("id", jobId);
    if (jobPatchErr) throw jobPatchErr;

    // 3. Idempotent audit entry.
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.quick_log",
      dedupe_key: `quick_log:${jobId}:${crewContactId}:${input.logDate}`,
      actor_contact_id: crewContactId,
      payload: {
        job_id: jobId,
        daily_log_id: dailyLogId,
        log_date: input.logDate,
        hours_worked: input.hoursWorked,
        state_progress_pct: input.stateProgressPct,
      },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({ ok: true, job_id: jobId, daily_log_id: dailyLogId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
