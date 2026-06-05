// Server-side only Uptiq API wrapper.
// Phase 1: every method is a stub. Real calls land in Phase 2.
// Different Uptiq endpoints require different API versions; isolate per method.

const UPTIQ_BASE = "https://services.leadconnectorhq.com";

function token() {
  return Deno.env.get("UPTIQ_API_TOKEN");
}

async function callUptiq(
  path: string,
  init: RequestInit & { version: string },
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const t = token();
  if (!t) {
    // Phase 1: no token configured. Return a typed stub.
    return { ok: true, status: 200, data: { stub: true, path, version: init.version } };
  }
  try {
    const res = await fetch(`${UPTIQ_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        Version: init.version,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

export const uptiq = {
  async usersByLocation(locationId: string) {
    return callUptiq(`/users/?locationId=${encodeURIComponent(locationId)}`, {
      method: "GET",
      version: "2023-02-21",
    });
  },
  async sendSms(contactId: string, message: string) {
    return callUptiq(`/conversations/messages`, {
      method: "POST",
      version: "2021-07-28",
      body: JSON.stringify({ type: "SMS", contactId, message }),
    });
  },
  async sendEmail(contactId: string, subject: string, html: string) {
    return callUptiq(`/conversations/messages`, {
      method: "POST",
      version: "2021-07-28",
      body: JSON.stringify({ type: "Email", contactId, subject, html }),
    });
  },
  async createAppointment(payload: Record<string, unknown>) {
    return callUptiq(`/calendars/events/appointments`, {
      method: "POST",
      version: "2021-07-28",
      body: JSON.stringify(payload),
    });
  },
  async applyTag(contactId: string, tag: string) {
    return callUptiq(`/contacts/${contactId}/tags`, {
      method: "POST",
      version: "2021-07-28",
      body: JSON.stringify({ tags: [tag] }),
    });
  },
  async removeTag(contactId: string, tag: string) {
    return callUptiq(`/contacts/${contactId}/tags`, {
      method: "DELETE",
      version: "2021-07-28",
      body: JSON.stringify({ tags: [tag] }),
    });
  },
};
