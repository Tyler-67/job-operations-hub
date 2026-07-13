// Server-side only Uptiq (GoHighLevel / LeadConnector) API wrapper.
// Missing UPTIQ_API_TOKEN fails closed unless demo stubs are explicitly enabled.
// Different Uptiq endpoints require different API versions; isolate per method.
//
// TEMP PROVIDER / SINGLE SWAP POINT: this module is the ONLY place that talks to the A2P
// messaging + contacts provider (currently Uptiq/GHL). Contacts (upsert/find), SMS, and email
// all go through here, so migrating to a different A2P service later means reimplementing this
// one file against the new provider — callers (notifications, contacts-sync) stay unchanged.

const UPTIQ_BASE = "https://services.leadconnectorhq.com";

function token() {
  return Deno.env.get("UPTIQ_API_TOKEN");
}

function stubsEnabled() {
  return Deno.env.get("UPTIQ_ALLOW_STUBS")?.toLowerCase() === "true";
}

async function callUptiq(
  path: string,
  init: RequestInit & { version: string },
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const t = token();
  if (!t) {
    if (stubsEnabled()) {
      // Development/preview mode: no token configured, so return a typed stub.
      return { ok: true, status: 200, data: { stub: true, path, version: init.version } };
    }
    return { ok: false, status: 503, data: null, error: "missing_uptiq_api_token" };
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
  async getUsersByLocation(params: { locationId: string }) {
    const query = new URLSearchParams({ locationId: params.locationId });
    return callUptiq(`/users/?${query.toString()}`, {
      method: "GET",
      version: "2023-02-21",
    });
  },
  async searchUsers(params: { companyId: string; locationId?: string; query?: string; limit?: number }) {
    const query = new URLSearchParams({
      companyId: params.companyId,
      skip: "0",
      limit: String(params.limit ?? 10),
    });
    if (params.locationId) query.set("locationId", params.locationId);
    if (params.query) query.set("query", params.query);
    return callUptiq(`/users/search?${query.toString()}`, {
      method: "GET",
      version: "2023-02-21",
    });
  },
  // Find-or-create a contact in the location, deduped by email/phone. Returns the provider's
  // contact record (data.contact.id is the id to store + message against). Needs the token's
  // Contacts write scope.
  async upsertContact(params: { locationId: string; name?: string | null; email?: string | null; phone?: string | null; tags?: string[] }) {
    const body: Record<string, unknown> = { locationId: params.locationId };
    if (params.name) body.name = params.name;
    if (params.email) body.email = params.email;
    if (params.phone) body.phone = params.phone;
    if (params.tags?.length) body.tags = params.tags;
    return callUptiq(`/contacts/upsert`, {
      method: "POST",
      version: "2021-07-28",
      body: JSON.stringify(body),
    });
  },
  // Look up an existing contact by a free-text query (email or phone) within a location.
  async findContacts(params: { locationId: string; query: string; limit?: number }) {
    const query = new URLSearchParams({
      locationId: params.locationId,
      query: params.query,
      limit: String(params.limit ?? 5),
    });
    return callUptiq(`/contacts/?${query.toString()}`, {
      method: "GET",
      version: "2021-07-28",
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
