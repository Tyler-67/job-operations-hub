/* eslint-disable @typescript-eslint/no-explicit-any */
// Resolves a decision's abstract follow-up audiences to concrete Uptiq recipients
// and enqueues them into scheduled_notifications. Split out of action-decision so the
// recipient routing + dedupe behaviour is integration-testable with a mock sb client
// (the handler itself only wires this to the consumed token). Takes sb as a parameter
// rather than importing the Deno client, so it runs under vitest.

import { followupDedupeKey, type DecisionSpec, type FollowupAudience } from "./decisions.ts";
import { buildActionLink, mintActionToken } from "./action-tokens.ts";

export interface EnqueueFollowupsOptions {
  // Required only for link-bearing follow-ups; without it those are skipped (can't build a URL).
  appBaseUrl?: string;
  // Per-tap discriminator (the consumed token id) appended to the follow-up dedupe key.
  // Lets a re-askable decision (walkthrough_still_issues/_reschedule) enqueue a distinct
  // follow-up each cycle; absent for callers that want the legacy per-(action,job,audience) key.
  cycleKey?: string;
}

export interface DecisionJob {
  id: string;
  location_id: string;
  address: string | null;
  current_state_id: string | null;
}

// crew_lead/customer come off the job; owner/office are the text contact ids stored
// directly on company_settings (already Uptiq ids, mirroring scheduled_notifications.recipient).
// Returns null when no contact is configured for the audience, so the caller skips it.
export async function resolveRecipient(
  sb: any,
  audience: FollowupAudience,
  job: DecisionJob,
): Promise<string | null> {
  if (audience === "crew_lead") {
    const { data } = await sb.from("job_crew")
      .select("contacts(uptiq_contact_id)").eq("job_id", job.id).eq("is_lead", true).limit(1).maybeSingle();
    return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
  }
  if (audience === "customer") {
    const { data } = await sb.from("job_customers")
      .select("contacts(uptiq_contact_id)").eq("job_id", job.id).eq("is_primary", true).limit(1).maybeSingle();
    return (data?.contacts?.uptiq_contact_id ?? "").trim() || null;
  }
  const { data: cs } = await sb.from("company_settings")
    .select("owner_contact_id, office_contact_id").eq("location_id", job.location_id).maybeSingle();
  const id = audience === "owner" ? cs?.owner_contact_id : cs?.office_contact_id;
  return (id ?? "").trim() || null;
}

// Enqueues every follow-up whose audience resolves to a recipient. A duplicate
// dedupe_key (a replayed tap) is swallowed silently; any other insert error throws.
export async function enqueueFollowups(
  sb: any,
  decision: DecisionSpec,
  job: DecisionJob,
  opts: EnqueueFollowupsOptions = {},
): Promise<number> {
  let enqueued = 0;
  for (const f of decision.followups) {
    const recipient = await resolveRecipient(sb, f.audience, job);
    if (!recipient) continue; // no contact configured for this audience — skip silently

    const payload: Record<string, unknown> = {
      address: job.address ?? null, action: decision.action, audience: f.audience,
    };
    if (f.link) {
      if (!opts.appBaseUrl) continue; // can't build a link without the app base URL — skip
      const minted = await mintActionToken(sb, {
        action: f.link.action, jobId: job.id, contactId: null,
        payload: { address: job.address ?? null },
      });
      payload.link = buildActionLink(opts.appBaseUrl, f.link.path, minted.token);
    }

    const { error } = await sb.from("scheduled_notifications").insert({
      location_id: job.location_id,
      job_id: job.id,
      channel: f.channel,
      recipient,
      template_key: f.template_key,
      payload,
      scheduled_for: new Date().toISOString(),
      dedupe_key: followupDedupeKey(decision.action, job.id, f.audience) + (opts.cycleKey ? `:${opts.cycleKey}` : ""),
    });
    if (error) {
      if (String(error.message ?? error).toLowerCase().includes("duplicate")) continue;
      throw error;
    }
    enqueued++;
  }
  return enqueued;
}
