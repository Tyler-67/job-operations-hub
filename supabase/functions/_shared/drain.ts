// Fires the notification drain immediately instead of waiting for its ~15-minute cron tick, so a
// user action's messages (an inspection request, a PASS/FAIL result, a fix list) go out right
// away. Best-effort: any failure is swallowed — the rows stay queued and the regular drain cron
// still sends them. The drain only sends DUE rows, so future-scheduled ones (e.g. the delayed
// customer review tag) are left to send on their own schedule.
//
// Runs in the BACKGROUND via EdgeRuntime.waitUntil when available, so the user's request (a crew
// check-in, an owner tap) returns immediately instead of waiting while the drain works through
// everything due — which can include other jobs' queued messages (worst case: the first check-in
// after the 15:00 link blast would otherwise sit on N Uptiq sends). Falls back to awaiting the
// drain where waitUntil doesn't exist (local/tests).
export async function triggerDrain(): Promise<void> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  const secret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  if (!base || !secret) return;
  const send = fetch(`${base}/functions/v1/cron-drain-notifications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: "{}",
  }).then(() => undefined).catch(() => {
    // Best-effort — the scheduled drain cron will still pick these up on its next tick.
  });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(send);
    return;
  }
  await send;
}
