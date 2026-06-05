import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, ReceiptText } from "lucide-react";
import { currency, fetchJobs, shortDate, type JobSummary, type JobsResponse } from "@/lib/jobs";

function needsCheckIn(job: JobSummary) {
  if (!job.current_state?.allow_check_ins || job.current_state?.is_terminal) return false;
  if (!job.last_log_date) return true;
  const last = new Date(job.last_log_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return last < today;
}

function inspectionDue(job: JobSummary) {
  if (!job.inspection_date) return false;
  const due = new Date(job.inspection_date).getTime();
  const now = Date.now();
  return due >= now - 24 * 60 * 60 * 1000 && due <= now + 7 * 24 * 60 * 60 * 1000;
}

function Stat({ icon: Icon, label, value, tone = "default" }: {
  icon: typeof ClipboardList;
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
  const pendingPos = activeJobs.reduce((sum, job) =>
    sum + job.purchase_orders.filter((po) => po.status === "pending_value").length, 0);
  const completeThisWeek = jobs.filter((job) => job.current_state?.slug === "complete").length;

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
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">Fast overview of active jobs and office follow-up.</p>
        </div>
        <div className="flex-1" />
        <Link to="/jobs" className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted">Open Jobs</Link>
      </div>

      <div className="grid grid-cols-4 border-b border-border">
        <Stat icon={ClipboardList} label="Active jobs" value={activeJobs.length} />
        <Stat icon={AlertTriangle} label="Overdue check-ins" value={overdue.length} tone={overdue.length ? "danger" : "success"} />
        <Stat icon={CalendarClock} label="Inspections due" value={inspections.length} tone={inspections.length ? "warning" : "default"} />
        <Stat icon={ReceiptText} label="PO values needed" value={pendingPos} tone={pendingPos ? "warning" : "default"} />
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading dashboard...</div>}

      {!loading && (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
          <div className="overflow-auto">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active jobs</h2>
            </div>
            <table className="w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-[30%] border-b border-border px-3 py-2 text-left font-medium">Address</th>
                  <th className="w-[12%] border-b border-border px-3 py-2 text-left font-medium">Customer</th>
                  <th className="w-[14%] border-b border-border px-3 py-2 text-left font-medium">State</th>
                  <th className="w-[7%] border-b border-border px-3 py-2 text-left font-medium">Job %</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Expenses</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Inspection</th>
                  <th className="w-[9%] border-b border-border px-3 py-2 text-left font-medium">Check-in</th>
                  <th className="w-[10%] border-b border-border px-3 py-2 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No active jobs yet.</td></tr>
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
                      <td className="px-3 py-2 font-mono-num">{job.job_completion_pct}%</td>
                      <td className="px-3 py-2 font-mono-num">{currency(job.total_expenses)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDate(job.inspection_date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDate(job.last_log_date)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          {needsCheckIn(job) && <span className="pill bg-destructive/10 text-destructive">check-in</span>}
                          {pendingPoCount > 0 && <span className="pill bg-warning/20 text-warning">PO value</span>}
                          {inspectionDue(job) && <span className="pill bg-info/10 text-info">inspection</span>}
                          {!needsCheckIn(job) && pendingPoCount === 0 && !inspectionDue(job) && <span className="text-muted-foreground">-</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="overflow-auto border-l border-border bg-card">
            <section className="border-b border-border p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Office queue</h2>
              <div className="mt-3 divide-y divide-border text-xs">
                {officeQueue.map((job) => (
                  <Link key={job.id} to={`/jobs/${job.id}`} className="block py-2 hover:text-accent">
                    <div className="font-medium">{job.address}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {needsCheckIn(job) && <span className="pill bg-destructive/10 text-destructive">check-in overdue</span>}
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
