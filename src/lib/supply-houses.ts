import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type SupplyHouseRow = Database["public"]["Tables"]["supply_house_contacts"]["Row"];

export interface SupplyHousesResponse {
  supply_houses: SupplyHouseRow[];
  metrics: { total_count: number; active_count: number };
}

export interface SaveSupplyHousePayload {
  id?: string;
  name: string;
  rep_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email: string;
  account_number?: string | null;
  uptiq_contact_id?: string | null;
  notes?: string | null;
  active: boolean;
}

export function canManageSupplyHouses(role?: string | null) {
  return role === "dev_super" || role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function fetchSupplyHouses() {
  return callEdge("supply-houses") as Promise<SupplyHousesResponse>;
}

export function createSupplyHouse(payload: SaveSupplyHousePayload) {
  return callEdge("supply-houses", { method: "POST", body: payload }) as Promise<SupplyHousesResponse>;
}

export function updateSupplyHouse(payload: SaveSupplyHousePayload) {
  return callEdge("supply-houses", { method: "PATCH", body: payload }) as Promise<SupplyHousesResponse>;
}
