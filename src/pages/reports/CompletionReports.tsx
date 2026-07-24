import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, Search } from "lucide-react";
import { currency, fetchJobs, shortDate, type CompletionReport, type JobsResponse } from "@/lib/jobs";
import { InlineSelect } from "@/components/InlineSelect";

interface ReportRow {
  jobId: string;
  report: CompletionReport;
}

// Local-midnight parse (avoids the UTC-midnight-is-yesterday drift on date-only strings) +
// the Monday-anchored week the completion falls in, so rows group under a week divider like
// the weekly reports. generated_at is a full timestamp; the date portion is what we bucket on.
function localDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}
function weekRange(iso: string) {
  const d = localDate(iso);
  const day = d.getDay(); // 0=Sun..6=Sat
  const monday = new Date(d);
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const toIso = (x: Date) => x.toISOString().slice(0, 10);
  return { key: toIso(monday), start: toIso(monday), end: toIso(sunday) };
}

function WeekDivider({ start, end, count }: { start: string; end: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-4 border-y border-border bg-muted px-4 py-1.5">
      <span className="text-xs font-semibold">{shortDate(start)} – {shortDate(end)}</span>
      <span className="text-2xs text-muted-foreground">{count} completed</span>
    </div>
  );
}

function Row({ jobId, report }: ReportRow) {
  return (
    <div className="ops-row flex items-center gap-3 px-4 py-1.5 text-xs">
      <span className="pill shrink-0 bg-success/10 text-success">{report.final_state.label}</span>
      <Link to={`/jobs/${jobId}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
        {report.address}
        {report.customer?.name && <span className="font-normal text-muted-foreground"> · {report.customer.name}</span>}
      </Link>
      <span className="shrink-0 font-mono-num text-muted-foreground">
        {report.totals.hours}h · {currency(report.totals.expenses)} of {currency(report.totals.original_estimate)}
      </span>
    </div>
  );
}

export default function CompletionReports() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Include archived: completed/paid jobs are often archived but still have a report.
    fetchJobs(true)
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load completion reports"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const reports = useMemo<ReportRow[]>(() => {
    return (data?.jobs ?? [])
      .filter((job): job is typeof job & { completion_report: CompletionReport } => !!job.completion_report)
      .map((job) => ({ jobId: job.id, report: job.completion_report }))
      .sort((a, b) => b.report.generated_at.localeCompare(a.report.generated_at));
  }, [data?.jobs]);

  const stateOptions = useMemo(() => {
    const labels = [...new Set(reports.map((r) => r.report.final_state.label))];
    return [{ value: "all", label: "All states" }, ...labels.map((l) => ({ value: l, label: l }))];
  }, [reports]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports.filter(({ report }) => {
      if (stateFilter !== "all" && report.final_state.label !== stateFilter) return false;
      if (!needle) return true;
      return [report.address, report.customer?.name, report.crew_lead?.name, report.scope_of_work]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [reports, query, stateFilter]);

  // Group the filtered rows into Monday-anchored week buckets (newest first), each preceded by
  // a divider stating its date range. Rows are already sorted desc by generated_at.
  const weeks = useMemo(() => {
    const out: Array<{ key: string; start: string; end: string; rows: ReportRow[] }> = [];
    for (const row of filtered) {
      const wr = weekRange(row.report.generated_at);
      const last = out[out.length - 1];
      if (last && last.key === wr.key) last.rows.push(row);
      else out.push({ key: wr.key, start: wr.start, end: wr.end, rows: [row] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Completion Reports</h1>
          <p className="text-xs text-muted-foreground">Auto-captured when a job's final walkthrough is approved. Read-only.</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search job, customer, crew..."
            className="h-8 w-64 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <InlineSelect value={stateFilter} onChange={setStateFilter} className="h-8 w-40" options={stateOptions} />
      </div>

      <div className="flex-1 overflow-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">Loading completion reports...</p>}
        {error && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {!loading && !error && reports.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <ClipboardCheck className="h-6 w-6" />
            <p className="text-sm">No completion reports yet. They appear here once jobs are approved through the final walkthrough.</p>
          </div>
        )}
        {!loading && !error && reports.length > 0 && filtered.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No reports match the current filters.</p>
        )}
        {weeks.map((week) => (
          <div key={week.key}>
            <WeekDivider start={week.start} end={week.end} count={week.rows.length} />
            {week.rows.map((row) => <Row key={row.jobId} {...row} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
