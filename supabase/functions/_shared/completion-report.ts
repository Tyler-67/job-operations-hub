/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds the job's completion-report snapshot when a decision advances it into a billing
// state (the final walkthrough was approved). The snapshot is a point-in-time JSONB record
// of the closed job — address, scope, the running notes (which already carry the inspection
// fixes and walkthrough punch lists), totals, customer and crew lead — stored on
// jobs.completion_report. Built once: a second billing-state entry (e.g. complete → paid)
// leaves the existing report untouched. The pure assembly is unit-testable under vitest;
// the I/O wrapper takes sb as a parameter rather than importing the Deno client.

export interface CompletionReportJob {
  id: string;
  address: string;
  scope_of_work: string | null;
  notes: string | null;
  start_date: string | null;
  job_completion_pct: number;
  total_hours: number | string;
  total_expenses: number | string;
  original_estimate: number | string | null;
}

export interface ReportParty {
  name: string;
  phone: string | null;
  uptiq_contact_id: string | null;
}

export interface FinalState {
  slug: string;
  label: string;
}

// Coerces a numeric/string column to a finite number, defaulting to 0; null stays null.
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Pure: assembles the stored snapshot from already-loaded job + related rows.
export function buildCompletionReportSnapshot(
  job: CompletionReportJob,
  finalState: FinalState,
  customer: ReportParty | null,
  crewLead: ReportParty | null,
  generatedAt: string,
): Record<string, unknown> {
  return {
    generated_at: generatedAt,
    job_id: job.id,
    address: job.address,
    final_state: finalState,
    scope_of_work: job.scope_of_work ?? null,
    notes: job.notes ?? null,
    start_date: job.start_date ?? null,
    completed_pct: job.job_completion_pct,
    totals: {
      hours: num(job.total_hours),
      expenses: num(job.total_expenses),
      original_estimate: job.original_estimate == null ? null : num(job.original_estimate),
    },
    customer,
    crew_lead: crewLead,
  };
}

async function party(sb: any, table: string, jobId: string, flagColumn: string): Promise<ReportParty | null> {
  const { data } = await sb
    .from(table)
    .select("contacts(name, phone, uptiq_contact_id)")
    .eq("job_id", jobId)
    .eq(flagColumn, true)
    .limit(1)
    .maybeSingle();
  const c = data?.contacts;
  if (!c) return null;
  return {
    name: (c.name ?? "").trim(),
    phone: (c.phone ?? "").trim() || null,
    uptiq_contact_id: (c.uptiq_contact_id ?? "").trim() || null,
  };
}

// Writes a completion-report snapshot to the job IF the destination state is a billing
// state and the job has no report yet. Returns true only when a report was written;
// no-ops (returns false) for non-billing states or a job already carrying a report.
export async function maybeBuildCompletionReport(
  sb: any,
  jobId: string,
  toStateId: string,
): Promise<boolean> {
  const { data: state, error: sErr } = await sb
    .from("job_states")
    .select("slug, label, is_billing")
    .eq("id", toStateId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!state?.is_billing) return false;

  const { data: job, error: jErr } = await sb
    .from("jobs")
    .select("id, address, scope_of_work, notes, start_date, job_completion_pct, total_hours, total_expenses, original_estimate, completion_report")
    .eq("id", jobId)
    .maybeSingle();
  if (jErr) throw jErr;
  if (!job || job.completion_report) return false; // missing, or already built (idempotent)

  const customer = await party(sb, "job_customers", jobId, "is_primary");
  const crewLead = await party(sb, "job_crew", jobId, "is_lead");

  const snapshot = buildCompletionReportSnapshot(
    job,
    { slug: state.slug, label: state.label },
    customer,
    crewLead,
    new Date().toISOString(),
  );

  // Guard the write on completion_report still being null so a racing second entry can't overwrite.
  const { error: updErr } = await sb
    .from("jobs")
    .update({ completion_report: snapshot })
    .eq("id", jobId)
    .is("completion_report", null);
  if (updErr) throw updErr;
  return true;
}
