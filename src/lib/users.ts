import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type AppUserRow = Database["public"]["Tables"]["app_users"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];

export interface UsersResponse {
  users: AppUserRow[];
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
  role: AppRole;
  active: boolean;
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

export function shortDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "-";
}
