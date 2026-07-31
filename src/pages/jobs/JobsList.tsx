import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { canManageJobs, currency, fetchJobs, inspectionUnderway, needsCheckIn, shortDate, type JobSummary, type JobsResponse } from "@/lib/jobs";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { SortableTh, shouldIgnoreRowClick, useTableSort, type SortAccessors } from "@/components/SortableTable";

const JOB_SORT: SortAccessors<JobSummary> = {
  job: (job) => job.address,
  customer: (job) => job.customers[0]?.name ?? null,
  state: (job) => job.current_state?.label ?? null,
  progress: (job) => job.state_progress_pct,
  crew: (job) => job.crew.map((contact) => contact.name).join(", ") || null,
  expenses: (job) => job.total_expenses,
  inspection: (job) => job.inspection_date,
  // Office action = pending PO values only (check-in overdue lives on Progress, inspection in its column).
  action: (job) => job.purchase_orders.filter((po) => po.status === "pending_value").length,
  updated: (job) => job.updated_at,
};

function isInspectionSoon(job: JobSummary) {
  if (!job.inspection_date) return false;
  const due = new Date(job.inspection_date).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return due >= now - sevenDays && due <= now + sevenDays;
}

export default function JobsList() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stateId, setStateId] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobs(includeArchived)
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load jobs"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [includeArchived]);

  const jobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);
  const filtered = useMemo(() => jobs.filter((job) => {
    if (stateId !== "all" && job.current_state_id !== stateId) return false;
    if (query.trim()) {
      const haystack = [
        job.address,
        job.scope_of_work,
        job.notes,
        ...job.customers.map((contact) => contact.name),
        ...job.crew.map((contact) => contact.name),
      ].join(" ").toLowerCase();
      if (!haystack.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  }), [jobs, query, stateId]);

  // The old stat-tile bar's numbers, relocated to the column heads (per Tyler: "(00/00)").
  const overdueCount = jobs.filter(needsCheckIn).length;
  const inspectionCount = jobs.filter(isInspectionSoon).length;
  const scheduledInspections = jobs.filter((job) => job.inspection_date).length;
  const activeCount = jobs.filter((job) => job.active && !job.current_state?.is_terminal).length;
  // The Office action column now carries ONLY pending PO values, so its head counts just those.
  const actionCount = jobs.filter((job) => job.purchase_orders.some((po) => po.status === "pending_value")).length;
  const canManage = canManageJobs(user?.role);

  const { sorted, sort, toggleSort } = useTableSort(filtered, JOB_SORT);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        {/* Title left, controls right — matches the Users / Supply Houses header format. */}
        <div>
          <h1 className="text-sm font-semibold">Jobs</h1>
          <p className="text-xs text-muted-foreground">Create, track, and move work through the configured job states.</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search address, customer, crew..."
            className="h-8 w-72 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <InlineSelect
          value={stateId}
          onChange={setStateId}
          className="h-8 w-40"
          options={[{ value: "all", label: "All states" }, ...(data?.states ?? []).map((state) => ({ value: state.id, label: state.label }))]}
        />
        <label className="flex h-8 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
          Archived
        </label>
        {canManage && (
          <Link to="/jobs/new" className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-3.5 w-3.5" />
            New Job
          </Link>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading jobs...</div>}

      {!loading && (
        <div className="relative flex-1 overflow-auto">
          {/* Centered like the old full-width row, but as an overlay so the column
              gridlines underneath keep running to the base of the page. */}
          {filtered.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
              <span className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground shadow-md">
                No jobs match the current filters.
              </span>
            </div>
          )}
          <table className="ops-grid ops-grid-full w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortableTh label={`Job (${activeCount}/${jobs.length})`} sortKey="job" sort={sort} onSort={toggleSort} />
                <SortableTh label="Customer" sortKey="customer" sort={sort} onSort={toggleSort} />
                <SortableTh label="State" sortKey="state" sort={sort} onSort={toggleSort} />
                <SortableTh label="Progress" sortKey="progress" sort={sort} onSort={toggleSort} />
                <SortableTh label="Crew" sortKey="crew" sort={sort} onSort={toggleSort} />
                <SortableTh label="Expenses" sortKey="expenses" sort={sort} onSort={toggleSort} />
                <SortableTh label={`Inspection (${inspectionCount}/${scheduledInspections})`} sortKey="inspection" sort={sort} onSort={toggleSort} />
                <SortableTh label={`Office action (${actionCount})`} sortKey="action" sort={sort} onSort={toggleSort} />
                <SortableTh label="Updated" sortKey="updated" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((job) => {
                const overdue = needsCheckIn(job);
                const pending = job.purchase_orders.filter((po) => po.status === "pending_value").length;
                return (
                  <tr key={job.id} className="ops-row cursor-pointer" onClick={(event) => { if (!shouldIgnoreRowClick(event)) navigate(`/jobs/${job.id}`); }}>
                    <td className="px-3 py-2">
                      {/* The row itself opens the job, but the address stays a real link for
                          keyboard, middle-click, and open-in-new-tab. No subtitle — rows stay
                          one line tall (per Tyler). */}
                      <Link to={`/jobs/${job.id}`} className="font-medium text-foreground hover:text-accent">{job.address}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{job.customers[0]?.name ?? "-"}</td>
                    {/* The state fills its whole cell (per Tyler); the inspection signal lives
                        in the Inspection column, not here. */}
                    <td className="px-3 py-2" style={job.current_state ? { backgroundColor: `${job.current_state.color}22` } : undefined}>
                      {job.current_state && (
                        <span className="font-medium" style={{ color: job.current_state.color }}>{job.current_state.label}</span>
                      )}
                    </td>
                    {/* Progress carries the check-in-overdue signal as the ONE pill kept (per Tyler). */}
                    <td className="px-3 py-2 font-mono-num">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="h-1.5 w-20 rounded-sm bg-secondary">
                          <div className="h-full rounded-sm bg-accent" style={{ width: `${job.state_progress_pct}%` }} />
                        </div>
                        {job.state_progress_pct}%
                        {overdue && <span className="pill bg-destructive/10 text-destructive">check-in overdue</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{job.crew.map((contact) => contact.name).join(", ") || "-"}</td>
                    <td className="px-3 py-2 font-mono-num">{currency(job.total_expenses)}</td>
                    {/* An active inspection fills its own column: the date, or "requested" until one is set. */}
                    <td className={`px-3 py-2 ${inspectionUnderway(job) ? "bg-info/10 font-medium text-info" : "text-muted-foreground"}`}>
                      {inspectionUnderway(job) && !job.inspection_date ? "requested" : shortDate(job.inspection_date)}
                    </td>
                    {/* Office action = pending PO values only — one full-cell fill. */}
                    <td className={`px-3 py-2 ${pending > 0 ? "bg-warning/20 font-medium text-warning" : ""}`}>
                      {pending > 0 && `${pending} PO value`}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{shortDate(job.updated_at)}</td>
                  </tr>
                );
              })}
              {/* Stretch row: keeps the column gridlines running to the base of the page. */}
              <tr aria-hidden className="ops-grid-fill">
                {Array.from({ length: 9 }, (_, i) => <td key={i} />)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!canManage && (
        <div className="border-t border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          View-only role. Owner admins and office managers can create, edit, and archive jobs.
        </div>
      )}
    </div>
  );
}
