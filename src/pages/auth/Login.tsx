import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSessionToken, supabase } from "@/lib/session";

// Standalone (non-Uptiq) login door. Authenticates via Supabase Auth (magic link OR
// password); the /auth/callback route then bridges the Supabase session into an app
// session. This is the always-works, security-grade path independent of Uptiq.
export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "link" | "password" | "reset">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If an app session already exists, skip the login screen.
  useEffect(() => {
    if (getSessionToken()) navigate("/dashboard", { replace: true });
  }, [navigate]);

  const redirectTo = `${window.location.origin}/auth/callback`;

  async function sendMagicLink() {
    setError(null); setNotice(null); setBusy("link");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setNotice("Check your email for a sign-in link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function signInWithPassword() {
    setError(null); setNotice(null); setBusy("password");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      // Session established — hand off to the callback to bridge + land on the dashboard.
      navigate("/auth/callback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Check your email and password.");
      setBusy(null);
    }
  }

  async function sendReset() {
    setError(null); setNotice(null); setBusy("reset");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${redirectTo}?mode=recovery`,
      });
      if (error) throw error;
      setNotice("Check your email for a link to set your password.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reset email. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="mx-auto max-w-sm p-6">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-xs font-bold text-primary-foreground">U</div>
        <h1 className="text-base font-semibold tracking-tight">Sign in to Uptiq</h1>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="login-email">Email</Label>
          <Input id="login-email" type="email" autoComplete="email" placeholder="you@company.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <Button type="button" className="w-full" disabled={!emailValid || busy !== null} onClick={sendMagicLink}>
          {busy === "link" ? "Sending..." : "Email me a magic link"}
        </Button>

        <div className="flex items-center gap-3 text-2xs uppercase tracking-wider text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void signInWithPassword(); }}>
          <div className="space-y-1">
            <Label htmlFor="login-password">Password</Label>
            <Input id="login-password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" className="w-full" disabled={!emailValid || !password || busy !== null}>
            {busy === "password" ? "Signing in..." : "Sign in with password"}
          </Button>
        </form>

        <button type="button" onClick={sendReset} disabled={!emailValid || busy !== null}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">
          Set or reset your password
        </button>

        {notice && (
          <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>
        )}
        {error && (
          <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        )}
      </div>
    </div>
  );
}
