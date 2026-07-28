// Single source of truth for the role vocabulary + the two authorization tiers.
// MANAGER = day-to-day ops (owner/office/support/dev_super); ADMIN = the stricter tier that
// excludes office_manager (user + contact administration). Mirror of src/lib/roles.ts on the FE.
export const APP_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "crew", "viewer", "support_admin"]);

const MANAGER_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);
const ADMIN_ROLES = new Set(["dev_super", "owner_admin", "support_admin"]);

export const isManager = (role: unknown): boolean => MANAGER_ROLES.has(String(role ?? ""));
export const isAdmin = (role: unknown): boolean => ADMIN_ROLES.has(String(role ?? ""));
