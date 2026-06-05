// Enqueues daily check-in messages per company config. Phase 1 stub.
import { json, preflight, requireCronSecret, logEvent } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;
  await logEvent({ source: "cron", kind: "cron.check_ins.tick", payload: { ts: new Date().toISOString() } });
  return json({ ok: true, enqueued: 0 });
});
