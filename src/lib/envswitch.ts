// Dev tool: bounce the app between the DEV and STABLE (prod) Vercel deployments while staying
// inside the Uptiq iframe, and keep the non-production build dev_super-only.
//
// The two builds live on separate origins, so they don't share a localStorage session. We hand
// off by forwarding the Uptiq bootstrap params in the URL, exactly like Uptiq's own iframe load —
// the target origin then re-mints its own session via session.tsx DOOR 1, which also stashes those
// params under BOOT_KEY (before it strips them from the URL) so this helper can forward them again.

const DEV_HOST = "job-operations-hub-dev.vercel.app";
const PROD_HOST = "job-operations-hub.vercel.app";
const BOOT_KEY = "uptiq.iframe_boot";

export type AppEnv = "dev" | "stable" | "other";

export function currentEnv(): AppEnv {
  const h = window.location.hostname;
  if (h === DEV_HOST) return "dev";
  if (h === PROD_HOST) return "stable";
  return "other"; // localhost, preview deploys, etc.
}

export function currentEnvLabel(): string {
  const e = currentEnv();
  return e === "dev" ? "Dev" : e === "stable" ? "Stable (prod)" : "Local / preview";
}

export function otherEnvLabel(): string {
  // From anywhere that isn't dev, the other side is dev; from dev it's stable.
  return currentEnv() === "dev" ? "Stable (prod)" : "Dev";
}

// The dev (non-production) deployment is a dev_super-only sandbox. Any other role that reaches it
// — a direct link, or a tenant whose Uptiq menu link points at dev — must be blocked from the
// authenticated app. Keyed off the known dev host only, so it's a no-op on prod (stable) and never
// trips up localhost/preview development.
export function devBuildBlocked(role: string | undefined): boolean {
  return currentEnv() === "dev" && role !== "dev_super";
}

// The URL to bounce to: the other origin's root, carrying the stashed Uptiq bootstrap params so the
// target re-mints a session inside the iframe. Falls back to a bare root (standalone /login or the
// Supabase bridge) when there are no iframe params (e.g. opened outside Uptiq).
export function switchEnvUrl(): string {
  const target = currentEnv() === "dev" ? PROD_HOST : DEV_HOST;
  const origin = `https://${target}`;
  let boot: { location_id?: string; user_email?: string; user_name?: string; phone?: string } | null = null;
  try { boot = JSON.parse(sessionStorage.getItem(BOOT_KEY) || "null"); } catch { /* sessionStorage unavailable */ }
  if (boot?.location_id && boot.user_email) {
    const p = new URLSearchParams();
    p.set("location_id", boot.location_id);
    p.set("user_email", boot.user_email);
    if (boot.user_name) p.set("user_name", boot.user_name);
    if (boot.phone) p.set("phone", boot.phone);
    return `${origin}/?${p.toString()}`;
  }
  return `${origin}/`;
}

export function switchEnv(): void {
  window.location.href = switchEnvUrl();
}
