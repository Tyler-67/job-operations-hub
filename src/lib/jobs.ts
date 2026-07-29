import { callEdge } from "@/lib/session";
import { isManager } from "@/lib/roles";
import { money, date } from "@/lib/format";
import type { Database } from "@/integrations/supabase/types";

export type JobState = Database["public"]["Tables"]["job_states"]["Row"];
export type PurchaseOrder = Database["public"]["Tables"]["purchase_orders"]["Row"];
export type JobExpense = Database["public"]["Tables"]["job_expenses"]["Row"];
export type DailyLog = Database["public"]["Tables"]["daily_logs"]["Row"];

export interface JobContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_lead?: boolean;
}

export interface CompletionReportParty {
  name: string;
  phone: string | null;
  uptiq_contact_id: string | null;
}

// Snapshot written to jobs.completion_report when a job is approved into a billing state
// (see supabase/functions/_shared/completion-report.ts). Null until the job closes.
export interface CompletionReport {
  generated_at: string;
  job_id: string;
  address: string;
  final_state: { slug: string; label: string };
  scope_of_work: string | null;
  notes: string | null;
  start_date: string | null;
  completed_pct: number;
  totals: { hours: number; expenses: number; original_estimate: number | null };
  customer: CompletionReportParty | null;
  crew_lead: CompletionReportParty | null;
}

export interface JobSummary {
  id: string;
  active: boolean;
  address: string;
  current_state_id: string | null;
  state_set_id: string;
  state_progress_pct: number;
  job_completion_pct: number;
  total_hours: number;
  total_expenses: number;
  total_field_purchase_expenses: number;
  total_po_expenses: number;
  original_estimate: number | null;
  start_date: string | null;
  scope_of_work: string | null;
  notes: string | null;
  inspection_date: string | null;
  // Active inspection request (inspection-as-a-tag stages): stamped by the crew's ready
  // check-in / the office Request-inspection toggle; null when no cycle is pending.
  inspection_requested_at: string | null;
  walkthrough_date: string | null;
  latest_po: string | null;
  completion_report: CompletionReport | null;
  paid_at: string | null;
  paid_source: string | null;
  paid_by_app_user_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  payment_event_id: string | null;
  payment_notes: string | null;
  updated_at: string;
  current_state: JobState | null;
  customers: JobContact[];
  crew: JobContact[];
  purchase_orders: PurchaseOrder[];
  expenses: JobExpense[];
  last_log_date: string | null;
}

export interface JobsResponse {
  jobs: JobSummary[];
  states: JobState[];
  default_state_set_id: string | null;
}

// Parse a date-only string ("YYYY-MM-DD") as a LOCAL calendar date at midnight. last_log_date is
// date-only; new Date() reads it as UTC midnight, which is the PRIOR day in US timezones — that
// mis-flagged a same-day check-in as overdue (fixed on the Dashboard in db6c441; JobsList had
// reintroduced it with a private copy, so the predicates live here now, shared).
function localMidnight(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Whole days a check-in-eligible job is overdue: undefined = not eligible (terminal / no check-ins),
// null = eligible but never logged, 0 = logged today (not overdue), N = last log N days ago.
export function checkInOverdueDays(job: Pick<JobSummary, "current_state" | "last_log_date">): number | null | undefined {
  if (!job.current_state?.allow_check_ins || job.current_state?.is_terminal) return undefined;
  if (!job.last_log_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - localMidnight(job.last_log_date).getTime()) / 86_400_000);
}

export function needsCheckIn(job: Pick<JobSummary, "current_state" | "last_log_date">): boolean {
  const days = checkInOverdueDays(job);
  return days === null || (typeof days === "number" && days >= 1);
}

// Human overdue status for a pill/label: null when not overdue (or not eligible).
export function checkInStatus(job: Pick<JobSummary, "current_state" | "last_log_date">): string | null {
  const days = checkInOverdueDays(job);
  if (days === null) return "never checked in";
  if (typeof days === "number" && days >= 1) return days === 1 ? "1 day overdue" : `${days} days overdue`;
  return null;
}

// Whether the job has an ACTIVE inspection cycle. Tagged WORK stages (is_inspection with
// check-ins allowed) are inspection-capable the whole time the job sits in them — the cycle
// only becomes active once REQUESTED (crew ready check-in / office toggle) or scheduled.
// Dedicated inspection STATES (allow_check_ins=false) are only ever entered by a request, so
// being in one means active. Gates the inspection tag + pass/fail interfaces everywhere.
export function inspectionUnderway(job: Pick<JobSummary, "inspection_requested_at" | "inspection_date" | "current_state">): boolean {
  const st = job.current_state;
  if (!st?.is_inspection) return false;
  return Boolean(job.inspection_requested_at || job.inspection_date || st.allow_check_ins === false);
}

