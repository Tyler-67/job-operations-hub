import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, Search } from "lucide-react";
import { currency, shortDate } from "@/lib/jobs";
import { fetchWeeklyReports, type WeeklyReportRow } from "@/lib/weekly-reports";
import { InlineSelect } from "@/components/InlineSelect";

type RowType = "completed" | "stalled" | "unlinked" | "coverage";
interface ReportRow {
  key: string;
  type: RowType;
  label: string;        // job address or crew name
  right: string;        // the trailing figure/note
  jobId: string | null; // links to the job when it's a job row
}

const ROW_TAG: Record<RowType, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-success/10 text-success" },
  stalled: { label: "Stalled", cls: "bg-warning/20 text-warning" },
  unlinked: { label: "Unlinked", cls: "bg-info/10 text-info" },
  coverage: { label: "No check-in", cls: "bg-destructive/10 text-destructive" },
};

// Parse a date-only string as a LOCAL midnight (avoids the UTC-midnight-is-yesterday drift).
function localMidnight(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}
function daysBetween(aIso: string, bIso: string) {
  return Math.round((localMidnight(aIso).getTime() - localMidnight(bIso).getTime()) / 86_400_000);
}
function addDays(iso: string, days: number) {
  const d = localMidnight(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Flatten a week's snapshot into short job/crew rows (the sections become one compact list).
function buildRows(r: WeeklyReportRow): ReportRow[] {
  const s = r.snapshot;
  const rows: ReportRow[] = [];
  for (const c of s.completed) rows.push({ key: `c-${c.id}`, type: "completed", jobId: c.id, label: c.address || "(no address)", right: currency(c.estimate ?? 0) });
  for (const j of s.stalled) rows.push({ key: `s-${j.id}`, type: "stalled", jobId: j.id, label: j.address || "(no address)", right: j.days_since === null ? "no logs" : `${j.days_since}d since log` });
  for (const u of s.unlinked_work ?? []) rows.push({ key: `u-${u.daily_log_id}`, type: "unlinked", jobId: u.job_id, label: u.address || "(no address)", right: [u.crew_name, u.hours_worked != null ? `${u.hours_worked}h` : null].filter(Boolean).join(" · ") || "quick log" });
  for (const g of s.coverage_gaps ?? []) rows.push({ key: `g-${g.contact_id}`, type: "coverage", jobId: null, label: g.name, right: "no check-ins" });
  return rows;
}

function WeekDivider({ report }: { report: WeeklyReportRow }) {
  const t = report.snapshot.totals;
  const phases = report.snapshot.active_by_phase;
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-border bg-muted px-4 py-1.5">
      <span className="text-xs font-semibold">{shortDate(report.period_start)} – {shortDate(report.period_end)}</span>
      <span className="font-mono-num text-2xs text-muted-foreground">
        {t.active_jobs} active · {t.completed_jobs} completed · {t.stalled_jobs} stalled · {t.hours_logged}h · {currency(t.completed_estimate_total)} est
      </span>
      {phases.length > 0 && (
        <span className="text-2xs text-muted-foreground/70">{phases.map((p) => `${p.label} ${p.count}`).join(" · ")}</span>
      )}
    </div>
  );
}

function GapDivider({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-2xs italic text-muted-foreground/60">
      <span className="h-px flex-1 bg-border" />
      No report · {shortDate(from)} – {shortDate(to)}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Row({ row }: { row: ReportRow }) {
  const tag = ROW_TAG[row.type];
  return (
    <div className="ops-row flex items-center gap-3 px-4 py-1.5 text-xs">
      <span className={`pill ${tag.cls} shrink-0`}>{tag.label}</span>
      {row.jobId ? (
        <Link to={`/jobs/${row.jobId}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">{row.label}</Link>
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
      )}
      <span className="shrink-0 font-mono-num text-muted-foreground">{row.right}</span>
    </div>
  );
}

export default function WeeklyReport() {
  const [reports, setReports] = useState<WeeklyReportRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RowType>("all");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWeeklyReports()
      .then((next) => { if (active) { setReports(next.reports); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load weekly reports"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtering = query.trim() !== "" || typeFilter !== "all";

  // Interleave week blocks (newest first) with gap dividers for any skipped week.
  const items = useMemo(() => {
    const sorted = [...(reports ?? [])].sort((a, b) => b.period_start.localeCompare(a.period_start));
    const needle = query.trim().toLowerCase();
    const out: Array<
      | { kind: "week"; report: WeeklyReportRow; rows: ReportRow[] }
      | { kind: "gap"; from: string; to: string }
    > = [];
    sorted.forEach((report, i) => {
      let rows = buildRows(report);
      if (typeFilter !== "all") rows = rows.filter((r) => r.type === typeFilter);
      if (needle) rows = rows.filter((r) => `${r.label} ${r.right} ${ROW_TAG[r.type].label}`.toLowerCase().includes(needle));
      // When filtering, drop weeks (and gaps) with nothing to show; otherwise keep every week.
      if (filtering && rows.length === 0) return;
      out.push({ kind: "week", report, rows });
      const older = sorted[i + 1];
      if (!filtering && older && daysBetween(report.period_start, older.period_end) > 8) {
        out.push({ kind: "gap", from: addDays(older.period_end, 1), to: addDays(report.period_start, -1) });
      }
    });
    return out;
  }, [reports, query, typeFilter, filtering]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Weekly Reports</h1>
          <p className="text-xs text-muted-foreground">Auto-captured each week and emailed to the owner. Read-only.</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search job, crew..."
            className="h-8 w-64 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <InlineSelect
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as "all" | RowType)}
          className="h-8 w-40"
          options={[
            { value: "all", label: "All entries" },
            { value: "completed", label: "Completed" },
            { value: "stalled", label: "Stalled" },
            { value: "unlinked", label: "Unlinked work" },
            { value: "coverage", label: "Coverage gaps" },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">Loading weekly reports...</p>}
        {error && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {!loading && !error && (reports?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <CalendarRange className="h-6 w-6" />
            <p className="text-sm">No weekly reports yet. The first one is generated on your configured weekly report day.</p>
          </div>
        )}
        {!loading && !error && (reports?.length ?? 0) > 0 && items.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No entries match the current filters.</p>
        )}
        {items.map((item, i) =>
          item.kind === "gap" ? (
            <GapDivider key={`gap-${i}`} from={item.from} to={item.to} />
          ) : (
            <div key={item.report.id}>
              <WeekDivider report={item.report} />
              {item.rows.length > 0 ? (
                item.rows.map((row) => <Row key={row.key} row={row} />)
              ) : (
                <div className="px-4 py-2 text-xs text-muted-foreground/70">Quiet week — no completions, stalls, or gaps.</div>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
