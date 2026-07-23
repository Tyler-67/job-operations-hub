import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { canManageJobs, currency, fetchJobs, shortDate, type JobSummary, type JobsResponse } from "@/lib/jobs";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";

function isOverdue(job: JobSummary) {
  if (!job.current_state?.allow_check_ins || job.current_state?.is_terminal) return false;
  if (!job.last_log_date) return true;
  const lastLog = new Date(job.last_log_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return lastLog < today;
}

function isInspectionSoon(job: JobSummary) {
  if (!job.inspection_date) return false;
  const due = new Date(job.inspection_date).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return due >= now - sevenDays && due <= now + sevenDays;
}

export default function JobsList() {
  const { user } = useSession();
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
  const overdueCount = jobs.filter(isOverdue).length;
  const inspectionCount = jobs.filter(isInspectionSoon).length;
  const scheduledInspections = jobs.filter((job) => job.inspection_date).length;
  const activeCount = jobs.filter((job) => job.active && !job.current_state?.is_terminal).length;
  const actionCount = jobs.filter((job) =>
    isOverdue(job) ||
    job.current_state?.is_inspection ||
    job.purchase_orders.some((po) => po.status === "pending_value")).length;
  const canManage = canManageJobs(user?.role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
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
        <div className="flex-1" />
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
              <span className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground shadow-sm">
                No jobs match the current filters.
              </span>
            </div>
          )}
          <table className="ops-grid ops-grid-full w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {[
                  `Job (${activeCount}/${jobs.length})`,
                  "Customer",
                  "State",
                  "Progress",
                  "Crew",
                  "Expenses",
                  `Inspection (${inspectionCount}/${scheduledInspections})`,
                  `Office action (${actionCount})`,
                  "Updated",
                ].map((header) => (
                  <th key={header} className="border-b border-border px-3 py-2 text-left font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => {
                const overdue = isOverdue(job);
                const pending = job.purchase_orders.filter((po) => po.status === "pending_value").length;
                return (
                  <tr key={job.id} className="ops-row">
                    <td className="px-3 py-2">
                      <Link to={`/jobs/${job.id}`} className="font-medium text-foreground hover:text-accent">{job.address}</Link>
                      <div className="mt-0.5 max-w-80 truncate text-muted-foreground">{job.scope_of_work ?? "No scope entered"}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{job.customers[0]?.name ?? "-"}</td>
                    <td className="px-3 py-2">
                      {job.current_state && (
                        <span className="pill" style={{ backgroundColor: `${job.current_state.color}22`, color: job.current_state.color }}>
                          {job.current_state.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono-num">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-sm bg-secondary">
                          <div className="h-full rounded-sm bg-accent" style={{ width: `${job.state_progress_pct}%` }} />
                        </div>
                        {job.state_progress_pct}%
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{job.crew.map((contact) => contact.name).join(", ") || "-"}</td>
                    <td className="px-3 py-2 font-mono-num">{currency(job.total_expenses)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{shortDate(job.inspection_date)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {overdue && <span className="pill bg-destructive/10 text-destructive">check-in overdue</span>}
                        {pending > 0 && <span className="pill bg-warning/20 text-warning">{pending} PO value</span>}
                        {job.current_state?.is_inspection && <span className="pill bg-info/10 text-info">inspection</span>}
                        {!overdue && pending === 0 && !job.current_state?.is_inspection && <span className="text-muted-foreground">-</span>}
                      </div>
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
