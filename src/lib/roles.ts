import type { Database } from "@/integrations/supabase/types";

// Single source of truth for the app's role vocabulary + the two authorization tiers.
// MANAGER = day-to-day ops (owner/office/support/dev_super); ADMIN = the stricter tier that
// excludes office_manager (user + contact administration). Mirror of _shared/roles.ts on the backend.
export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES: AppRole[] = ["dev_super", "owner_admin", "office_manager", "crew", "viewer", "support_admin"];

const MANAGER_ROLES = new Set<string>(["dev_super", "owner_admin", "office_manager", "support_admin"]);
const ADMIN_ROLES = new Set<string>(["dev_super", "owner_admin", "support_admin"]);

export const isManager = (role?: string | null): boolean => MANAGER_ROLES.has(role ?? "");
export const isAdmin = (role?: string | null): boolean => ADMIN_ROLES.has(role ?? "");
export const isDevSuper = (role?: string | null): boolean => role === "dev_super";
