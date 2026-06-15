import { callEdge } from "@/lib/session";

// Mirrors the snapshot assembled in supabase/functions/_shared/weekly-report.ts and stored in
// weekly_reports.snapshot. The weekly-reports read endpoint returns the most recent rows.
export interface WeeklyReportSnapshot {
  period_start: string;
  period_end: string;
  generated_at: string;
  active_by_phase: Array<{
    state_id: string;
    label: string;
    sort_order: number;
    count: number;
    jobs: Array<{ id: string; address: string | null }>;
  }>;
  completed: Array<{ id: string; address: string | null; completed_at: string; estimate: number | null }>;
  stalled: Array<{ id: string; address: string | null; last_log_date: string | null; days_since: number | null }>;
  coverage_gaps: Array<{ contact_id: string; name: string }>;
  unlinked_work: Array<{ daily_log_id: string; job_id: string; address: string | null; crew_name: string | null; log_date: string; hours_worked: number | null }>;
  totals: {
    active_jobs: number;
    completed_jobs: number;
    stalled_jobs: number;
    hours_logged: number;
    completed_estimate_total: number;
    coverage_gap_crew: number;
    unlinked_logs: number;
  };
}

export interface WeeklyReportRow {
  id: string;
  period_start: string;
  period_end: string;
  snapshot: WeeklyReportSnapshot;
  created_at: string;
}

export interface WeeklyReportsResponse {
  reports: WeeklyReportRow[];
}

export async function fetchWeeklyReports(limit?: number) {
  return callEdge("weekly-reports", {
    query: limit ? { limit } : {},
  }) as Promise<WeeklyReportsResponse>;
}
