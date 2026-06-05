import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner_admin" | "office_manager" | "crew" | "viewer" | "support_admin";
export interface AppUser { id: string; email: string; name?: string | null; role: AppRole; location_id: string; }
export interface AppLocation { id: string; company_name: string; timezone?: string }

interface SessionCtx {
  loading: boolean;
  user: AppUser | null;
  location: AppLocation | null;
  error: string | null;
  signOut: () => void;
}

const Ctx = createContext<SessionCtx>({ loading: true, user: null, location: null, error: null, signOut: () => {} });
const STORAGE_KEY = "uptiq.session";

async function callEdge(name: string, opts: { body?: unknown; session?: string | null } = {}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: opts.body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      ...(opts.session ? { "x-app-session": opts.session } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export function getSessionToken(): string | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")?.session ?? null; }
  catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionCtx>({ loading: true, user: null, location: null, error: null, signOut: () => {} });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        const fromIframe = params.get("location_id") && params.get("user_email");

        let token = getSessionToken();
        if (fromIframe) {
          const out = await callEdge("iframe-session", {
            body: {
              location_id: params.get("location_id"),
              user_email: params.get("user_email"),
              user_name: params.get("user_name") || undefined,
              phone: params.get("phone") || undefined,
            },
          });
          token = out.session;
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: token }));
          // clean iframe params from URL
          ["location_id", "user_email", "user_name", "phone"].forEach((k) => params.delete(k));
          const cleanUrl = url.pathname + (params.toString() ? `?${params}` : "") + url.hash;
          window.history.replaceState({}, "", cleanUrl);
        }

        if (!token) {
          // Phase 1 dev fallback: silently bootstrap demo session so /dashboard is usable outside iframe.
          const out = await callEdge("iframe-session", {
            body: {
              location_id: "DEMO_LOCATION",
              user_email: "dev@uptiq.local",
              user_name: "Dev User",
            },
          });
          token = out.session;
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: token }));
        }

        const me = await callEdge("me", { session: token });
        if (!active) return;
        setState({
          loading: false, user: me.user, location: me.location, error: null,
          signOut: () => { localStorage.removeItem(STORAGE_KEY); window.location.reload(); },
        });
      } catch (e: any) {
        if (!active) return;
        setState((s) => ({ ...s, loading: false, error: e?.message || "Session error" }));
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSession() { return useContext(Ctx); }
export { callEdge };
// keep supabase available for direct queries
export { supabase };
