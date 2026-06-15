import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { currency, shortDate } from "@/lib/jobs";
import { fetchWeeklyReports, type WeeklyReportRow } from "@/lib/weekly-reports";

function Totals({ report }: { report: WeeklyReportRow }) {
  const t = report.snapshot.totals;
  const cells: Array<{ label: string; value: string }> = [
    { label: "Active jobs", value: String(t.active_jobs) },
    { label: "Completed", value: String(t.completed_jobs) },
    { label: "Stalled", value: String(t.stalled_jobs) },
    { label: "Hours logged", value: String(t.hours_logged) },
    { label: "Completed est.", value: currency(t.completed_estimate_total) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="rounded-md border border-border bg-muted/30 p-2">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
          <div className="mt-0.5 text-sm font-semibold">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  );
}

function JobLink({ id, address }: { id: string; address: string | null }) {
  return (
    <Link to={`/jobs/${id}`} className="text-sm hover:underline">{address || "(no address)"}</Link>
  );
}

function ReportCard({ report }: { report: WeeklyReportRow }) {
  const s = report.snapshot;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{shortDate(report.period_start)} – {shortDate(report.period_end)}</h2>
        <span className="text-xs text-muted-foreground">Generated {shortDate(s.generated_at)}</span>
      </div>

      <div className="mt-3">
        <Totals report={report} />
      </div>

      <Section title="Active jobs by phase">
        {s.active_by_phase.length ? (
          s.active_by_phase.map((p) => (
            <div key={p.state_id} className="flex items-center justify-between gap-2 text-sm">
              <span>{p.label}</span>
              <span className="text-muted-foreground">{p.count}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No active jobs.</p>
        )}
      </Section>

      <Section title="Completed this week">
        {s.completed.length ? (
          s.completed.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <JobLink id={c.id} address={c.address} />
              <span className="text-xs text-muted-foreground">{currency(c.estimate)}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">None completed this week.</p>
        )}
      </Section>

      <Section title="Stalled / needs attention">
        {s.stalled.length ? (
          s.stalled.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-2">
              <JobLink id={j.id} address={j.address} />
              <span className="text-xs text-muted-foreground">
                {j.days_since === null ? "no logs" : `${j.days_since}d since last log`}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nothing stalled — every active job logged recently.</p>
        )}
      </Section>

      <Section title="Coverage gaps">
        {(s.coverage_gaps ?? []).length ? (
          s.coverage_gaps.map((g) => (
            <div key={g.contact_id} className="flex items-center justify-between gap-2 text-sm">
              <span>{g.name}</span>
              <span className="text-xs text-muted-foreground">no check-ins this week</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Every assigned crew logged this week.</p>
        )}
      </Section>

      <Section title="Unlinked work this week">
        {(s.unlinked_work ?? []).length ? (
          s.unlinked_work.map((u) => (
            <div key={u.daily_log_id} className="flex items-center justify-between gap-2">
              <JobLink id={u.job_id} address={u.address} />
              <span className="text-xs text-muted-foreground">
                {u.crew_name ? `${u.crew_name}` : ""}{u.hours_worked != null ? ` · ${u.hours_worked}h` : ""}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No quick-log entries this week.</p>
        )}
      </Section>
    </div>
  );
}

export default function WeeklyReport() {
  const [reports, setReports] = useState<WeeklyReportRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWeeklyReports()
      .then((next) => { if (active) { setReports(next.reports); setError(null); } })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load weekly reports"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-4 py-2">
        <h1 className="text-sm font-semibold">Weekly Report</h1>
        <p className="text-xs text-muted-foreground">A snapshot is captured automatically each week and emailed to the owner.</p>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">Loading weekly reports...</p>}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && (reports?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <CalendarRange className="h-6 w-6" />
            <p className="text-sm">No weekly reports yet. The first one is generated on your configured weekly report day.</p>
          </div>
        )}
        {(reports ?? []).map((report) => <ReportCard key={report.id} report={report} />)}
      </div>
    </div>
  );
}
