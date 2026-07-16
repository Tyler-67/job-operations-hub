// Fires the notification drain immediately instead of waiting for its ~15-minute cron tick, so a
// user-completed action's follow-up SMS/email (e.g. an inspection PASS/FAIL result) go out right
// away. Best-effort: any failure is swallowed — the rows stay queued and the regular drain cron
// still sends them. The drain only sends DUE rows, so future-scheduled ones (e.g. the delayed
// customer review tag) are left to send on their own schedule.
export async function triggerDrain(): Promise<void> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  const secret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  if (!base || !secret) return;
  try {
    await fetch(`${base}/functions/v1/cron-drain-notifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: "{}",
    });
  } catch {
    // Best-effort — the scheduled drain cron will still pick these up on its next tick.
  }
}
