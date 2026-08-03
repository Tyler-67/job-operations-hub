import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { checkInStatus, currency, fetchJobs, inspectionUnderway, needsCheckIn, shortDate, type JobSummary, type JobsResponse } from "@/lib/jobs";
import { SortableTh, shouldIgnoreRowClick, useTableSort, type SortAccessors } from "@/components/SortableTable";

// Column sort keys — declared at module level so the sorted list doesn't re-derive on every render.
const JOB_SORT: SortAccessors<JobSummary> = {
  address: (job) => job.address,
  customer: (job) => job.customers[0]?.name ?? null,
  state: (job) => job.current_state?.label ?? null,
  progress: (job) => job.state_progress_pct,
  expenses: (job) => job.total_expenses,
  inspection: (job) => job.inspection_date,
  checkin: (job) => job.last_log_date,
  // Action = pending PO values only (check-in overdue lives on Progress, inspection in its column).
  action: (job) => job.purchase_orders.filter((po) => po.status === "pending_value").length,
};

function inspectionDue(job: JobSummary) {
  if (!job.inspection_date) return false;
  const due = new Date(job.inspection_date).getTime();
  const now = Date.now();
  return due >= now - 24 * 60 * 60 * 1000 && due <= now + 7 * 24 * 60 * 60 * 1000;
}

export default function Dashboard() {
  const navigate = useNavigate();
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
  // The Action column now carries ONLY pending PO values, so its head counts just those.
  const actionCount = activeJobs.filter((job) => job.purchase_orders.some((po) => po.status === "pending_value")).length;

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

  const { sorted: sortedJobs, sort, toggleSort } = useTableSort(activeJobs, JOB_SORT);

  return (
    <div className="flex h-full flex-col">
      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading dashboard...</div>}

      {!loading && (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
          <div className="relative overflow-auto">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active jobs ({activeJobs.length})</h2>
            </div>
            {/* Centered like the old full-width row, but as an overlay so the column
                gridlines underneath keep running to the base of the page. */}
            {activeJobs.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-28 z-10 flex justify-center">
                <span className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground shadow-md">
                  No active jobs yet.
                </span>
              </div>
            )}
            <table className="ops-grid ops-grid-full w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  {/* Widths roughly track the Jobs page columns; Progress is wide enough for
                      the % plus the check-in-overdue pill it now carries. */}
                  <SortableTh label="Address" sortKey="address" sort={sort} onSort={toggleSort} className="w-[20%]" />
                  <SortableTh label="Customer" sortKey="customer" sort={sort} onSort={toggleSort} className="w-[10%]" />
                  <SortableTh label="State" sortKey="state" sort={sort} onSort={toggleSort} className="w-[15%]" />
                  <SortableTh label="State %" sortKey="progress" sort={sort} onSort={toggleSort} className="w-[15%]" />
                  <SortableTh label="Expenses" sortKey="expenses" sort={sort} onSort={toggleSort} className="w-[8%]" />
                  <SortableTh label={`Inspection (${inspections.length}/${inspectionsScheduled})`} sortKey="inspection" sort={sort} onSort={toggleSort} className="w-[11%]" />
                  <SortableTh label={`Check-in (${overdue.length}/${checkInEligible})`} sortKey="checkin" sort={sort} onSort={toggleSort} className="w-[10%]" />
                  <SortableTh label={`Action (${actionCount})`} sortKey="action" sort={sort} onSort={toggleSort} className="w-[11%]" />
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((job) => {
                  const pendingPoCount = job.purchase_orders.filter((po) => po.status === "pending_value").length;
                  return (
                    <tr key={job.id} className="ops-row cursor-pointer" onClick={(event) => { if (!shouldIgnoreRowClick(event)) navigate(`/jobs/${job.id}`); }}>
                      <td className="px-3 py-2">
                        {/* The row itself opens the job, but the address stays a real link for
                            keyboard, middle-click, and open-in-new-tab. Truncates, never wraps —
                            rows stay one line tall (per Tyler). */}
                        <Link to={`/jobs/${job.id}`} className="block truncate font-medium text-foreground hover:text-accent">{job.address}</Link>
                      </td>
                      <td className="truncate px-3 py-2 text-muted-foreground">{job.customers[0]?.name ?? "-"}</td>
                      {/* The state fills its whole cell (per Tyler); the inspection signal
                          lives in the Inspection column, not here. */}
                      <td className="px-3 py-2" style={job.current_state ? { backgroundColor: `${job.current_state.color}22` } : undefined}>
                        {job.current_state && (
                          // truncate (not wrap) when space runs out, so rows stay one line tall.
                          <span className="block truncate font-medium" style={{ color: job.current_state.color }}>{job.current_state.label}</span>
                        )}
                      </td>
                      {/* Bar + % — same treatment as the Jobs list's Progress column. */}
                      <td className="px-3 py-2 font-mono-num">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-sm bg-secondary">
                            <div className="h-full rounded-sm bg-accent" style={{ width: `${job.state_progress_pct}%` }} />
                          </div>
                          {job.state_progress_pct}%
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono-num">{currency(job.total_expenses)}</td>
                      {/* An active inspection fills its own column: the date, or "requested" until one is set. */}
                      <td className={`px-3 py-2 ${inspectionUnderway(job) ? "bg-info/10 font-medium text-info" : "text-muted-foreground"}`}>
                        {inspectionUnderway(job) && !job.inspection_date ? "Requested" : shortDate(job.inspection_date)}
                      </td>
                      {/* An overdue check-in FILLS this cell (the moved pill): last check-in
                          date, red, detail on hover. */}
                      <td className={`px-3 py-2 ${needsCheckIn(job) ? "bg-destructive/10 font-medium text-destructive" : "text-muted-foreground"}`} title={checkInStatus(job) ?? undefined}>
                        {shortDate(job.last_log_date)}
                      </td>
                      {/* Action = pending PO values only (check-in lives on Progress, inspection in
                          its own column), so one full-cell fill covers it. */}
                      <td className={`truncate px-3 py-2 ${pendingPoCount > 0 ? "bg-warning/20 font-medium text-warning" : ""}`}>
                        {pendingPoCount > 0 && "PO value"}
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
