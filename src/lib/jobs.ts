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

export interface JobDetailResponse {
  job: JobSummary;
  states: JobState[];
  daily_logs: DailyLog[];
  purchase_orders: PurchaseOrder[];
  expenses: JobExpense[];
}

export interface SaveJobPayload {
  id?: string;
  address: string;
  current_state_id?: string | null;
  state_progress_pct?: number;
  job_completion_pct?: number;
  total_hours?: number;
  original_estimate?: number | null;
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

export function canManageJobs(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function currency(value: number | null | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "-";
}

export function shortDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
