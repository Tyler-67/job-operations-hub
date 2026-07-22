/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /inbound-sms - Uptiq inbound-message webhook intake. Idempotent via dedupe_key.
// On the LOG keyword it replies (via the drain cron) with a single-use quick-log link
// bound to the texting crew member; other keywords are still logged as stubs for now.
import { json, preflight, serviceClient, logEvent } from "../_shared/util.ts";
import { appBaseUrlFor } from "../_shared/instances.ts";
import { mintActionToken, buildActionLink } from "../_shared/action-tokens.ts";
import { triggerDrain } from "../_shared/drain.ts";
import { parseInboundSms, isQuickLogKeyword, quickLogLinkDedupeKey } from "../_shared/quick-log.ts";

const QUICK_LOG_ACTION = "quick_log";
const QUICK_LOG_FORM_PATH = "/forms/quick-log";

function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}

// Resolves the texting contact: prefer the Uptiq contact id, fall back to a phone match.
async function resolveSender(sb: any, fromContactId: string | null, fromPhone: string | null) {
  if (fromContactId) {
    const { data } = await sb.from("contacts")
      .select("id, location_id, uptiq_contact_id, phone")
      .eq("uptiq_contact_id", fromContactId).eq("active", true).limit(1).maybeSingle();
    if (data) return data;
  }
  if (fromPhone) {
    // Match on the last 10 digits — contacts.phone is stored in varied formats.
    const { data } = await sb.from("contacts")
      .select("id, location_id, uptiq_contact_id, phone")
      .ilike("phone", `%${fromPhone}%`).eq("active", true).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

// Active jobs the contact is crew on, with the phase label for the form.
async function activeJobsForContact(sb: any, contactId: string, locationId: string) {
  const { data: crew } = await sb.from("job_crew").select("job_id").eq("contact_id", contactId);
  const jobIds = (crew ?? []).map((r: any) => r.job_id as string);
  if (!jobIds.length) return [];

  const { data: jobs } = await sb.from("jobs")
    .select("id, address, current_state_id")
    .eq("location_id", locationId).eq("active", true).in("id", jobIds);
  if (!jobs?.length) return [];

  const { data: states } = await sb.from("job_states").select("id, label");
  const labelById = new Map<string, string>();
  for (const s of states ?? []) labelById.set(s.id as string, (s.label as string) ?? "");

  return jobs.map((j: any) => ({
    id: j.id as string,
    address: (j.address as string | null) ?? null,
    state_label: labelById.get(j.current_state_id as string) ?? "",
  }));
}

// Enqueues an SMS reply for the drain cron to send to the crew member's Uptiq contact.
async function enqueueReply(sb: any, opts: {
  locationId: string;
  jobId: string | null;
  uptiqContactId: string;
  templateKey: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}) {
  const { error } = await sb.from("scheduled_notifications").insert({
    location_id: opts.locationId,
    job_id: opts.jobId,
    channel: "sms",
    recipient: opts.uptiqContactId,
    template_key: opts.templateKey,
    payload: opts.payload,
    scheduled_for: new Date().toISOString(),
    dedupe_key: opts.dedupeKey,
  });
  if (error && !isDuplicateKeyError(error)) throw error;
  // A crew's inbound text is a direct action — send the reply now, not on the drain cron's
  // next tick. Best-effort; the cron remains the retry backstop.
  await triggerDrain();
}

async function handleQuickLog(sb: any, parsed: ReturnType<typeof parseInboundSms>) {
  const sender = await resolveSender(sb, parsed.fromContactId, parsed.fromPhone);
  if (!sender) {
    await logEvent({ source: "webhook", kind: "inbound_sms.quick_log.unknown_sender",
      dedupe_key: `inbound_sms:${parsed.messageId}:unknown_sender`,
      payload: { contact_id: parsed.fromContactId, phone: parsed.fromPhone } });
    return;
  }

  const uptiqId = (sender.uptiq_contact_id ?? "").trim();
  if (!uptiqId) return; // can't reply without an Uptiq contact id

  const { data: location } = await sb.from("locations").select("company_name, app_base_url").eq("id", sender.location_id).maybeSingle();
  const companyName = (location?.company_name as string | null) ?? "";

  // Links open THIS tenant's app (two-instance era); null column = the env default.
  const appBaseUrl = appBaseUrlFor(location);
  if (!appBaseUrl) {
    await logEvent({ source: "webhook", kind: "inbound_sms.quick_log.misconfigured", payload: { reason: "APP_BASE_URL_unset" } });
    return;
  }

  const jobs = await activeJobsForContact(sb, sender.id, sender.location_id);
  if (!jobs.length) {
    await enqueueReply(sb, {
      locationId: sender.location_id,
      jobId: null,
      uptiqContactId: uptiqId,
      templateKey: "quick_log_no_job",
      payload: { company_name: companyName },
      dedupeKey: `notif:quick_log_no_job:${parsed.messageId}`,
    });
    return;
  }

  // Bind the token to the contact; bind the job too only when it's unambiguous. The
  // candidate jobs ride in the payload so the form can present a picker.
  const boundJobId = jobs.length === 1 ? jobs[0].id : null;
  const minted = await mintActionToken(sb, {
    action: QUICK_LOG_ACTION,
    jobId: boundJobId,
    contactId: sender.id,
    payload: { jobs, company_name: companyName },
  });
  const link = buildActionLink(appBaseUrl, QUICK_LOG_FORM_PATH, minted.token);

  await enqueueReply(sb, {
    locationId: sender.location_id,
    jobId: boundJobId,
    uptiqContactId: uptiqId,
    templateKey: "quick_log_link",
    payload: { link, company_name: companyName },
    dedupeKey: quickLogLinkDedupeKey(parsed.messageId),
  });
}

// Shared-secret guard (SEC-2): accepts a ?secret= query param or x-cron-secret header,
// checked against CRON_SECRET. Mirrors invoice-paid's guard. The platform verify_jwt layer
// still requires the anon key; this is the app-level auth for the Uptiq inbound webhook.
function webhookSecretGuard(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const got = req.headers.get("x-cron-secret") ?? urlSecret;
  if (!expected || got !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const guard = webhookSecretGuard(req);
  if (guard) return guard;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const parsed = parseInboundSms(body);
  const messageId = parsed.messageId || crypto.randomUUID();
  const dedupe = `inbound_sms:${messageId}`;

  const sb = serviceClient();
  // dedupe via unique constraint on event_log.dedupe_key
  const { error } = await sb.from("event_log").insert({
    source: "webhook", kind: "inbound_sms", dedupe_key: dedupe, payload: body, status: "received",
  });
  if (error && !String(error.message).includes("duplicate")) {
    return json({ error: error.message }, 500);
  }

  if (isQuickLogKeyword(parsed.keyword)) {
    try {
      await handleQuickLog(sb, { ...parsed, messageId });
    } catch (e) {
      // Never fail the webhook on a reply error — Uptiq would retry the whole message.
      await logEvent({ source: "webhook", kind: "inbound_sms.quick_log.error",
        payload: { error: e instanceof Error ? e.message : String(e), message_id: messageId } });
    }
  } else if (["PASS", "FAIL", "YES", "NO", "APPROVED"].includes(parsed.keyword)) {
    await logEvent({ source: "webhook", kind: `inbound_sms.${parsed.keyword.toLowerCase()}`,
      dedupe_key: `${dedupe}:parsed`, payload: { keyword: parsed.keyword, raw: parsed.text } });
  }
  return json({ ok: true });
});
