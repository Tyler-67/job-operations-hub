// Global search across jobs / contacts / POs / expenses (the `search` edge fn).
// Three consumers share the fetch (`searchAll`) and the result markup (`SearchResultsView`):
//   - GlobalSearch (default)  — input + button, full or `compact` layout (Dashboard, /search)
//   - SearchOverlay           — the sidebar-input-driven live overlay (see SearchOverlay.tsx)
import { useState } from "react";
import { Link } from "react-router-dom";
import { getSessionToken } from "@/lib/session";
import { currency } from "@/lib/jobs";

interface SearchJob {
  id: string;
  address: string;
  scope_of_work: string | null;
  notes: string | null;
  total_expenses: number;
  total_hours: number;
}

interface SearchContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

interface SearchPo {
  id: string;
  job_id: string;
  status: string;
  estimated_amount: number | null;
  final_amount: number | null;
  description: string | null;
}

interface SearchExpense {
  id: string;
  job_id: string;
  vendor: string | null;
  description: string | null;
  amount: number;
}

export interface SearchResults {
  jobs: SearchJob[];
  contacts: SearchContact[];
  pos: SearchPo[];
  expenses: SearchExpense[];
}

export const emptyResults: SearchResults = { jobs: [], contacts: [], pos: [], expenses: [] };

export function searchResultCount(data: SearchResults) {
  return data.jobs.length + data.contacts.length + data.pos.length + data.expenses.length;
}

// The one fetch, shared by every consumer. Throws on a non-2xx so callers surface the error.
export async function searchAll(q: string): Promise<SearchResults> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    "x-app-session": getSessionToken() ?? "",
  }});
  const json = await res.json() as SearchResults & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// The four result sections. `compact` caps each group and stacks single-column (Dashboard
// panel + overlay); the full page shows everything two-up. `onNavigate` fires when a result
// link is clicked (the overlay uses it to close).
export function SearchResultsView({ data, compact = false, onNavigate }: {
  data: SearchResults;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const cap = compact ? 5 : Number.POSITIVE_INFINITY;
  const slice = <T,>(rows: T[]) => rows.slice(0, cap);

  return (
    <>
      <section className="bg-background">
        <ResultHeader label="Jobs" count={data.jobs.length} />
        <div className="divide-y divide-border">
          {slice(data.jobs).map((job) => (
            <Link key={job.id} to={`/jobs/${job.id}`} onClick={onNavigate} className="block px-3 py-2 hover:bg-muted">
              <div className="font-medium">{job.address}</div>
              <div className="mt-0.5 text-muted-foreground">{job.scope_of_work ?? job.notes ?? "No scope entered"}</div>
            </Link>
          ))}
          {!data.jobs.length && <Empty />}
        </div>
      </section>
      <section className="bg-background">
        <ResultHeader label="Contacts" count={data.contacts.length} />
        <div className="divide-y divide-border">
          {slice(data.contacts).map((contact) => (
            <div key={contact.id} className="px-3 py-2">
              <div className="font-medium">{contact.name}</div>
              <div className="mt-0.5 text-muted-foreground">{[contact.role, contact.email, contact.phone].filter(Boolean).join(" - ")}</div>
            </div>
          ))}
          {!data.contacts.length && <Empty />}
        </div>
      </section>
      <section className="bg-background">
        <ResultHeader label="Purchase Orders" count={data.pos.length} />
        <div className="divide-y divide-border">
          {slice(data.pos).map((po) => (
            <Link key={po.id} to={`/jobs/${po.job_id}`} onClick={onNavigate} className="block px-3 py-2 hover:bg-muted">
              <div className="font-medium">{po.description ?? "Purchase order"}</div>
              <div className="mt-0.5 text-muted-foreground">{po.status.replace(/_/g, " ")} - {currency(po.final_amount ?? po.estimated_amount ?? 0)}</div>
            </Link>
          ))}
          {!data.pos.length && <Empty />}
        </div>
      </section>
      <section className="bg-background">
        <ResultHeader label="Expenses" count={data.expenses.length} />
        <div className="divide-y divide-border">
          {slice(data.expenses).map((expense) => (
            <Link key={expense.id} to={`/jobs/${expense.job_id}`} onClick={onNavigate} className="block px-3 py-2 hover:bg-muted">
              <div className="font-medium">{expense.vendor ?? expense.description ?? "Expense"}</div>
              <div className="mt-0.5 text-muted-foreground">{currency(expense.amount)}</div>
            </Link>
          ))}
          {!data.expenses.length && <Empty />}
        </div>
      </section>
    </>
  );
}

export default function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (q.trim().length < 2) {
      setData(emptyResults);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await searchAll(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "flex h-full flex-col text-xs" : "flex h-full flex-col"}>
      <div className={compact ? "flex gap-2 border-b border-border bg-card p-3" : "flex gap-2 border-b border-border bg-card p-4"}>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && run()}
          placeholder={compact ? "Search everything..." : "Search jobs, contacts, POs, expenses..."}
          className={compact
            ? "h-8 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            : "h-9 flex-1 rounded-sm border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"}
        />
        <button onClick={run} className="rounded-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">Search</button>
      </div>
      {loading && <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">Searching...</div>}
      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      {data && (
        compact
          ? <div className="flex-1 divide-y divide-border overflow-auto text-xs"><SearchResultsView data={data} compact /></div>
          : <div className="grid flex-1 grid-cols-2 gap-px overflow-auto bg-border text-xs"><SearchResultsView data={data} /></div>
      )}
      {!data && compact && (
        <div className="p-3 text-2xs text-muted-foreground">Jobs, contacts, POs, and expenses. Enter to search.</div>
      )}
    </div>
  );
}

function ResultHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="border-b border-border bg-muted px-3 py-2 text-2xs uppercase tracking-wider text-muted-foreground">
      {label} ({count})
    </div>
  );
}

function Empty() {
  return <div className="px-3 py-6 text-center text-muted-foreground">No results</div>;
}
