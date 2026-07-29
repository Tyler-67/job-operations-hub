/* eslint-disable @typescript-eslint/no-explicit-any */
// Who may use which DEBUG tool. dev_super and support_admin hold every tool; a plain Owner
// (owner_admin) holds exactly the tools a dev_super granted in app_users.debug_tools. Checked
// fresh from the DB per request so a grant/revoke applies immediately, without waiting for the
// user's session to be re-minted. Kept OUT of util.ts so only the debug-gated functions bundle
// (and redeploy for) it. Slugs are kept in lockstep with the FE list (src/lib/users.ts
// DEBUG_TOOL_OPTIONS) and the migration default.
export const DEBUG_TOOLS = [
  "run_crons",      // Settings: testing cron runner (run_cron / run_crons)
  "contacts_sync",  // Settings: Uptiq contacts pull + link panels
  "send_test",      // Settings: send a test message (send-test fn)
  "conversations",  // Settings: conversation list/backup/clear (contacts-sync debug modes)
  "jobs_clear",     // Settings: hard-delete jobs (jobs delete_job)
  "data_reset",     // Settings: clear data categories (settings clear_data)
  "message_log",    // Settings: sent-message log + message-format editor (settings message_log / message_templates)
  "forms_preview",  // Settings: forms directory + open a token-minted test copy (settings form_test_token)
] as const;
export type DebugTool = (typeof DEBUG_TOOLS)[number];

export function isDebugTool(value: unknown): value is DebugTool {
  return typeof value === "string" && (DEBUG_TOOLS as readonly string[]).includes(value);
}

export async function canUseDebugTool(
  sb: any,
  claims: { sub?: unknown; role?: unknown },
  tool: DebugTool,
): Promise<boolean> {
  const role = String(claims?.role ?? "");
  if (role === "dev_super" || role === "support_admin") return true;
  if (role !== "owner_admin") return false;
  const { data } = await sb
    .from("app_users")
    .select("debug_tools")
    .eq("id", String(claims?.sub ?? ""))
    .maybeSingle();
  return Array.isArray(data?.debug_tools) && data.debug_tools.includes(tool);
}

// The per-company debug_mode toggle is an OWNER's switch to reveal the debug tools on THEIR tenant
// (defense in depth beyond the debug-gated UI). A dev_super is an app-wide superuser who can use
// the tools on any instance — they reveal them locally via the Settings checkbox — so they are
// never blocked by a tenant's persisted debug_mode. Returns true when the action must be refused.
export function debugModeBlocked(debugMode: unknown, role: unknown): boolean {
  return !debugMode && String(role ?? "") !== "dev_super";
}
