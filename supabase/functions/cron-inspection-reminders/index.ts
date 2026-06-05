import { json, preflight, requireCronSecret, logEvent } from "../_shared/util.ts";
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;
  await logEvent({ source: "cron", kind: "cron.inspection_reminders.tick" });
  return json({ ok: true, enqueued: 0 });
});
