import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface DecisionResult {
  action?: string;
  changed?: boolean;
}

// Human copy keyed off the decision action, so one page serves every owner/crew tap.
// Must cover every action the decision registry can route here (decisions.ts) — the
// four walkthrough_* decisions land on this page too, not just inspection results.
const COPY: Record<string, string> = {
  inspection_pass: "Inspection marked PASSED. The job has advanced to the next phase.",
  inspection_fail: "Inspection marked FAILED. The crew has been notified to review the fixes.",
  finish_walkthrough_yes: "Marked ready for the final walkthrough.",
  finish_walkthrough_no: "Noted — not ready yet. The crew will keep working.",
  walkthrough_approve: "Walkthrough approved. The job is ready to invoice.",
  walkthrough_reschedule:
    "Reschedule noted. The office has been asked to rebook the walkthrough — the job stays open until it's approved.",
  walkthrough_punch_list:
    "Punch list started. We just texted you a link to list the items that still need to be fixed before approval.",
  walkthrough_still_issues:
    "Noted — still some issues. We just texted you a link to update the punch list.",
};

// Heading keyed off the action so the page title matches the decision. Defaults to a
// neutral title before the action is known (loading/invalid) or for any unmapped action.
const HEADING: Record<string, string> = {
  inspection_pass: "Inspection Result",
  inspection_fail: "Inspection Result",
  finish_walkthrough_yes: "Final Walkthrough",
  finish_walkthrough_no: "Final Walkthrough",
  walkthrough_approve: "Final Walkthrough",
  walkthrough_reschedule: "Final Walkthrough",
  walkthrough_punch_list: "Final Walkthrough",
  walkthrough_still_issues: "Final Walkthrough",
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

  const heading = (status === "ok" && result && HEADING[result.action ?? ""]) || "Confirmation";

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-base font-semibold">{heading}</h1>
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
