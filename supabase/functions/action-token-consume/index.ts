// POST /action-token-consume  { token, action, consume? }
// Validates a token and optionally marks it used. Tap links consume immediately;
// form pages validate on load and should consume only on successful submit.
import { json, preflight, serviceClient, logEvent } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token, action, consume = true } = await req.json().catch(() => ({}));
  if (!token || !action) return json({ error: "missing_params" }, 400);

  const hash = await hashActionToken(token, resolveActionSecret());
  const now = new Date().toISOString();

  const sb = serviceClient();
  const query = consume
    ? sb.from("action_tokens")
      .update({ used_at: now })
      .eq("token_hash", hash)
      .eq("action", action)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("action, payload, job_id, contact_id")
      .maybeSingle()
    : sb.from("action_tokens")
      .select("action, payload, job_id, contact_id")
      .eq("token_hash", hash)
      .eq("action", action)
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle();

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "invalid_or_expired" }, 410);

  if (consume) await logEvent({ source: "action", kind: `action.${action}`, payload: data.payload });
  return json({ ok: true, consumed: Boolean(consume), payload: data.payload, job_id: data.job_id, contact_id: data.contact_id });
});
