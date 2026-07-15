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
  // READ-ONLY: page the location's contacts and return them all with their (lowercased) tags.
  // Uses the same /contacts/ read endpoint as findContacts (Contacts read scope only — no writes
  // to Uptiq). Caps pages to avoid runaway; reports `capped` if the cap was hit. This is the
  // primitive behind both the crew-tag pull and the full mirror (categorize by tag app-side).
  async listContacts(params: { locationId: string; pageLimit?: number; maxPages?: number }) {
    const pageLimit = Math.min(100, Math.max(1, params.pageLimit ?? 100));
    const maxPages = Math.max(1, params.maxPages ?? 10);
    const contacts: Array<{ id: string; name: string | null; email: string | null; phone: string | null; tags: string[] }> = [];
    let startAfter: string | null = null;
    let startAfterId: string | null = null;
    let pages = 0;
    let scanned = 0;
    while (pages < maxPages) {
      const q = new URLSearchParams({ locationId: params.locationId, limit: String(pageLimit) });
      if (startAfter) q.set("startAfter", startAfter);
      if (startAfterId) q.set("startAfterId", startAfterId);
      const res = await callUptiq(`/contacts/?${q.toString()}`, { method: "GET", version: "2021-07-28" });
      if (!res.ok) return { ok: false as const, status: res.status, error: res.error, data: res.data, contacts, scanned, pages, capped: false };
      const d = res.data as any;
      const page: any[] = Array.isArray(d?.contacts) ? d.contacts : [];
      scanned += page.length;
      for (const c of page) {
        const tags = Array.isArray(c?.tags) ? c.tags.map((t: any) => String(t).toLowerCase()) : [];
        const name = (c?.contactName || [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.name || "").trim();
        contacts.push({ id: String(c?.id ?? ""), name: name || null, email: c?.email ?? null, phone: c?.phone ?? null, tags });
      }
      pages++;
      if (page.length < pageLimit) break; // last page
      const meta = (d?.meta ?? {}) as any;
      startAfter = meta.startAfter ? String(meta.startAfter) : null;
      startAfterId = meta.startAfterId ? String(meta.startAfterId) : null;
      if (!startAfter && !startAfterId) break; // no cursor to page further
    }
    return { ok: true as const, status: 200, contacts, scanned, pages, capped: pages >= maxPages };
  },
  // READ-ONLY pull: the location's contacts whose tags include `tag` (case-insensitive).
  // Thin filter over listContacts, kept as its own method for the crew-tag pull's contract.
  async listContactsByTag(params: { locationId: string; tag: string; pageLimit?: number; maxPages?: number }) {
    const target = params.tag.trim().toLowerCase();
    const res = await uptiq.listContacts(params);
    if (!res.ok) return { ok: false, status: res.status, error: res.error, data: res.data, matched: [], scanned: res.scanned, pages: res.pages };
    const matched = res.contacts.filter((c) => c.tags.includes(target));
    return { ok: true, status: 200, matched, scanned: res.scanned, pages: res.pages, capped: res.capped };
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
  // Re-schedule an existing appointment (e.g. the inspection date moved) instead of creating a
  // duplicate. Same payload shape as create; the event id comes from the stored appointment id.
  async updateAppointment(eventId: string, payload: Record<string, unknown>) {
    return callUptiq(`/calendars/events/appointments/${eventId}`, {
      method: "PUT",
      version: "2021-07-28",
      body: JSON.stringify(payload),
    });
  },
  // Remove an appointment from the calendar (job archived, or cleaning up a test event).
  async deleteAppointment(eventId: string) {
    return callUptiq(`/calendars/events/appointments/${eventId}`, {
      method: "DELETE",
      version: "2021-07-28",
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
  // Conversations (debug/admin). Find a contact's conversation(s), read their messages (for
  // backup), and delete a conversation by id. Delete removes the THREAD only — never the contact.
  async searchConversations(params: { locationId: string; contactId: string; limit?: number }) {
    const query = new URLSearchParams({
      locationId: params.locationId,
      contactId: params.contactId,
      limit: String(params.limit ?? 20),
    });
    return callUptiq(`/conversations/search?${query.toString()}`, { method: "GET", version: "2021-07-28" });
  },
  async getConversationMessages(conversationId: string, params: { limit?: number; lastMessageId?: string } = {}) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
    if (params.lastMessageId) query.set("lastMessageId", params.lastMessageId);
    return callUptiq(`/conversations/${conversationId}/messages?${query.toString()}`, { method: "GET", version: "2021-07-28" });
  },
  async deleteConversation(conversationId: string) {
    return callUptiq(`/conversations/${conversationId}`, { method: "DELETE", version: "2021-07-28" });
  },
};
