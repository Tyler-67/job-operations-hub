import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface DecisionResult {
  action?: string;
  changed?: boolean;
}

// Human copy keyed off the decision action, so one page serves every owner/crew tap.
const COPY: Record<string, string> = {
  inspection_pass: "Inspection marked PASSED. The job has advanced to the next phase.",
  inspection_fail: "Inspection marked FAILED. The crew has been notified to review the fixes.",
  finish_walkthrough_yes: "Marked ready for the final walkthrough.",
  finish_walkthrough_no: "Noted — not ready yet. The crew will keep working.",
  walkthrough_approve: "Walkthrough approved. The job is ready to invoice.",
};

export default function DecisionConfirm() {
  const [status, setStatus] = useState<"loading" | "ok" | "invalid">("loading");
  const [result, setResult] = useState<DecisionResult | null>(null);

  useEffect(() => {
    (async () => {
      const token = new URL(window.location.href).searchParams.get("token");
      if (!token) {
        setStatus("invalid");
        return;
      }
      try {
        // The action-decision spine resolves the action from the token itself, consumes
        // it (single-use), runs the state transition, and enqueues the follow-ups.
        const res = await fetch(`${SUPABASE_URL}/functions/v1/action-decision`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: PUBLISHABLE_KEY,
            authorization: `Bearer ${PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ token }),
        });
        const data = await res.json() as DecisionResult;
        if (!res.ok) {
          setStatus("invalid");
          return;
        }
        setResult(data);
        setStatus("ok");
      } catch {
        setStatus("invalid");
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-base font-semibold">Inspection Result</h1>
      {status === "loading" && <div className="text-sm text-muted-foreground">Recording your response...</div>}
      {status === "invalid" && (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          This link is invalid or has already been used. Request a new one.
        </div>
      )}
      {status === "ok" && result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <p className="font-semibold">Got it.</p>
          <p className="mt-1 text-sm">{COPY[result.action ?? ""] ?? "Your response has been recorded."}</p>
        </div>
      )}
    </div>
  );
}
