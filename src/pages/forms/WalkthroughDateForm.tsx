import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface TokenPayload {
  token?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

type Slot = "9am" | "1pm";

function readAddress(payload: TokenPayload): string | null {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const raw = inner.address;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

// The owner's "schedule the final walkthrough" form — the walkthrough twin of
// InspectionDateForm. Submits to forms-walkthrough-date; picking today makes the
// APPROVE / PUNCH-LIST ask arrive right away.
export default function WalkthroughDateForm({ payload }: { payload: TokenPayload }) {
  const address = useMemo(() => readAddress(payload), [payload]);
  const token = payload.token ?? "";

  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<Slot>("9am");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ date: string; slot: Slot } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/forms-walkthrough-date`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ token, walkthrough_date: date, slot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "submit_failed");
      setDone({ date: data.walkthrough_date as string, slot: data.slot as Slot });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <p className="font-semibold">Walkthrough scheduled.</p>
        <p className="mt-1 text-sm">
          Set for {done.date} ({done.slot === "1pm" ? "1:00 PM" : "9:00 AM"})
          {address ? ` at ${address}` : ""}. On that day you&rsquo;ll get a text to approve
          the walkthrough or start a punch list.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {address && <p className="text-sm text-muted-foreground">{address}</p>}

      <div className="space-y-1">
        <Label htmlFor="walkthrough-date">Walkthrough date</Label>
        <Input id="walkthrough-date" type="date" required value={date}
          onChange={(e) => setDate(e.target.value)} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Time window</legend>
        {([
          ["9am", "Morning — 9:00 AM"],
          ["1pm", "Afternoon — 1:00 PM"],
        ] as const).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="slot" value={value} checked={slot === value}
              onChange={() => setSlot(value)} />
            {label}
          </label>
        ))}
      </fieldset>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <Button type="submit" disabled={submitting || !date} className="w-full">
        {submitting ? "Saving..." : "Schedule walkthrough"}
      </Button>
    </form>
  );
}
