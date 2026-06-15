/* eslint-disable @typescript-eslint/no-explicit-any */
// Weekly report assembly. Once a week (per company_settings.weekly_report_day/time, gated in
// the company's local zone) the cron builds a per-location snapshot of the week — active jobs
// grouped by phase, jobs completed this week, jobs that have stalled, and week totals — stores
// it in weekly_reports, and enqueues an owner email digest linking to the preview page.
//
// The snapshot assembly (buildWeeklyReportSnapshot) and the date/period math are pure and
// I/O-free so they're unit-testable under vitest. generateWeeklyReport is the thin I/O wrapper
// that queries Supabase, upserts the row, and enqueues the email; it takes sb as a parameter
// rather than importing the Deno client.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Active job with no daily log in this many days (relative to period_end) is "stalled".
const DEFAULT_STALL_DAYS = 3;
// The report covers the trailing 7 days ending on (and including) the report day.
const DEFAULT_PERIOD_DAYS = 7;

// ---- pure date helpers (operate on YYYY-MM-DD strings; string compare is date-ordered) ----

function addDaysIso(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(...(fromDate.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(toDate.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / MS_PER_DAY);
}

function inPeriod(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}

// The inclusive [periodStart, periodEnd] window ending on the local report date.
export function weeklyReportPeriod(reportDate: string, days = DEFAULT_PERIOD_DAYS): {
  periodStart: string;
  periodEnd: string;
} {
  return { periodStart: addDaysIso(reportDate, -(days - 1)), periodEnd: reportDate };
}

// Stable per-location-per-week key so a re-fire of the same period upserts rather than dupes.
export function weeklyReportDedupeKey(locationId: string, periodStart: string): string {
  return `weekly_report:${locationId}:${periodStart}`;
}

// Dedupe key for the owner email row in scheduled_notifications (one digest per period).
export function weeklyReportEmailDedupeKey(locationId: string, periodStart: string): string {
  return `notif:weekly_report:${locationId}:${periodStart}`;
}

// ---- pure snapshot assembly ----

export interface WeeklyReportStateInput {
  id: string;
  label: string;
  sort_order: number;
}

export interface WeeklyReportJobInput {
  id: string;
  address: string | null;
  active: boolean;
  current_state_id: string | null;
  // Completion timestamp as a local-or-UTC YYYY-MM-DD, or null if the job hasn't completed.
  completed_date: string | null;
  // Most recent daily_log.log_date for the job, or null if it has never been logged.
  last_log_date: string | null;
  original_estimate: number | null;
}

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
  // PAR-4: crew assigned to an active job who logged nothing this week.
  coverage_gaps: Array<{ contact_id: string; name: string }>;
  // PAR-5: work captured via the lightweight SMS quick-log (LOG) flow this week.
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

// PAR-4 input: crew rosters per job. Each entry is one crew member assigned to a job.
export interface WeeklyReportCrewAssignmentInput {
  contact_id: string;
  name: string;
  job_id: string;
  job_active: boolean;
}

// PAR-5 input: a quick-log daily_log (source='quick_log') and its joinable display fields.
export interface WeeklyReportQuickLogInput {
  daily_log_id: string;
  job_id: string;
  address: string | null;
  crew_name: string | null;
  log_date: string;
  hours_worked: number | null;
}

export function buildWeeklyReportSnapshot(input: {
  periodStart: string;
  periodEnd: string;
  now: Date;
  states: WeeklyReportStateInput[];
  jobs: WeeklyReportJobInput[];
  hoursLogged: number;
  stallDays?: number;
  // PAR-4: every crew->job assignment; we derive who logged nothing this week.
  crewAssignments?: WeeklyReportCrewAssignmentInput[];
  // PAR-4: distinct crew_contact_id that DID log at least once in the period.
  loggedCrewIds?: string[];
  // PAR-5: quick-log daily_logs whose log_date falls in the period.
  quickLogs?: WeeklyReportQuickLogInput[];
}): WeeklyReportSnapshot {
  const { periodStart, periodEnd, states, jobs } = input;
  const stallDays = input.stallDays ?? DEFAULT_STALL_DAYS;
  const stalledBefore = addDaysIso(periodEnd, -stallDays); // last log strictly older than this => stalled
  const stateById = new Map(states.map((s) => [s.id, s]));

  const active = jobs.filter((j) => j.active);

  // Active jobs grouped by their current phase, ordered by the state's sort_order.
  const byPhase = new Map<string, WeeklyReportSnapshot["active_by_phase"][number]>();
  for (const j of active) {
    const sid = j.current_state_id ?? "";
    const st = stateById.get(sid);
    let bucket = byPhase.get(sid);
    if (!bucket) {
      bucket = {
        state_id: sid,
        label: st?.label ?? "(no phase)",
        sort_order: st?.sort_order ?? 9999,
        count: 0,
        jobs: [],
      };
      byPhase.set(sid, bucket);
    }
    bucket.count++;
    bucket.jobs.push({ id: j.id, address: j.address });
  }
  const active_by_phase = [...byPhase.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
  );

  // Jobs whose completion date falls inside the reporting window.
  const completed = jobs
    .filter((j) => j.completed_date && inPeriod(j.completed_date, periodStart, periodEnd))
    .map((j) => ({ id: j.id, address: j.address, completed_at: j.completed_date as string, estimate: j.original_estimate }));
  const completedIds = new Set(completed.map((c) => c.id));

  // Active, not-just-completed jobs whose latest log is stale (or which have never logged).
  const stalled = active
    .filter((j) => !completedIds.has(j.id))
    .filter((j) => (j.last_log_date ?? "") < stalledBefore)
    .map((j) => ({
      id: j.id,
      address: j.address,
      last_log_date: j.last_log_date,
      days_since: j.last_log_date ? daysBetween(j.last_log_date, periodEnd) : null,
    }));

  const completed_estimate_total = completed.reduce((sum, c) => sum + (Number(c.estimate) || 0), 0);

  // PAR-4 Coverage Gaps: crew assigned to an ACTIVE job who logged nothing in the window.
  // Reduce assignments to the distinct crew on at least one active job, then drop anyone
  // present in loggedCrewIds.
  const logged = new Set(input.loggedCrewIds ?? []);
  const crewOnActive = new Map<string, string>(); // contact_id -> name
  for (const a of input.crewAssignments ?? []) {
    if (a.job_active) crewOnActive.set(a.contact_id, a.name);
  }
  const coverage_gaps = [...crewOnActive.entries()]
    .filter(([id]) => !logged.has(id))
    .map(([contact_id, name]) => ({ contact_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // PAR-5 Unlinked Work: quick-log entries logged this week, newest first.
  const unlinked_work = (input.quickLogs ?? [])
    .filter((q) => inPeriod(q.log_date, periodStart, periodEnd))
    .map((q) => ({
      daily_log_id: q.daily_log_id,
      job_id: q.job_id,
      address: q.address,
      crew_name: q.crew_name,
      log_date: q.log_date,
      hours_worked: q.hours_worked,
    }))
    .sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0));

  return {
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: input.now.toISOString(),
    active_by_phase,
    completed,
    stalled,
    coverage_gaps,
    unlinked_work,
    totals: {
      active_jobs: active.length,
      completed_jobs: completed.length,
      stalled_jobs: stalled.length,
      hours_logged: input.hoursLogged,
      completed_estimate_total,
      coverage_gap_crew: coverage_gaps.length,
      unlinked_logs: unlinked_work.length,
    },
  };
}

// ---- I/O wrapper ----

// The completion timestamp proxy: paid_at when present, else updated_at once a completion
// report exists (the report is built on entering a billing state). There is no dedicated
// completed_at column, so an owner editing an old completed job in-week can re-surface it —
// acceptable for a weekly digest. Returns YYYY-MM-DD (UTC) or null.
function jobCompletedDate(job: any): string | null {
  const ts = job.paid_at ?? (job.completion_report ? job.updated_at : null);
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Builds + upserts the snapshot for one location's period and enqueues the owner email digest.
// Returns the assembled snapshot. Idempotent: the weekly_reports row upserts on
// (location_id, period_start) and the email row is deduped per period.
export async function generateWeeklyReport(
  sb: any,
  opts: {
    locationId: string;
    periodStart: string;
    periodEnd: string;
    now: Date;
    ownerContactId?: string | null;
    appBaseUrl?: string;
    companyName?: string;
  },
): Promise<WeeklyReportSnapshot> {
  const { locationId, periodStart, periodEnd, now } = opts;

  const { data: states, error: sErr } = await sb
    .from("job_states")
    .select("id, label, sort_order");
  if (sErr) throw sErr;

  const { data: jobRows, error: jErr } = await sb
    .from("jobs")
    .select("id, address, active, current_state_id, original_estimate, paid_at, completion_report, updated_at")
    .eq("location_id", locationId);
  if (jErr) throw jErr;
  const jobs = jobRows ?? [];

  // Latest log date per job, and the period's total logged hours, in two scoped queries.
  const jobIds = jobs.map((j: any) => j.id);
  const jobById = new Map<string, any>(jobs.map((j: any) => [j.id as string, j]));
  const lastLogByJob = new Map<string, string>();
  let hoursLogged = 0;
  // PAR-4: crew who logged at least once in the window. PAR-5: quick-log rows in the window.
  const loggedCrewInPeriod = new Set<string>();
  const quickLogRows: Array<{ id: string; job_id: string; crew_contact_id: string; log_date: string; hours_worked: number | null }> = [];
  if (jobIds.length) {
    const { data: logs, error: lErr } = await sb
      .from("daily_logs")
      .select("id, job_id, crew_contact_id, log_date, hours_worked, source")
      .in("job_id", jobIds);
    if (lErr) throw lErr;
    for (const log of logs ?? []) {
      const d = String(log.log_date ?? "");
      const prev = lastLogByJob.get(log.job_id as string);
      if (d && (!prev || d > prev)) lastLogByJob.set(log.job_id as string, d);
      if (d && d >= periodStart && d <= periodEnd) {
        hoursLogged += Number(log.hours_worked) || 0;
        if (log.crew_contact_id) loggedCrewInPeriod.add(log.crew_contact_id as string);
        if (log.source === "quick_log") {
          quickLogRows.push({
            id: log.id as string,
            job_id: log.job_id as string,
            crew_contact_id: log.crew_contact_id as string,
            log_date: d,
            hours_worked: log.hours_worked === null || log.hours_worked === undefined ? null : Number(log.hours_worked),
          });
        }
      }
    }
  }

  // PAR-4: crew rosters for this location's jobs (active flag drives the gap test).
  const { data: crewRows, error: crewErr } = await sb
    .from("job_crew")
    .select("job_id, contact_id, contacts(name), jobs!inner(id, location_id, active)")
    .eq("jobs.location_id", locationId);
  if (crewErr) throw crewErr;
  const crewAssignments = (crewRows ?? []).map((r: any) => ({
    contact_id: r.contact_id as string,
    name: (r.contacts?.name as string | null) ?? "(unnamed crew)",
    job_id: r.job_id as string,
    job_active: !!r.jobs?.active,
  }));
  const crewNameById = new Map<string, string>(crewAssignments.map((a) => [a.contact_id, a.name]));

  // PAR-5: hydrate quick-log rows with address + crew name for display.
  const quickLogs = quickLogRows.map((q) => ({
    daily_log_id: q.id,
    job_id: q.job_id,
    address: (jobById.get(q.job_id)?.address as string | null) ?? null,
    crew_name: crewNameById.get(q.crew_contact_id) ?? null,
    log_date: q.log_date,
    hours_worked: q.hours_worked,
  }));

  const snapshot = buildWeeklyReportSnapshot({
    periodStart,
    periodEnd,
    now,
    states: (states ?? []).map((s: any) => ({
      id: s.id as string,
      label: (s.label as string) ?? "",
      sort_order: Number(s.sort_order) || 0,
    })),
    jobs: jobs.map((j: any) => ({
      id: j.id as string,
      address: (j.address as string | null) ?? null,
      active: !!j.active,
      current_state_id: (j.current_state_id as string | null) ?? null,
      completed_date: jobCompletedDate(j),
      last_log_date: lastLogByJob.get(j.id as string) ?? null,
      original_estimate: j.original_estimate === null || j.original_estimate === undefined ? null : Number(j.original_estimate),
    })),
    hoursLogged,
    crewAssignments,
    loggedCrewIds: [...loggedCrewInPeriod],
    quickLogs,
  });

  await sb.from("weekly_reports").upsert(
    { location_id: locationId, period_start: periodStart, period_end: periodEnd, snapshot },
    { onConflict: "location_id,period_start" },
  );

  // Enqueue the owner email digest (deduped per period). Skipped when no owner contact is set.
  const recipient = (opts.ownerContactId ?? "").trim();
  if (recipient) {
    const base = (opts.appBaseUrl ?? "").trim();
    const previewUrl = base ? `${base.replace(/\/$/, "")}/reports/weekly-preview` : "";
    const { error: insErr } = await sb.from("scheduled_notifications").insert({
      location_id: locationId,
      channel: "email",
      recipient,
      template_key: "weekly_report_digest",
      payload: {
        company_name: opts.companyName ?? "",
        period_start: periodStart,
        period_end: periodEnd,
        preview_url: previewUrl,
        totals: snapshot.totals,
        active_by_phase: snapshot.active_by_phase.map((p) => ({ label: p.label, count: p.count })),
        completed: snapshot.completed.map((c) => ({ address: c.address })),
        stalled: snapshot.stalled.map((s) => ({ address: s.address, days_since: s.days_since })),
        coverage_gaps: snapshot.coverage_gaps.map((g) => ({ name: g.name })),
        unlinked_work: snapshot.unlinked_work.map((u) => ({ address: u.address, crew_name: u.crew_name, hours_worked: u.hours_worked })),
      },
      scheduled_for: now.toISOString(),
      dedupe_key: weeklyReportEmailDedupeKey(locationId, periodStart),
    });
    if (insErr && !String(insErr.message ?? insErr).toLowerCase().includes("duplicate")) throw insErr;
  }

  return snapshot;
}
