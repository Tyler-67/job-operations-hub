/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin test-send: fire ONE SMS or email to a Uptiq contact id immediately (bypassing the
// scheduled_notifications queue) and return the RAW provider response. For walkthrough demos
// and for diagnosing whether sends actually reach Uptiq. Admin-gated.
import { json, preflight, verifySession, logEvent, serviceClient } from "../_shared/util.ts";
import { uptiq } from "../_shared/uptiq.ts";
import { canUseDebugTool } from "../_shared/debug-access.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  // Test sends are a DEBUG tool gated on the per-user "send_test" grant.
  if (!(await canUseDebugTool(serviceClient(), claims, "send_test"))) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const contactId = typeof body.contact_id === "string" ? body.contact_id.trim() : "";
  const channel = body.channel === "email" ? "email" : "sms";
  if (!contactId) return json({ error: "contact_id_required" }, 400);

  const res = channel === "email"
    ? await uptiq.sendEmail(
        contactId,
        typeof body.subject === "string" && body.subject.trim() ? body.subject : "Daily Burn test email",
        typeof body.html === "string" && body.html.trim() ? body.html : "<p>Daily Burn test email.</p>",
      )
    : await uptiq.sendSms(
        contactId,
        typeof body.message === "string" && body.message.trim() ? body.message : "Daily Burn test message.",
      );

  await logEvent({
    source: "admin", kind: "send_test", location_id: String(claims.loc ?? ""),
    status: res.ok ? "ok" : "error",
    payload: { channel, contact_id: contactId, status: res.status, by: claims.email },
    error: res.ok ? undefined : res.error,
  });

  return json({
    channel, contact_id: contactId,
    provider_ok: res.ok, provider_status: res.status, provider_error: res.error ?? null,
    provider_response: res.data,
  });
});
