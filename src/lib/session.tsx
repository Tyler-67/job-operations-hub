import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "dev_super" | "owner_admin" | "office_manager" | "crew" | "viewer" | "support_admin";
export interface AppUser { id: string; email: string; name?: string | null; role: AppRole; location_id: string; debug_access?: boolean; }
export interface AppLocation { id: string; company_name: string; timezone?: string }

interface SessionCtx {
  loading: boolean;
  user: AppUser | null;
  location: AppLocation | null;
  error: string | null;
  needsLogin: boolean;
  signOut: () => void;
}

// Demo bootstrap is DEV-ONLY. In a production build (import.meta.env.DEV === false) with the
// flag unset, no-session visits go to the standalone /login door instead of silently becoming
// owner_admin. The server-side iframe-session demo branch is separately gated behind
// ALLOW_DEMO_SESSION, so this flag alone can't grant access.
const DEMO_ALLOWED = import.meta.env.VITE_ALLOW_DEMO_SESSION === "true" || import.meta.env.DEV;

// Bridge errors that mean "authenticated with Supabase but not authorized for this app" —
// route to /login rather than surfacing a hard error or looping.
const AUTH_REJECTIONS = new Set([
  "not_provisioned", "inactive_user", "ambiguous_account", "email_unverified", "invalid_token",
]);

function signOut() {
  localStorage.removeItem(STORAGE_KEY);
  // Clear the standalone Supabase Auth session too — otherwise the next bootstrap re-bridges
  // it (Door 3) and silently signs the user back in.
  void supabase.auth.signOut().finally(() => window.location.assign("/login"));
}

const Ctx = createContext<SessionCtx>({ loading: true, user: null, location: null, error: null, needsLogin: false, signOut });
const STORAGE_KEY = "uptiq.session";
interface EdgeResponse { error?: string; session?: string; user?: AppUser; location?: AppLocation }

function saveSessionToken(token: string | undefined) {
  if (!token) throw new Error("missing_session");
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: token }));
  return token;
}

async function issueDemoSession() {
  const out = await callEdge("iframe-session", {
    body: {
      location_id: "DEMO_LOCATION",
      user_email: "dev-admin@uptiq.local",
      user_name: "Dev Admin",
    },
  });
  return saveSessionToken(out.session);
}

async function callEdge(name: string, opts: { body?: unknown; query?: Record<string, string | number | boolean | null | undefined>; session?: string | null; method?: "GET" | "POST" | "PATCH" } = {}) {
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`);
  Object.entries(opts.query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      ...(opts.session || getSessionToken() ? { "x-app-session": opts.session ?? getSessionToken() ?? "" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({})) as EdgeResponse;
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export function getSessionToken(): string | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")?.session ?? null; }
  catch { return null; }
}

// Bridge a live Supabase Auth session into an app x-app-session. Returns the me() payload,
// or null if the Supabase user is authenticated but not authorized for the app (in which
// case the Supabase session is cleared so we don't loop).
async function bridgeSupabaseSession(): Promise<EdgeResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const out = await callEdge("auth-session", { body: { access_token: session.access_token } });
    const token = saveSessionToken(out.session);
    return await callEdge("me", { session: token });
  } catch (e) {
    if (e instanceof Error && AUTH_REJECTIONS.has(e.message)) {
      await supabase.auth.signOut();
      return null;
    }
    throw e;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionCtx>({ loading: true, user: null, location: null, error: null, needsLogin: false, signOut });

  useEffect(() => {
    let active = true;
    const finish = (patch: Partial<SessionCtx>) => { if (active) setState((s) => ({ ...s, ...patch })); };
    const success = (me: EdgeResponse) =>
      finish({ loading: false, user: me.user ?? null, location: me.location ?? null, error: null, needsLogin: false });

    (async () => {
      try {
        // The standalone auth routes own their own bridging (Login/AuthCallback). Keep the
        // provider inert on them so it never bridges a recovery/partial Supabase session
        // before the password is set, and never double-bridges on /auth/callback.
        const path = window.location.pathname;
        if (path === "/login" || path.startsWith("/auth/")) {
          return finish({ loading: false, needsLogin: false });
        }

        const url = new URL(window.location.href);
        const params = url.searchParams;
        const fromIframe = params.get("location_id") && params.get("user_email");

        let token = getSessionToken();

        // DOOR 1 — Uptiq iframe (unchanged).
        if (fromIframe) {
          const out = await callEdge("iframe-session", {
            body: {
              location_id: params.get("location_id"),
              user_email: params.get("user_email"),
              user_name: params.get("user_name") || undefined,
              phone: params.get("phone") || undefined,
            },
          });
          token = saveSessionToken(out.session);
          // clean iframe params from URL
          ["location_id", "user_email", "user_name", "phone"].forEach((k) => params.delete(k));
          const cleanUrl = url.pathname + (params.toString() ? `?${params}` : "") + url.hash;
          window.history.replaceState({}, "", cleanUrl);
        }

        // DOOR 2 — existing x-app-session.
        if (token) {
          try {
            return success(await callEdge("me", { session: token }));
          } catch (e) {
            // Clear the stale token on a revoked (unauthorized) OR deactivated (inactive)
            // session and fall through to the standalone / demo doors instead of dead-ending
            // on an error screen.
            if (!(e instanceof Error) || !["unauthorized", "inactive"].includes(e.message) || fromIframe) throw e;
            localStorage.removeItem(STORAGE_KEY);
            token = null;
          }
        }

        // DOOR 3 — a live Supabase Auth session (standalone door already signed in) → bridge.
        const bridged = await bridgeSupabaseSession();
        if (bridged) return success(bridged);

        // DOOR 4 — nobody. Demo is dev-only; otherwise send to the standalone login door.
        if (DEMO_ALLOWED) {
          const demoToken = await issueDemoSession();
          return success(await callEdge("me", { session: demoToken }));
        }
        return finish({ loading: false, user: null, location: null, error: null, needsLogin: true });
      } catch (e: unknown) {
        finish({ loading: false, error: e instanceof Error ? e.message : "Session error", needsLogin: false });
      }
    })();
    return () => { active = false; };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSession() { return useContext(Ctx); }
export { callEdge, saveSessionToken };
// keep supabase available for direct queries
export { supabase };
