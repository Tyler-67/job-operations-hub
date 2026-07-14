import { callEdge } from "@/lib/session";
import type { SupplyHouse } from "@/lib/expenses";

export interface SettingsLocation {
  id: string;
  uptiq_location_id: string;
  uptiq_company_id: string | null;
  company_name: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface CompanySettings {
  id: string;
  location_id: string;
  owner_name: string | null;
  owner_contact_id: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  office_contact_id: string | null;
  office_phone: string | null;
  office_email: string | null;
  check_in_send_time: string;
  check_in_weekdays: number[];
  inspection_reminder_time: string;
  weekly_report_day: number;
  weekly_report_time: string;
  review_request_delay_days: number;
  default_supply_house_contact_id: string | null;
  parts_cost_ceiling: number;
  supply_house_pickup_time: string | null;
  inspections_calendar_id: string | null;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_font: string;
  brand_logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsResponse {
  location: SettingsLocation;
  settings: CompanySettings;
  supply_houses: SupplyHouse[];
}

export interface SaveSettingsPayload {
  location: Pick<SettingsLocation, "company_name" | "timezone" | "uptiq_company_id">;
  settings: Partial<CompanySettings>;
}

export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export const WEEKLY_REPORT_DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

export const COMMON_TIMEZONES = [
  "America/Boise",
  "America/Denver",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function canManageSettings(role?: string | null) {
  return role === "owner_admin" || role === "office_manager" || role === "support_admin";
}

export function fetchSettings() {
  return callEdge("settings") as Promise<SettingsResponse>;
}

export function saveSettings(payload: SaveSettingsPayload) {
  return callEdge("settings", { method: "PATCH", body: payload }) as Promise<SettingsResponse>;
}

export type CronKey = "check-ins" | "inspection-reminders" | "drain" | "weekly-report";

export interface RunCronResult {
  ok: boolean;
  cron: string;
  status: number;
  result: Record<string, unknown>;
  // Enqueueing crons chain a drain so the button sends end-to-end; drain counts land here.
  drain?: { ok: boolean; status: number; result: Record<string, unknown> } | null;
}

// Testing tool: fire a scheduled cron on demand (server-side, secret stays on the server).
export function runCron(cron: CronKey) {
  return callEdge("settings", { method: "POST", body: { action: "run_cron", cron } }) as Promise<RunCronResult>;
}

export interface ContactsSyncResult {
  location: string;
  mode: string;
  dry_run: boolean;
  total_reachable: number;
  would_sync?: number;
  attempted?: number;
  linked?: number;
  not_found?: number;
  failed?: number;
  parties?: Array<{ key: string; name: string | null; email: string | null; phone: string | null; has_existing_id: boolean }>;
  results?: Array<{ key: string; ok: boolean; action?: string; contact_id?: string; error?: string }>;
}

// Contacts sync — READ-ONLY (link) mode only: find each app party in Uptiq by email/phone and
// store the matching Uptiq contact id on the app record. No writes to Uptiq. dry_run previews
// the plan without any Uptiq calls. (Uptiq-write/upsert is intentionally not exposed here.)
export function syncContacts(opts: { dryRun?: boolean } = {}) {
  return callEdge("contacts-sync", { method: "POST", body: { mode: "link", dry_run: Boolean(opts.dryRun) } }) as unknown as Promise<ContactsSyncResult>;
}

export interface CrewPullResult {
  mode: string;
  tag: string;
  dry_run: boolean;
  scanned?: number;
  capped?: boolean;
  found: number;
  imported?: number;
  updated?: number;
  skipped?: number;
  contacts?: Array<{ id: string; name: string | null; email: string | null; phone: string | null }>;
  results?: Array<{ id: string; name: string | null; action: string; error?: string }>;
}

// Uptiq -> app PULL (read-only): import Uptiq contacts tagged `crew` as Daily Burn crew contacts.
export function pullCrew(opts: { dryRun?: boolean } = {}) {
  return callEdge("contacts-sync", { method: "POST", body: { mode: "pull_crew", tag: "crew", dry_run: Boolean(opts.dryRun) } }) as unknown as Promise<CrewPullResult>;
}

export function timeForInput(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

export function moneyLabel(value: number | null | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "-";
}
