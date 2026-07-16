/* eslint-disable @typescript-eslint/no-explicit-any */
// Who may use the DEBUG tools (Settings testing panels, job/data/conversation clears, test
// sends). dev_super and support_admin always can; a plain Owner (owner_admin) only when a
// dev_super has granted app_users.debug_access. Checked fresh from the DB per request so a
// grant/revoke applies immediately, without waiting for the user's session to be re-minted.
// Kept OUT of util.ts so only the debug-gated functions bundle (and redeploy for) it.
export async function canUseDebugTools(sb: any, claims: { sub?: unknown; role?: unknown }): Promise<boolean> {
  const role = String(claims?.role ?? "");
  if (role === "dev_super" || role === "support_admin") return true;
  if (role !== "owner_admin") return false;
  const { data } = await sb
    .from("app_users")
    .select("debug_access")
    .eq("id", String(claims?.sub ?? ""))
    .maybeSingle();
  return data?.debug_access === true;
}