// Result of syncing a job's inspection to the Uptiq inspections calendar. Present on a job
// create/save response only when the inspection date was set or changed on that request.
export interface InspectionCalendarSync {
  ok: boolean;
  action: "created" | "updated" | "skipped_no_calendar" | "skipped_no_date" | "failed";
  status?: number;
  error?: string;
  detail?: string;
  appointment_id?: string | null;
}

export interface JobDetailResponse {
  job: JobSummary;
  states: JobState[];
  daily_logs: DailyLog[];
  purchase_orders: PurchaseOrder[];
  expenses: JobExpense[];
  calendar?: InspectionCalendarSync;
  // Present only on an inspection-toggle save: whether the owner's date-ask actually went out
  // (false = marked requested but no owner messaging contact is configured).
  inspection_ask_sent?: boolean;
}

export interface SaveJobPayload {
  id?: string;
  address: string;
  current_state_id?: string | null;
  state_progress_pct?: number;
  job_completion_pct?: number;
  total_hours?: number;
  original_estimate?: number | null;
  invoice_number?: string | null;
  start_date?: string | null;
  inspection_date?: string | null;
  inspection_slot?: string;
  walkthrough_slot?: string;
  walkthrough_date?: string | null;
  scope_of_work?: string | null;
  notes?: string | null;
  active?: boolean;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  crew_names?: string[];
  crew_lead_name?: string;
}

export interface MarkJobPaidPayload {
  invoice_id?: string | null;
  invoice_number?: string | null;
  payment_notes?: string | null;
}

export async function fetchJobs(includeArchived = false) {
  return callEdge("jobs", { query: { include_archived: includeArchived } }) as Promise<JobsResponse>;
}

export async function fetchJob(id: string) {
  return callEdge("jobs", { query: { id } }) as Promise<JobDetailResponse>;
}

export async function createJob(payload: SaveJobPayload) {
  return callEdge("jobs", { body: payload, method: "POST" }) as Promise<JobDetailResponse>;
}

export async function updateJob(id: string, payload: SaveJobPayload) {
  return callEdge("jobs", { body: { ...payload, id }, method: "POST" }) as Promise<JobDetailResponse>;
}

// Inspection toggle (tag-model stages) — sent ALONE, never as part of a save: true starts a
// cycle (voids any stale date + texts the owner the date link), false cancels it (clears the
// request + date, cancels the calendar appointment). The response's inspection_ask_sent says
// whether the owner text actually went out.
export async function setJobInspectionRequested(id: string, requested: boolean) {
  return callEdge("jobs", { body: { id, inspection_requested: requested }, method: "POST" }) as Promise<JobDetailResponse>;
}

export async function markJobPaid(id: string, payload: MarkJobPaidPayload = {}) {
  return callEdge("jobs", {
    body: { action: "mark_paid", id, paid_source: "manual", ...payload },
    method: "PATCH",
  }) as Promise<JobDetailResponse>;
}

// The inspection/walkthrough decisions an office manager can "push through" from the
// job page — the same actions the owner/crew fire by tapping an SMS link. The backend
// (jobs fire_decision -> shared applyDecision) runs the identical spine either way.
export type JobDecisionAction =
  | "inspection_pass"
  | "inspection_fail"
  | "finish_walkthrough_yes"
  | "walkthrough_approve"
  | "walkthrough_punch_list"
  | "walkthrough_reschedule"
  | "walkthrough_still_issues";

export interface FireDecisionResponse extends JobDetailResponse {
  decision: {
    changed: boolean;
    to_state_id: string | null;
    // Why the state didn't move, when changed is false (e.g. no_matching_transition for an
    // acknowledge-only decision, or if fired against a state that doesn't accept it).
    reason: string | null;
    enqueued: number;
    walkthrough_asked: boolean;
    completion_report_built: boolean;
    review_request_queued: boolean;
  };
}

export async function fireJobDecision(id: string, decisionAction: JobDecisionAction) {
  return callEdge("jobs", {
    body: { action: "fire_decision", id, decision_action: decisionAction },
    method: "PATCH",
  }) as Promise<FireDecisionResponse>;
}

export interface JobDeleteResult {
  ok: boolean;
  dry_run: boolean;
  deleted?: boolean;
  job: { id: string; address: string | null };
  counts: { daily_logs: number; expenses: number; purchase_orders: number; notifications: number };
}

// DEBUG: hard-delete a job and everything under it (logs, expenses, POs, notifications, tokens,
// crew/customer links, and its event-log entries). dryRun previews the child counts without
// deleting. Only works while the company's debug_mode is on — a testing reset, not Archive.
export function deleteJob(id: string, dryRun: boolean) {
  return callEdge("jobs", {
    body: { action: "delete_job", id, dry_run: dryRun },
    method: "PATCH",
  }) as Promise<JobDeleteResult>;
}

export const canManageJobs = isManager;

export const currency = (value: number | null | undefined) => money(value);
export const shortDate = date;
