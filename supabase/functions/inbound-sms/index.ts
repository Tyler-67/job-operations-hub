// POST /inbound-sms  — Uptiq SMS webhook intake. Idempotent via dedupe_key.
// Phase 1: stores event, parses LOG/PASS/FAIL keyword stub. Full handlers in Phase 2.
import { json, preflight, serviceClient, logEvent } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const messageId = body?.messageId ?? body?.id ?? crypto.randomUUID();
  const dedupe = `inbound_sms:${messageId}`;

  const sb = serviceClient();
  // dedupe via unique constraint on event_log.dedupe_key
  const { error } = await sb.from("event_log").insert({
    source: "webhook", kind: "inbound_sms", dedupe_key: dedupe, payload: body, status: "received",
  });
  if (error && !String(error.message).includes("duplicate")) {
    return json({ error: error.message }, 500);
  }

  const text = String(body?.message ?? body?.body ?? "").trim().toUpperCase();
  const keyword = text.split(/\s+/)[0];
  if (["LOG", "PASS", "FAIL", "YES", "NO", "APPROVED"].includes(keyword)) {
    await logEvent({ source: "webhook", kind: `inbound_sms.${keyword.toLowerCase()}`,
      dedupe_key: `${dedupe}:parsed`, payload: { keyword, raw: text } });
  }
  return json({ ok: true });
});
