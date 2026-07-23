// API client for the Developer console (dev_super only — the backend re-checks the fresh
// role on every call; the FE gate is cosmetic).
import { callEdge } from "@/lib/session";

export interface InstanceMetrics {
  users_active: number;
  contacts: number;
  jobs_active: number;
  jobs_total: number;
  notif_pending: number;
  notif_failed: number;
  sent_24h: number;
}

export interface DevInstance {
  id: string;
  company_name: string;
  timezone: string;
  uptiq_location_id: string;
  uptiq_sync_location_id: string | null;
  app_base_url: string | null;
  created_at: string;
  metrics: InstanceMetrics;
}

export interface DevOverview {
  instances: DevInstance[];
  crons: Record<string, string | null>;
}

export interface InstanceDraft {
  company_name: string;
  timezone: string;
  uptiq_location_id: string;
  app_base_url: string;
  uptiq_sync_location_id: string;
  clone_states_from?: string;
}

export function canUseDevConsole(role?: string | null) {
  return role === "dev_super";
}

export async function fetchDevOverview(): Promise<DevOverview> {
  return await callEdge("dev-console") as unknown as DevOverview;
}

export async function createInstance(draft: InstanceDraft): Promise<DevOverview> {
  return await callEdge("dev-console", { body: { action: "create_instance", ...draft } }) as unknown as DevOverview;
}

export async function updateInstance(locationId: string, patch: Partial<InstanceDraft>): Promise<DevOverview> {
  return await callEdge("dev-console", { body: { action: "update_instance", location_id: locationId, ...patch } }) as unknown as DevOverview;
}

export async function deleteInstance(locationId: string): Promise<DevOverview> {
  return await callEdge("dev-console", { body: { action: "delete_instance", location_id: locationId } }) as unknown as DevOverview;
}
