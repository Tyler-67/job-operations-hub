import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callEdge, saveSessionToken, supabase } from "@/lib/session";

// Handles the Supabase Auth redirect for both magic-link sign-in and password recovery.
// The supabase client (detectSessionInUrl) parses the URL and establishes a session; we
// then bridge it into an app session via auth-session and land on the dashboard. For
// recovery we first collect a new password before bridging.
const REJECTION_COPY: Record<string, string> = {
  not_provisioned: "This account isn't set up for the app yet. Ask an admin to add you.",
  inactive_user: "This account has been deactivated. Contact your admin.",
  email_unverified: "Your email isn't verified yet. Use the sign-in link we emailed you.",
  invalid_token: "This link is invalid or has expired. Request a new one.",
  ambiguous_account: "This email maps to more than one account. Contact your admin.",
};

function messageFor(e: unknown) {
  const key = e instanceof Error ? e.message : "";
  return REJECTION_COPY[key] ?? "Sign-in couldn't be completed. Return to the login page and try again.";
}

export default function AuthCallback() {
  const [phase, setPhase] = useState<"working" | "recovery" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const startedRef = useRef(false);

  // Bridge the current Supabase session into an app session, then hard-navigate so the
  // SessionProvider remounts and validates the freshly stored x-app-session (Door 2).
  async function bridgeAndGo() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("This link is invalid or has expired. Request a new one.");
      setPhase("error");
      return;
    }
    try {
      const out = await callEdge("auth-session", { body: { access_token: session.access_token } });
      saveSessionToken(out.session);
      window.location.assign("/dashboard");
    } catch (e) {
      // Not authorized for the app (or the bridge failed) — clear the Supabase session so
      // we don't silently re-bridge on the next load, then show why.
      await supabase.auth.signOut();
      setError(messageFor(e));
      setPhase("error");
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const isRecovery = query.get("mode") === "recovery" || hash.get("type") === "recovery";

    let recovery = isRecovery;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") { recovery = true; setPhase("recovery"); }
    });

    (async () => {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (recovery) { setPhase("recovery"); return; } // collect a password before bridging
      if (sessErr || !session?.access_token) {
        setError("This link is invalid or has expired. Request a new one.");
        setPhase("error");
        return;
      }
      await bridgeAndGo();
    })();

    return () => subscription.unsubscribe();
  }, []);

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await bridgeAndGo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm p-6">
      {phase === "working" && <div className="text-sm text-muted-foreground">Signing you in...</div>}

      {phase === "recovery" && (
        <form onSubmit={submitNewPassword} className="space-y-4">
          <h1 className="text-base font-semibold">Set a new password</h1>
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" minLength={8}
              value={password} onChange={(ev) => setPassword(ev.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={saving || password.length < 8}>
            {saving ? "Saving..." : "Set password and continue"}
          </Button>
          {error && (
            <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          )}
        </form>
      )}

      {phase === "error" && (
        <div className="space-y-4">
          <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
          <a href="/login" className="text-sm underline underline-offset-2">Back to sign in</a>
        </div>
      )}
    </div>
  );
}
