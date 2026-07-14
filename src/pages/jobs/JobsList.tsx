import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, BriefcaseBusiness, CalendarClock, Plus, ReceiptText, Search, Wrench } from "lucide-react";
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

function Metric({ icon: Icon, label, value, tone = "default" }: {
  icon: typeof BriefcaseBusiness;
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneClass = {
    default: "text-foreground",
    warning: "text-warning",
    danger: "text-destructive",
    success: "text-success",
  }[tone];

  return (
    <div className="flex min-h-20 items-center gap-3 border-b border-r border-border bg-card px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted">
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </div>
      <div>
        <div className={`font-mono-num text-lg font-semibold leading-none ${toneClass}`}>{value}</div>
        <div className="mt-1 text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );
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

  const overdueCount = jobs.filter(isOverdue).length;
  const inspectionCount = jobs.filter(isInspectionSoon).length;
  const pendingPoCount = jobs.reduce((sum, job) =>
    sum + job.purchase_orders.filter((po) => po.status === "pending_value").length, 0);
  const activeCount = jobs.filter((job) => job.active && !job.current_state?.is_terminal).length;
  const canManage = canManageJobs(user?.role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
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

      <div className="grid grid-cols-4 border-b border-border">
        <Metric icon={BriefcaseBusiness} label="Active jobs" value={activeCount} />
        <Metric icon={AlertCircle} label="Overdue check-ins" value={overdueCount} tone={overdueCount ? "danger" : "success"} />
        <Metric icon={CalendarClock} label="Inspections due" value={inspectionCount} tone={inspectionCount ? "warning" : "default"} />
        <Metric icon={ReceiptText} label="POs need value" value={pendingPoCount} tone={pendingPoCount ? "warning" : "default"} />
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading jobs...</div>}

      {!loading && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Job", "Customer", "State", "Progress", "Crew", "Expenses", "Inspection", "Office action", "Updated"].map((header) => (
                  <th key={header} className="border-b border-border px-3 py-2 text-left font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No jobs match the current filters.
                  </td>
                </tr>
              )}
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
                          <div className="h-full rounded-sm bg-accent" style={{ width: `${job.job_completion_pct}%` }} />
                        </div>
                        {job.job_completion_pct}%
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
