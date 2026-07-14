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

export function canViewContacts(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}
