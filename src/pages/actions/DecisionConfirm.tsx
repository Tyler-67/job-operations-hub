import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// When a decision hands the owner a follow-up form (a failed inspection's fix list, or a
// walkthrough punch list), action-decision returns { form: { action, token } }. We render that
// form INLINE on this same page — tap FAIL, the form appears, submit, the crew is notified — so
// the owner never has to hunt for a second SMS.
interface DecisionResult {
  action?: string;
  changed?: boolean;
  form?: { action: string; token: string } | null;
}

// action -> the forms-* endpoint + the copy for the inline form.
const FORM_CONFIG: Record<
  string,
  { endpoint: string; heading: string; intro: string; prompt: string; placeholder: string; button: string; sent: string }
> = {
  inspection_fix_details: {
    endpoint: "forms-inspection-fix-details",
    heading: "Inspection Failed",
    intro: "Inspection marked FAILED. Tell the crew what to fix — they'll get it as soon as you send.",
    prompt: "What did the inspector flag?",
    placeholder: "List the items the crew needs to fix before re-inspection.",
    button: "Send fixes to crew",
    sent: "The required fixes have been sent to the crew.",
  },
  walkthrough_punch_details: {
    endpoint: "forms-walkthrough-punch-list",
    heading: "Walkthrough Punch List",
    intro: "Walkthrough failed — the job moves back to the finish phase. List what still needs fixing; the crew gets it as soon as you send.",
    prompt: "What still needs to be fixed?",
    placeholder: "List the punch items the crew needs to complete before approval.",
    button: "Send punch list to crew",
    sent: "The punch list has been sent to the crew and the job is back in the finish phase. When they report 100% you'll be asked to schedule the walkthrough again.",
  },
};

// Human copy for decisions that DON'T open an inline form — a plain confirmation.
// For the three form-bearing actions this is a fallback only: it shows when the decision
// produced no form token (e.g. the tap changed nothing because the job already moved on).
// No link SMS is sent on the tap path, so the copy must not promise one.
const COPY: Record<string, string> = {
  inspection_pass: "Inspection marked PASSED. The job has advanced to the next phase.",
  inspection_fail: "Inspection marked FAILED.",
  finish_walkthrough_yes: "Marked ready for the final walkthrough.",
  finish_walkthrough_no: "Noted — not ready yet. The crew will keep working.",
  walkthrough_approve: "Walkthrough approved. The job is ready to invoice.",
  walkthrough_reschedule:
    "Reschedule noted — we've texted you a fresh link to pick a new walkthrough day.",
  walkthrough_punch_list: "Punch list noted — the job is back in the finish phase.",
  walkthrough_still_issues: "Noted — still some issues. The job is back in the finish phase.",
};

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

type Status = "loading" | "form" | "ok" | "sent" | "invalid";

export default function DecisionConfirm() {
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
        const data = (await res.json()) as DecisionResult;
        if (!res.ok) {
          setStatus("invalid");
          return;
        }
        setResult(data);
        // If the decision opened a follow-up form we can render inline, show it; else confirm.
        setStatus(data.form && FORM_CONFIG[data.form.action] ? "form" : "ok");
      } catch {
        setStatus("invalid");
      }
    })();
  }, []);

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!result?.form) return;
    const cfg = FORM_CONFIG[result.form.action];
    if (!cfg) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${cfg.endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ token: result.form.token, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "submit_failed");
      setStatus("sent");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const formCfg = result?.form ? FORM_CONFIG[result.form.action] : undefined;
  const heading =
    (status === "form" || status === "sent") && formCfg
      ? formCfg.heading
      : (status === "ok" && result && HEADING[result.action ?? ""]) || "Confirmation";

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-base font-semibold">{heading}</h1>

      {status === "loading" && <div className="text-sm text-muted-foreground">Recording your response...</div>}

      {status === "invalid" && (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          This link is invalid or has already been used. Request a new one.
        </div>
      )}

      {status === "form" && formCfg && (
        <form onSubmit={submitForm} className="space-y-5">
          <p className="text-sm text-muted-foreground">{formCfg.intro}</p>
          <div className="space-y-1">
            <Label htmlFor="decision-details">{formCfg.prompt}</Label>
            <Textarea
              id="decision-details"
              required
              rows={5}
              value={details}
              placeholder={formCfg.placeholder}
              onChange={(event) => setDetails(event.target.value)}
            />
          </div>
          {formError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}
          <Button type="submit" disabled={submitting || !details.trim()} className="w-full">
            {submitting ? "Sending..." : formCfg.button}
          </Button>
        </form>
      )}

      {status === "sent" && formCfg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <p className="font-semibold">Sent.</p>
          <p className="mt-1 text-sm">{formCfg.sent}</p>
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
