// Reports — one page, grouped by week. Each week is a divider (the date range) + a distinct
// "weekly report" row (the snapshot aggregate) that collapses that week's completed-job rows.
// Merges two sources that share a weekly grain: the weekly_reports snapshots (the pulse) and
// per-job completion_reports (the closeouts). Weekly reports use a rolling 7-day window ending
// on the report day, so completions are bucketed onto that same grid, anchored to the reports.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, ChevronDown, ChevronRight, Search } from "lucide-react";
import { currency, fetchJobs, shortDate, type CompletionReport, type JobExpense, type JobsResponse } from "@/lib/jobs";
import { fetchWeeklyReports, type WeeklyReportRow } from "@/lib/weekly-reports";

interface Completion { jobId: string; report: CompletionReport; expenses: JobExpense[] }

const EXPENSE_KIND: Record<string, string> = { field_purchase: "Field", po: "PO", adjustment: "Adjustment" };
interface WeekBucket {
  key: string;                 // window-end iso — the grouping key
  start: string;
  end: string;
  weekly: WeeklyReportRow | null;
  completions: Completion[];
}

function localDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
}
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (aIso: string, bIso: string) => Math.round((localDate(aIso).getTime() - localDate(bIso).getTime()) / 86_400_000);
function addDaysIso(iso: string, n: number) { const d = localDate(iso); d.setDate(d.getDate() + n); return isoOf(d); }
// The end-of-window on the 7-day grid anchored at `anchor` (a report's period_end) that
// contains `dateIso`. Works for past and future dates (the current, not-yet-reported week).
function windowEndFor(dateIso: string, anchorIso: string) {
  return addDaysIso(anchorIso, -7 * Math.floor(daysBetween(anchorIso, dateIso) / 7));
}

