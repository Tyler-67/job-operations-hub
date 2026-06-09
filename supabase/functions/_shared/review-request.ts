/* eslint-disable @typescript-eslint/no-explicit-any */
// When a job first enters a billing state (the final walkthrough was approved), the
// customer should be asked for a review — but not immediately. This schedules a delayed
// `tag`-channel notification to the customer's Uptiq contact: after review_request_delay_days
// the drain cron applies review_request_tag to that contact, which fires Uptiq's own
// review-request automation. Enqueued once per job (dedupe_key); a second billing-state
// entry (complete -> paid) is a no-op. The pure scheduling helpers are unit-testable under
// vitest; the I/O wrapper takes sb as a parameter rather than importing the Deno client.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Stable per-job key so a second billing-state entry can't enqueue a duplicate review tag.
export function reviewRequestDedupeKey(jobId: string): string {
  return `review_request:${jobId}`;
}

// When the tag should be applied: now + the configured delay (clamped to >= 0 days).
export function reviewRequestScheduledFor(now: Date, delayDays: unknown): string {
  const n = Number(delayDays);
  const days = Number.isFinite(n) && n > 0 ? n : 0;
  return new Date(now.getTime() + days * MS_PER_DAY).toISOString();
}

async function customerContactId(sb: any, jobId: string): Promise<string | null> {
  const { data } = await sb
    .from("job_customers")
    .select("contacts(uptiq_contact_id)")
    .eq("job_id", jobId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
}

// Schedules the delayed review-request tag IF the destination state is a billing state, the
// location has a review_request_tag configured, and the job's primary customer has an Uptiq
// contact. Returns true only when a fresh row was enqueued; no-ops (returns false) for
// non-billing states, when review requests are disabled (tag null/blank), when no customer
// contact is set, or when the job was already enqueued (duplicate dedupe_key swallowed).
export async function maybeEnqueueReviewRequest(
  sb: any,
  jobId: string,
  toStateId: string,
): Promise<boolean> {
  const { data: state, error: sErr } = await sb
    .from("job_states")
    .select("is_billing")
    .eq("id", toStateId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!state?.is_billing) return false;

  const { data: job, error: jErr } = await sb
    .from("jobs")
    .select("id, location_id, address")
    .eq("id", jobId)
    .maybeSingle();
  if (jErr) throw jErr;
  if (!job) return false;

  const { data: settings, error: cErr } = await sb
    .from("company_settings")
    .select("review_request_tag, review_request_delay_days")
    .eq("location_id", job.location_id)
    .maybeSingle();
  if (cErr) throw cErr;
  const tag = (settings?.review_request_tag ?? "").trim();
  if (!tag) return false; // review requests disabled for this location

  const recipient = await customerContactId(sb, jobId);
  if (!recipient) return false; // no customer contact to tag

  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: job.location_id,
    job_id: jobId,
    channel: "tag",
    recipient,
    template_key: "review_request_tag",
    payload: { tag, address: job.address ?? null },
    scheduled_for: reviewRequestScheduledFor(new Date(), settings?.review_request_delay_days),
    dedupe_key: reviewRequestDedupeKey(jobId),
  });
  if (error) {
    if (String(error.message ?? error).toLowerCase().includes("duplicate")) return false;
    throw error;
  }
  return true;
}
