// POST /action-token-consume  { token, action }
// Validates a tap-link token, atomically marks it used, returns its payload.
import { json, preflight, serviceClient, sha256Hex, logEvent } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token, action } = await req.json().catch(() => ({}));
  if (!token || !action) return json({ error: "missing_params" }, 400);

  const secret = Deno.env.get("ACTION_TOKEN_SECRET") ?? "dev-action-secret-change-me";
  const hash = await sha256Hex(`${token}.${secret}`);

  const sb = serviceClient();
  // Atomic single-use: only mark+select if unused and not expired.
  const { data, error } = await sb.from("action_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hash).is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("action, payload, job_id, contact_id").maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "invalid_or_expired" }, 410);
  if (data.action !== action) return json({ error: "action_mismatch" }, 400);

  await logEvent({ source: "action", kind: `action.${action}`, payload: data.payload });
  return json({ ok: true, payload: data.payload, job_id: data.job_id, contact_id: data.contact_id });
});
