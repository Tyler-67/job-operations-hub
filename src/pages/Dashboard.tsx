import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { currency, fetchJobs, shortDate, type JobSummary, type JobsResponse } from "@/lib/jobs";
import GlobalSearch from "@/components/GlobalSearch";

// Parse a date-only string ("YYYY-MM-DD") as a LOCAL calendar date at midnight. last_log_date is
// date-only; new Date() reads it as UTC midnight, which is the PRIOR day in US timezones — that
// mis-flagged a same-day check-in as overdue.
function localMidnight(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Whole days a check-in-eligible job is overdue: undefined = not eligible (terminal / no check-ins),
// null = eligible but never logged, 0 = logged today (not overdue), N = last log N days ago.
function checkInOverdueDays(job: JobSummary): number | null | undefined {
  if (!job.current_state?.allow_check_ins || job.current_state?.is_terminal) return undefined;
  if (!job.last_log_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - localMidnight(job.last_log_date).getTime()) / 86_400_000);
}

function needsCheckIn(job: JobSummary) {
  const days = checkInOverdueDays(job);
  return days === null || (typeof days === "number" && days >= 1);
}

// Human overdue status for a pill/label: null when not overdue (or not eligible).
function checkInStatus(job: JobSummary): string | null {
  const days = checkInOverdueDays(job);
  if (days === null) return "never checked in";
  if (typeof days === "number" && days >= 1) return days === 1 ? "1 day overdue" : `${days} days overdue`;
  return null;
}

function inspectionDue(job: JobSummary) {
  if (!job.inspection_date) return false;
  const due = new Date(job.inspection_date).getTime();
  const now = Date.now();
  return due >= now - 24 * 60 * 60 * 1000 && due <= now + 7 * 24 * 60 * 60 * 1000;
}

