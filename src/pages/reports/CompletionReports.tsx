import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { currency, fetchJobs, shortDate, type CompletionReport, type JobsResponse } from "@/lib/jobs";

interface ReportRow {
  jobId: string;
  report: CompletionReport;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function ReportCard({ jobId, report }: ReportRow) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/jobs/${jobId}`} className="text-sm font-semibold hover:underline">{report.address}</Link>
        <span className="text-xs text-muted-foreground">{report.final_state.label} · {shortDate(report.generated_at)}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Customer" value={report.customer?.name || "-"} />
        <Field label="Crew lead" value={report.crew_lead?.name || "-"} />
        <Field label="Started" value={shortDate(report.start_date)} />
        <Field label="Complete" value={`${report.completed_pct}%`} />
        <Field label="Hours" value={String(report.totals.hours)} />
        <Field label="Expenses" value={currency(report.totals.expenses)} />
        <Field label="Estimate" value={currency(report.totals.original_estimate)} />
      </div>

      {report.scope_of_work && (
        <div className="mt-3">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">Scope of work</div>
          <p className="mt-0.5 whitespace-pre-line text-sm">{report.scope_of_work}</p>
        </div>
      )}

      {report.notes && (
        <div className="mt-3">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">Notes (fixes &amp; punch list)</div>
          <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{report.notes}</p>
        </div>
      )}
    </div>
  );
}

export default function CompletionReports() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-4 py-2">
        <h1 className="text-sm font-semibold">Completion Reports</h1>
        <p className="text-xs text-muted-foreground">A snapshot is captured automatically when a job's final walkthrough is approved.</p>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">Loading completion reports...</p>}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && reports.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <ClipboardCheck className="h-6 w-6" />
            <p className="text-sm">No completion reports yet. They appear here once jobs are approved through the final walkthrough.</p>
          </div>
        )}
        {reports.map((row) => <ReportCard key={row.jobId} {...row} />)}
      </div>
    </div>
  );
}
