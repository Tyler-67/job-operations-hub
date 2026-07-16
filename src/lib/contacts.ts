import { callEdge } from "@/lib/session";

// A row from the app `contacts` table (the messaging parties: customers, crew, owner, office,
// supply houses). Distinct from app_users (login identities). Read via contacts-sync GET.
export interface ContactRow {
  id: string;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  uptiq_contact_id: string | null;
  active: boolean;
  created_at: string;
}

export interface ContactsListResponse {
  contacts: ContactRow[];
  role_counts: Record<string, number>;
  total: number;
}

// GET the location's contacts (read-only). owner_admin / office_manager / support_admin.
export function fetchContacts() {
  return callEdge("contacts-sync") as unknown as Promise<ContactsListResponse>;
}

// Hard-delete a contact. Rejects with Error("has_history") if the contact is referenced by
// check-ins/expenses/messages (deactivate it instead). owner_admin / support_admin.
export function deleteContact(id: string) {
  return callEdge("contacts-sync", { body: { mode: "delete", contact_id: id } }) as unknown as Promise<{ ok: boolean; deleted: string }>;
}

// Toggle a contact active/inactive (soft remove). owner_admin / support_admin.
export function setContactActive(id: string, active: boolean) {
  return callEdge("contacts-sync", { body: { mode: "set_active", contact_id: id, active } }) as unknown as Promise<{ ok: boolean; contact_id: string; active: boolean }>;
}

export interface ConversationDeleteResult {
  mode: string;
  dry_run: boolean;
  contact: { id: string | null; name: string | null; uptiq_contact_id: string | null };
  conversations?: Array<{ id: string; message_count: number }>;
  results?: Array<{ id: string; deleted: boolean; status?: number; error?: string }>;
  total_conversations: number;
  total_messages: number;
  deleted?: number;
  backup_id?: string;
  capped?: boolean;
}

// The company messaging contacts (Settings owner/office ids) — where the app actually SENDS the
// owner/office texts. Selectable in the clear tool because they often have no app-contact row
// (or an app contact maps to a different Uptiq id entirely).
export const CONVERSATION_TARGETS = ["owner", "office"] as const;

// A thread discovered straight from Uptiq's conversation list — reaches threads whose contact
// the app doesn't know (e.g. a previous owner/office messaging contact after Settings changed).
export interface UptiqThread {
  conversation_id: string;
  uptiq_contact_id: string;
  name: string | null;
  last_message: string | null;
}

// DEBUG: list the location's recent Uptiq conversations. owner_admin / support_admin.
export function listUptiqThreads() {
  return callEdge("contacts-sync", { body: { mode: "list_conversations" } }) as unknown as Promise<{ threads: UptiqThread[]; total: number }>;
}

// DEBUG: back up + delete an Uptiq conversation (thread only, never the contact). Selector is an
// app contact id, "owner"/"office" for the company messaging contact from Settings, or
// "uptiq:<contactId>" for a thread discovered via listUptiqThreads.
// dryRun=true previews (search + message counts) without backing up or deleting.
// owner_admin / support_admin (contacts-sync POST gate).
export function deleteContactConversation(selector: string, dryRun: boolean, label?: string) {
  const body = selector.startsWith("uptiq:")
    ? { mode: "delete_conversation", uptiq_contact_id: selector.slice(6), label, dry_run: dryRun }
    : (CONVERSATION_TARGETS as readonly string[]).includes(selector)
      ? { mode: "delete_conversation", target: selector, dry_run: dryRun }
      : { mode: "delete_conversation", contact_id: selector, dry_run: dryRun };
  return callEdge("contacts-sync", { body }) as unknown as Promise<ConversationDeleteResult>;
}

export interface SendTestResult {
  channel: string;
  contact_id: string;
  provider_ok: boolean;
  provider_status: number;
  provider_error: string | null;
  provider_response: unknown;
}

// DEBUG: send ONE SMS/email immediately to a Uptiq contact id (bypasses the scheduled queue),
// returning the raw provider response. `uptiqContactId` is the Uptiq contact id (data on the
// contact row's uptiq_contact_id) — NOT the app contact row id. owner_admin / support_admin.
export function sendTest(params: { uptiqContactId: string; channel: "sms" | "email"; message?: string; subject?: string }) {
  return callEdge("send-test", {
    body: { contact_id: params.uptiqContactId, channel: params.channel, message: params.message, subject: params.subject },
  }) as unknown as Promise<SendTestResult>;
}

export function canViewContacts(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

// Delete/deactivate contacts (writes app records) — same gate as the crew pull / contacts-sync POST.
export function canManageContacts(role?: string | null) {
  return role === "owner_admin" || role === "support_admin";
}
