import { callEdge } from "@/lib/session";
import type { Database } from "@/integrations/supabase/types";

export type JobExpense = Database["public"]["Tables"]["job_expenses"]["Row"];
export type PurchaseOrder = Database["public"]["Tables"]["purchase_orders"]["Row"];
export type SupplyHouse = Database["public"]["Tables"]["supply_house_contacts"]["Row"];
export type PoStatus = Database["public"]["Enums"]["po_status"];

export interface ExpenseJob {
  id: string;
  address: string;
  active: boolean;
  total_expenses: number;
  total_field_purchase_expenses: number;
  total_po_expenses: number;
  updated_at: string;
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  job: ExpenseJob | null;
  supply_house: SupplyHouse | null;
}

export interface JobExpenseWithDetails extends JobExpense {
  job: ExpenseJob | null;
}

export interface ExpensesResponse {
  jobs: ExpenseJob[];
  supply_houses: SupplyHouse[];
  purchase_orders: PurchaseOrderWithDetails[];
  expenses: JobExpenseWithDetails[];
  metrics: {
    active_job_count: number;
    pending_po_count: number;
    total_expenses: number;
    total_field_purchase_expenses: number;
    total_po_expenses: number;
  };
}

export interface SaveExpensePayload {
  id?: string;
  job_id: string;
  kind: "field_purchase" | "adjustment";
  amount: number;
  vendor?: string | null;
  description?: string | null;
  receipt_url?: string | null;
  parts_photo_url?: string | null;
}

export interface SavePurchaseOrderPayload {
  job_id: string;
  supply_house_id?: string | null;
  status?: Exclude<PoStatus, "valued">;
  estimated_amount?: number | null;
  description?: string | null;
}

export function canManageExpenses(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function fetchExpenses(includeArchived = false) {
  return callEdge("expenses", { query: { include_archived: includeArchived } }) as Promise<ExpensesResponse>;
}

export function createExpense(payload: SaveExpensePayload) {
  return callEdge("expenses", { method: "POST", body: payload }) as Promise<ExpensesResponse>;
}

export function updateExpense(payload: SaveExpensePayload) {
  return callEdge("expenses", { method: "PATCH", body: { action: "update_expense", ...payload } }) as Promise<ExpensesResponse>;
}

export function deleteExpense(id: string) {
  return callEdge("expenses", { method: "PATCH", body: { action: "delete_expense", id } }) as Promise<ExpensesResponse>;
}

export function createPurchaseOrder(payload: SavePurchaseOrderPayload) {
  return callEdge("expenses", { method: "POST", body: { action: "create_po", ...payload } }) as Promise<ExpensesResponse>;
}

export function valuePurchaseOrder(id: string, finalAmount: number, description?: string | null) {
  return callEdge("expenses", {
    method: "PATCH",
    body: { action: "value_po", id, final_amount: finalAmount, description },
  }) as Promise<ExpensesResponse>;
}

export function money(value: number | null | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
    : "-";
}

export function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
