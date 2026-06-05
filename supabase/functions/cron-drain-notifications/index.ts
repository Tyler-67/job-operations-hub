// Every 15 minutes: send any due rows in scheduled_notifications.
// Phase 1: marks them sent without actually dispatching.
import { json, preflight, requireCronSecret, serviceClient, logEvent } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;

  const sb = serviceClient();
  const now = new Date().toISOString();
  const { data: due, error } = await sb.from("scheduled_notifications")
    .select("id, channel, recipient, template_key, payload")
    .eq("status", "pending").lte("scheduled_for", now).limit(100);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const row of due ?? []) {
    // Phase 2: dispatch via uptiq wrapper based on row.channel
    await sb.from("scheduled_notifications").update({
      status: "sent", sent_at: now, attempts: 1,
    }).eq("id", row.id);
    sent++;
  }
  await logEvent({ source: "cron", kind: "cron.drain_notifications.tick", payload: { sent } });
  return json({ ok: true, sent });
});
