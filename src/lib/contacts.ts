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

export function canViewContacts(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

// Delete/deactivate contacts (writes app records) — same gate as the crew pull / contacts-sync POST.
export function canManageContacts(role?: string | null) {
  return role === "owner_admin" || role === "support_admin";
}