export default function Dashboard() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchJobs()
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load dashboard"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const jobs = data?.jobs ?? [];
  const activeJobs = jobs.filter((job) => !job.current_state?.is_terminal);
  const overdue = activeJobs.filter(needsCheckIn);
  const inspections = activeJobs.filter(inspectionDue);
  const completeThisWeek = jobs.filter((job) => job.current_state?.slug === "complete").length;

  // The old stat-tile bar's numbers, relocated to the column heads (per Tyler: "(00/00)").
  const checkInEligible = activeJobs.filter((job) => job.current_state?.allow_check_ins && !job.current_state?.is_terminal).length;
  const inspectionsScheduled = activeJobs.filter((job) => job.inspection_date).length;
  const actionCount = activeJobs.filter((job) =>
    needsCheckIn(job) ||
    job.current_state?.is_inspection ||
    job.purchase_orders.some((po) => po.status === "pending_value")).length;

  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of activeJobs) {
      const label = job.current_state?.label ?? "No state";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeJobs]);

  const officeQueue = activeJobs
    .filter((job) => needsCheckIn(job) || inspectionDue(job) || job.purchase_orders.some((po) => po.status === "pending_value"))
    .slice(0, 8);

  return (
    <div className="flex h-full flex-col">
      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading dashboard...</div>}

      {!loading && (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_300px_340px] overflow-hidden">
          <div className="overflow-auto">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active jobs ({activeJobs.length})</h2>
            </div>
            <table className="ops-grid ops-grid-full w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-[30%] border-b border-border px-3 py-2 text-left font-medium">Address</th>
                  <th className="w-[12%] border-b border-border px-3 py-2 text-left font-medium">Customer</th>
                  <th className="w-[14%] border-b border-border px-3 py-2 text-left font-medium">State</th>
                  <th className="w-[7%] border-b border-border px-3 py-2 text-left font-medium">State %</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Expenses</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Inspection ({inspections.length}/{inspectionsScheduled})</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Check-in ({overdue.length}/{checkInEligible})</th>
                  <th className="w-[10%] border-b border-border px-3 py-2 text-left font-medium">Action ({actionCount})</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.length === 0 && (
                  <tr>
                    {/* Span only the cells the message needs; the rest stay real (empty)
                        cells so their column gridlines keep running. */}
                    <td colSpan={2} className="px-3 py-8 text-muted-foreground">No active jobs yet.</td>
                    {Array.from({ length: 6 }, (_, i) => <td key={i} />)}
                  </tr>
                )}
                {activeJobs.map((job) => {
                  const pendingPoCount = job.purchase_orders.filter((po) => po.status === "pending_value").length;
                  return (
                    <tr key={job.id} className="ops-row">
                      <td className="px-3 py-2">
                        <Link to={`/jobs/${job.id}`} className="font-medium text-foreground hover:text-accent">{job.address}</Link>
                        <div className="mt-0.5 max-w-96 truncate text-muted-foreground">{job.scope_of_work ?? "-"}</div>
                      </td>
                      <td className="truncate px-3 py-2 text-muted-foreground">{job.customers[0]?.name ?? "-"}</td>
                      <td className="px-3 py-2">
                        {job.current_state && (
                          <span className="pill" style={{ backgroundColor: `${job.current_state.color}22`, color: job.current_state.color }}>
                            {job.current_state.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono-num">{job.state_progress_pct}%</td>
                      <td className="px-3 py-2 font-mono-num">{currency(job.total_expenses)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDate(job.inspection_date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{shortDate(job.last_log_date)}</div>
                        {checkInStatus(job) && <div className="text-2xs font-medium text-destructive">{checkInStatus(job)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          {needsCheckIn(job) && <span className="pill bg-destructive/10 text-destructive">{checkInStatus(job) ?? "check-in"}</span>}
                          {pendingPoCount > 0 && <span className="pill bg-warning/20 text-warning">PO value</span>}
                          {/* Same condition as the Jobs list's Office action column: the job is IN an
                              inspection phase right now (not the date-window heuristic — that left a
                              dateless inspection chipped on Jobs but blank here). */}
                          {job.current_state?.is_inspection && <span className="pill bg-info/10 text-info">inspection</span>}
                          {!needsCheckIn(job) && pendingPoCount === 0 && !job.current_state?.is_inspection && <span className="text-muted-foreground">-</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Stretch row: keeps the column gridlines running to the base of the page. */}
                <tr aria-hidden className="ops-grid-fill">
                  {Array.from({ length: 8 }, (_, i) => <td key={i} />)}
                </tr>
              </tbody>
            </table>
          </div>

          <aside className="flex flex-col overflow-hidden border-l border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Search</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <GlobalSearch compact />
            </div>
          </aside>

          <aside className="overflow-auto border-l border-border bg-card">
            <section className="border-b border-border p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Office queue ({officeQueue.length})</h2>
              <div className="mt-3 divide-y divide-border text-xs">
                {officeQueue.map((job) => (
                  <Link key={job.id} to={`/jobs/${job.id}`} className="block py-2 hover:text-accent">
                    <div className="font-medium">{job.address}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {needsCheckIn(job) && <span className="pill bg-destructive/10 text-destructive">check-in: {checkInStatus(job) ?? "overdue"}</span>}
                      {inspectionDue(job) && <span className="pill bg-info/10 text-info">inspection due</span>}
                      {job.purchase_orders.some((po) => po.status === "pending_value") && <span className="pill bg-warning/20 text-warning">PO value</span>}
                    </div>
                  </Link>
                ))}
                {officeQueue.length === 0 && <div className="py-3 text-muted-foreground">No urgent office actions.</div>}
              </div>
            </section>

            <section className="border-b border-border p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jobs by state</h2>
              <div className="mt-3 space-y-2 text-xs">
                {stateCounts.map(([label, count]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono-num font-medium">{count}</span>
                  </div>
                ))}
                {stateCounts.length === 0 && <div className="text-muted-foreground">No active states.</div>}
              </div>
            </section>

            <section className="p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completion pulse</h2>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <div>
                  <div className="font-mono-num text-sm font-semibold">{completeThisWeek}</div>
                  <div className="text-muted-foreground">Jobs currently ready for billing or payment follow-up.</div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
