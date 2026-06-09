import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface QuickLogJob {
  id: string;
  address: string | null;
  state_label: string | null;
}

interface TokenPayload {
  token?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function readJobs(payload: TokenPayload): QuickLogJob[] {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(inner.jobs) ? inner.jobs : [];
  const jobs: QuickLogJob[] = [];
  for (const item of raw) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    if (!id) continue;
    jobs.push({
      id,
      address: typeof obj.address === "string" && obj.address.trim() ? obj.address.trim() : null,
      state_label: typeof obj.state_label === "string" && obj.state_label.trim() ? obj.state_label.trim() : null,
    });
  }
  return jobs;
}

function readCompany(payload: TokenPayload): string | null {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const raw = inner.company_name;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export default function QuickLogForm({ payload }: { payload: TokenPayload }) {
  const jobs = useMemo(() => readJobs(payload), [payload]);
  const company = useMemo(() => readCompany(payload), [payload]);
  const token = payload.token ?? "";

  const [jobId, setJobId] = useState<string>(jobs.length === 1 ? jobs[0].id : "");
  const [hours, setHours] = useState("");
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/forms-quick-log`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          token,
          job_id: jobId || null,
          hours_worked: hours,
          state_progress_pct: progress,
          note,
        }),
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
        <p className="font-semibold">Logged.</p>
        <p className="mt-1 text-sm">Thanks{company ? ` — ${company} has it` : ""}.</p>
      </div>
    );
  }

  if (!jobs.length) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        No active job found for you. Check with the office.
      </div>
    );
  }

  const selected = jobs.find((j) => j.id === jobId) ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {company && <p className="text-sm font-semibold">{company}</p>}

      {jobs.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Which job?</legend>
          {jobs.map((j) => (
            <label key={j.id} className="flex items-start gap-2 text-sm">
              <input type="radio" name="job" value={j.id} checked={jobId === j.id}
                onChange={() => setJobId(j.id)} className="mt-1" />
              <span>
                {j.address || "(no address)"}
                {j.state_label ? <span className="text-muted-foreground"> — {j.state_label}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        selected && (
          <p className="text-sm text-muted-foreground">
            {selected.address || "(no address)"}
            {selected.state_label ? ` — ${selected.state_label}` : ""}
          </p>
        )
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="hours">Hours worked</Label>
          <Input id="hours" type="number" inputMode="decimal" min="0" step="0.25" value={hours}
            onChange={(e) => setHours(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="progress">Phase progress %</Label>
          <Input id="progress" type="number" inputMode="numeric" min="0" max="100" value={progress}
            onChange={(e) => setProgress(e.target.value)} placeholder="0" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Anything the office should know" />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <Button type="submit" disabled={submitting || !jobId} className="w-full">
        {submitting ? "Logging..." : "Submit log"}
      </Button>
    </form>
  );
}
