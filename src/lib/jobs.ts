import { callEdge } from "@/lib/session";
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

export function canManageJobs(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function currency(value: number | null | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "-";
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "-";
  // Date-only strings ("YYYY-MM-DD", e.g. job start/inspection/log dates) must render as a
  // local calendar date. `new Date("2026-07-13")` parses as UTC midnight, which displays the
  // PRIOR day in any negative-offset timezone (US zones) — an off-by-one. Build a local date
  // from the parts instead. Full timestamps (with time/zone) fall through and render as-is.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString();
  }
  return new Date(value).toLocaleDateString();
}
