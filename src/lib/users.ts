import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type AppUserRow = Database["public"]["Tables"]["app_users"]["Row"];
// NOTE: generated types.ts is stale (no dev_super yet) — declare the enum locally.
export type AppRole = "dev_super" | "owner_admin" | "office_manager" | "crew" | "viewer" | "support_admin";

export interface UserEmail {
  id: string;
  email: string;
}

// app_users row plus its SECONDARY login emails (aliases). The primary is app_users.email.
// uptiq_contact_id is declared here too because the generated types.ts is stale (column added
// in migration 20260714120000).
export type AppUserWithEmails = Omit<AppUserRow, "role"> & { role: AppRole; emails?: UserEmail[]; uptiq_contact_id?: string | null; debug_tools?: string[] };

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
  // Debugger grants (tool slugs) — only sent (and only accepted server-side) when the actor
  // is dev_super. Slugs mirror supabase/functions/_shared/debug-access.ts DEBUG_TOOLS.
  debug_tools?: string[];
}

// The individual debug tools a dev_super can grant, with the Settings panel each unlocks.
export const DEBUG_TOOL_OPTIONS = [
  { key: "run_crons", label: "Run crons (testing sender)" },
  { key: "contacts_sync", label: "Uptiq contacts sync + pull" },
  { key: "send_test", label: "Send a test message" },
  { key: "conversations", label: "Conversations (backup + clear)" },
  { key: "jobs_clear", label: "Jobs (hard delete)" },
  { key: "data_reset", label: "Data reset (clear categories)" },
] as const;
export type DebugToolKey = (typeof DEBUG_TOOL_OPTIONS)[number]["key"];

// Generate a readable, reasonably strong temporary password for admin-issued credentials.
export function generatePassword() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Burn-${hex}!`;
}

export const APP_ROLES: AppRole[] = ["dev_super", "owner_admin", "office_manager", "crew", "viewer", "support_admin"];

// Display names: owner_admin reads as plain "owner"; dev_super is the dev-side super user.
const ROLE_LABELS: Record<string, string> = {
  owner_admin: "owner",
  dev_super: "dev super user",
};

export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

export function canViewUsers(role?: string | null) {
  return role === "dev_super" || role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function canManageUsers(role?: string | null) {
  return role === "dev_super" || role === "owner_admin" || role === "support_admin";
}

// Role hierarchy: dev_super > support_admin > owner_admin. You can only assign roles at or
// below your own tier (mirrors the server's canManageRole).
export function assignableRoles(actorRole?: string | null) {
  return APP_ROLES.filter((role) => {
    if (role === "dev_super") return actorRole === "dev_super";
    if (role === "support_admin") return actorRole === "dev_super" || actorRole === "support_admin";
    return true;
  });
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
