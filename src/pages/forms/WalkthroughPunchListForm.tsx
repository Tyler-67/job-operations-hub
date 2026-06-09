import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface TokenPayload {
  token?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function readAddress(payload: TokenPayload): string | null {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const raw = inner.address;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export default function WalkthroughPunchListForm({ payload }: { payload: TokenPayload }) {
  const address = useMemo(() => readAddress(payload), [payload]);
  const token = payload.token ?? "";

  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/forms-walkthrough-punch-list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ token, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "submit_failed");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <p className="font-semibold">Punch list sent.</p>
        <p className="mt-1 text-sm">The crew has been notified of the items to finish before approval.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {address && <p className="text-sm text-muted-foreground">{address}</p>}

      <div className="space-y-1">
        <Label htmlFor="punch-list">What still needs to be done?</Label>
        <Textarea id="punch-list" required rows={5} value={details}
          placeholder="List the punch items the crew needs to finish before you approve the walkthrough."
          onChange={(e) => setDetails(e.target.value)} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <Button type="submit" disabled={submitting || !details.trim()} className="w-full">
        {submitting ? "Sending..." : "Send punch list to crew"}
      </Button>
    </form>
  );
}
