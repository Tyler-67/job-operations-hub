import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type JobStateSet = Database["public"]["Tables"]["job_state_sets"]["Row"];
export type JobState = Database["public"]["Tables"]["job_states"]["Row"];
export type JobStateTransition = Database["public"]["Tables"]["job_state_transitions"]["Row"];

export interface JobStatesResponse {
  state_set: JobStateSet | null;
  states: JobState[];
  transitions: JobStateTransition[];
  active_job_counts: Record<string, number>;
  active_job_count?: number;
}

export interface SaveJobStatePayload {
  id?: string;
  label: string;
  slug?: string;
  sort_order: number;
  color: string;
  is_terminal: boolean;
  is_inspection: boolean;
  is_walkthrough: boolean;
  is_billing: boolean;
  allow_check_ins: boolean;
  active?: boolean;
}

export interface SaveTransitionPayload {
  from_state_id: string;
  to_state_id: string;
  trigger: string;
}

export function canManageJobStates(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function fetchJobStates(includeInactive = true) {
  return callEdge("job-states", { query: { include_inactive: includeInactive } }) as Promise<JobStatesResponse>;
}

export function createJobState(payload: SaveJobStatePayload) {
  return callEdge("job-states", { method: "POST", body: payload }) as Promise<JobStatesResponse>;
}

export function updateJobState(payload: SaveJobStatePayload) {
  return callEdge("job-states", { method: "PATCH", body: payload }) as Promise<JobStatesResponse>;
}

export function reorderJobStates(items: Array<{ id: string; sort_order: number }>) {
  return callEdge("job-states", { method: "PATCH", body: { action: "reorder", items } }) as Promise<JobStatesResponse>;
}

export function archiveJobState(id: string, reassignStateId?: string | null) {
  return callEdge("job-states", { method: "PATCH", body: { action: "archive", id, reassign_state_id: reassignStateId } }) as Promise<JobStatesResponse>;
}

export function createTransition(payload: SaveTransitionPayload) {
  return callEdge("job-states", { method: "POST", body: { action: "transition", ...payload } }) as Promise<JobStatesResponse>;
}

export function deleteTransition(id: string) {
  return callEdge("job-states", { method: "PATCH", body: { action: "delete_transition", id } }) as Promise<JobStatesResponse>;
}

export function slugFromLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
