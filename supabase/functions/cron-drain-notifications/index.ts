// Every 15 minutes: dispatch any due rows in scheduled_notifications through Uptiq.
// Each sms/email row is addressed by the recipient Uptiq contact ID; the message is
// rendered from its template_key + payload. Transient failures stay 'pending' (retried
// next tick) until MAX_ATTEMPTS, then 'failed'. Non-contact channels (task/tag/webhook)
// are left for their own handlers.
import { json, preflight, requireCronSecret, serviceClient, logEvent } from "../_shared/util.ts";
import { uptiq } from "../_shared/uptiq.ts";
import { renderNotification } from "../_shared/notifications.ts";

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;

  const sb = serviceClient();
  const now = new Date().toISOString();
  const { data: due, error } = await sb.from("scheduled_notifications")
    .select("id, channel, recipient, template_key, payload, attempts")
    .eq("status", "pending").lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true }).limit(100);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of due ?? []) {
    const attempts = Number(row.attempts ?? 0) + 1;
    const recipient = typeof row.recipient === "string" ? row.recipient.trim() : "";

    // Only contact-addressable channels are dispatched here.
    if (row.channel !== "sms" && row.channel !== "email") {
      skipped++;
      continue;
    }
    if (!recipient) {
      await sb.from("scheduled_notifications").update({
        status: "failed", attempts, last_error: "missing_recipient",
      }).eq("id", row.id);
      failed++;
      continue;
    }

    let result: { ok: boolean; error?: string };
    try {
      const msg = renderNotification(row.template_key, (row.payload ?? {}) as Record<string, unknown>);
      result = row.channel === "sms"
        ? await uptiq.sendSms(recipient, msg.body)
        : await uptiq.sendEmail(recipient, msg.subject ?? "", msg.body);
    } catch (e) {
      result = { ok: false, error: String(e) };
    }

    if (result.ok) {
      await sb.from("scheduled_notifications").update({
        status: "sent", sent_at: new Date().toISOString(), attempts,
      }).eq("id", row.id);
      sent++;
    } else {
      const exhausted = attempts >= MAX_ATTEMPTS;
      await sb.from("scheduled_notifications").update({
        status: exhausted ? "failed" : "pending",
        attempts,
        last_error: (result.error ?? "send_failed").slice(0, 500),
      }).eq("id", row.id);
      failed++;
    }
  }

  await logEvent({ source: "cron", kind: "cron.drain_notifications.tick", payload: { sent, failed, skipped } });
  return json({ ok: true, sent, failed, skipped });
});
