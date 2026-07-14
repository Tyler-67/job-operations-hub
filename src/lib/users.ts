import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type AppUserRow = Database["public"]["Tables"]["app_users"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];

export interface UserEmail {
  id: string;
  email: string;
}

// app_users row plus its SECONDARY login emails (aliases). The primary is app_users.email.
// uptiq_contact_id is declared here too because the generated types.ts is stale (column added
// in migration 20260714120000).
export type AppUserWithEmails = AppUserRow & { emails?: UserEmail[]; uptiq_contact_id?: string | null };

export interface UsersResponse {
  users: AppUserWithEmails[];
  metrics: {
    total_user_count: number;
    active_user_count: number;
    inactive_user_count: number;
    owner_admin_count: number;
    office_manager_count: number;
    role_counts: Record<string, number>;
  };
}

export interface SaveUserPayload {
  id?: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  uptiq_contact_id?: string | null;
  role: AppRole;
  active: boolean;
  password?: string | null;
}

// Generate a readable, reasonably strong temporary password for admin-issued credentials.
export function generatePassword() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Burn-${hex}!`;
}

export const APP_ROLES: AppRole[] = ["owner_admin", "office_manager", "crew", "viewer", "support_admin"];

export function roleLabel(role: string) {
  return role.replace(/_/g, " ");
}

export function canViewUsers(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function canManageUsers(role?: string | null) {
  return role === "owner_admin" || role === "support_admin";
}

export function assignableRoles(actorRole?: string | null) {
  return APP_ROLES.filter((role) => actorRole === "support_admin" || role !== "support_admin");
}

export function fetchUsers() {
  return callEdge("users") as Promise<UsersResponse>;
}

export function createUser(payload: SaveUserPayload) {
  return callEdge("users", { method: "POST", body: payload }) as Promise<UsersResponse>;
}

export function updateUser(payload: SaveUserPayload) {
  return callEdge("users", { method: "PATCH", body: payload }) as Promise<UsersResponse>;
}

export function addUserEmail(userId: string, email: string) {
  return callEdge("users", { method: "POST", body: { action: "add_email", user_id: userId, email } }) as Promise<UsersResponse>;
}

export function removeUserEmail(emailId: string) {
  return callEdge("users", { method: "POST", body: { action: "remove_email", email_id: emailId } }) as Promise<UsersResponse>;
}

export function setUserPassword(userId: string, password: string) {
  return callEdge("users", { method: "POST", body: { action: "set_password", id: userId, password } }) as Promise<UsersResponse>;
}

export function shortDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "-";
}