function buildBuckets(weeklies: WeeklyReportRow[], completions: Completion[]): WeekBucket[] {
  const anchor = weeklies.length
    ? weeklies.reduce((max, w) => (w.period_end > max ? w.period_end : max), weeklies[0].period_end)
    : isoOf(new Date());

  const map = new Map<string, WeekBucket>();
  const ensure = (end: string): WeekBucket => {
    let b = map.get(end);
    if (!b) { b = { key: end, start: addDaysIso(end, -6), end, weekly: null, completions: [] }; map.set(end, b); }
    return b;
  };
  for (const w of weeklies) {
    const b = ensure(windowEndFor(w.period_end, anchor));
    b.weekly = w;
    b.start = w.period_start; // the report's own range is authoritative for display
    b.end = w.period_end;
  }
  for (const c of completions) {
    ensure(windowEndFor(c.report.generated_at.slice(0, 10), anchor)).completions.push(c);
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function WeeklyRow({ bucket, collapsed, onToggle }: { bucket: WeekBucket; collapsed: boolean; onToggle: () => void }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const t = bucket.weekly?.snapshot.totals;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 border-l-2 border-accent bg-accent-soft px-4 py-1.5 text-left text-xs hover:bg-accent-soft/70"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="pill shrink-0 bg-accent/15 text-accent">Weekly report</span>
      {t ? (
        <span className="font-mono-num text-2xs text-muted-foreground">
          {t.active_jobs} active · {t.completed_jobs} completed · {t.stalled_jobs} stalled · {t.hours_logged}h · {currency(t.completed_estimate_total)} est
        </span>
      ) : (
        <span className="text-2xs italic text-muted-foreground/70">not captured for this week</span>
      )}
      <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{bucket.completions.length} job{bucket.completions.length === 1 ? "" : "s"}</span>
    </button>
  );
}

function JobRow({ completion, expanded, onToggle }: { completion: Completion; expanded: boolean; onToggle: () => void }) {
  const { jobId, report, expenses } = completion;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <div className="ops-row flex items-center gap-2 py-1.5 pl-6 pr-4 text-xs">
        <button type="button" onClick={onToggle} className="shrink-0 text-muted-foreground hover:text-foreground" title={expanded ? "Hide expenses" : "Show expenses"}>
          <Chevron className="h-3.5 w-3.5" />
        </button>
        <span className="pill shrink-0 bg-success/10 text-success">{report.final_state.label}</span>
        <Link to={`/jobs/${jobId}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
          {report.address}
          {report.customer?.name && <span className="font-normal text-muted-foreground"> · {report.customer.name}</span>}
        </Link>
        <span className="shrink-0 font-mono-num text-muted-foreground">
          {report.totals.hours}h · {currency(report.totals.expenses)} of {currency(report.totals.original_estimate)}
        </span>
      </div>
      {expanded && (
        expenses.length > 0 ? (
          expenses.map((e) => (
            <div key={e.id} className="flex items-center gap-2 border-b border-border/60 bg-muted/20 py-1 pl-14 pr-4 text-2xs">
              <span className="pill shrink-0 bg-muted text-muted-foreground">{EXPENSE_KIND[e.kind] ?? e.kind}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.vendor || e.description || "—"}</span>
              <span className="shrink-0 font-mono-num">{currency(Number(e.amount))}</span>
            </div>
          ))
        ) : (
          <div className="border-b border-border/60 bg-muted/20 py-1 pl-14 pr-4 text-2xs text-muted-foreground/70">No expenses recorded.</div>
        )
      )}
    </>
  );
}

export default function Reports() {
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [weeklies, setWeeklies] = useState<WeeklyReportRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Include archived jobs: completed/paid jobs are often archived but still hold a report.
    Promise.all([fetchJobs(true), fetchWeeklyReports()])
      .then(([jobs, wk]) => { if (active) { setJobsData(jobs); setWeeklies(wk.reports); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load reports"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const completions = useMemo<Completion[]>(() =>
    (jobsData?.jobs ?? [])
      .filter((job): job is typeof job & { completion_report: CompletionReport } => !!job.completion_report)
      .map((job) => ({ jobId: job.id, report: job.completion_report, expenses: job.expenses ?? [] })),
    [jobsData?.jobs]);

  const buckets = useMemo(() => buildBuckets(weeklies ?? [], completions), [weeklies, completions]);

  const needle = query.trim().toLowerCase();
  const view = useMemo(() => {
    if (!needle) return buckets;
    // Search narrows to matching completions; keep only weeks that still have a match.
    return buckets
      .map((b) => ({
        ...b,
        completions: b.completions.filter((c) =>
          [c.report.address, c.report.customer?.name, c.report.crew_lead?.name, c.report.scope_of_work]
            .join(" ").toLowerCase().includes(needle)),
      }))
      .filter((b) => b.completions.length > 0);
  }, [buckets, needle]);

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleJob = (jobId: string) => setExpandedJobs((prev) => {
    const next = new Set(prev);
    next.has(jobId) ? next.delete(jobId) : next.add(jobId);
    return next;
  });

  const hasData = (weeklies?.length ?? 0) > 0 || completions.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Reports</h1>
          <p className="text-xs text-muted-foreground">Each week's snapshot with the jobs completed that week. Auto-captured, read-only.</p>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setCollapsed((prev) => (prev.size ? new Set() : new Set(buckets.map((b) => b.key))))}
          className="h-8 rounded-sm border border-border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted"
        >
          {collapsed.size ? "Expand all" : "Collapse all"}
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search job, customer, crew..."
            className="h-8 w-64 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">Loading reports...</p>}
        {error && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {!loading && !error && !hasData && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <CalendarRange className="h-6 w-6" />
            <p className="text-sm">No reports yet. A weekly snapshot is captured on your report day; completed jobs appear here as they close out.</p>
          </div>
        )}
        {!loading && !error && hasData && view.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No completed jobs match the current filter.</p>
        )}
        {view.map((bucket) => {
          const isCollapsed = collapsed.has(bucket.key);
          return (
            <div key={bucket.key}>
              <div className="border-t border-border bg-muted px-4 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {shortDate(bucket.start)} – {shortDate(bucket.end)}
              </div>
              <WeeklyRow bucket={bucket} collapsed={isCollapsed} onToggle={() => toggle(bucket.key)} />
              {!isCollapsed && (
                bucket.completions.length > 0
                  ? bucket.completions.map((c) => (
                    <JobRow key={c.jobId} completion={c} expanded={expandedJobs.has(c.jobId)} onToggle={() => toggleJob(c.jobId)} />
                  ))
                  : <div className="py-1.5 pl-9 pr-4 text-xs text-muted-foreground/70">No jobs completed this week.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
