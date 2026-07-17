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
  debug_mode: boolean;
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
  return role === "dev_super" || role === "owner_admin" || role === "office_manager" || role === "support_admin";
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

export interface RunCronsResult {
  ok: boolean;
  crons: Array<{ cron: string; ok: boolean; status: number; result: Record<string, unknown> }>;
  // A single drain runs after the selected send-crons so their queued messages go out end-to-end.
  drain?: { ok: boolean; status: number; result: Record<string, unknown> } | null;
}

// Testing tool: fire several crons in one press — each selected send-cron is forced past its
// schedule gate, then ONE drain sends everything they queued. The CRON_SECRET stays server-side.
export function runCrons(crons: CronKey[]) {
  return callEdge("settings", { method: "POST", body: { action: "run_crons", crons } }) as Promise<RunCronsResult>;
}

// Debug data reset: the clearable categories of accumulated test data. Jobs + Uptiq conversation
// threads have their own debug tools. Order here is display order; the backend enforces its own
// dependency order.
export const CLEAR_DATA_CATEGORIES = [
  { key: "notifications", label: "Notification queue + history" },
  { key: "event_log", label: "Event log (diagnostics)" },
  { key: "action_tokens", label: "SMS action tokens (unclaimed links)" },
  { key: "weekly_reports", label: "Weekly report snapshots (lets this period re-send)" },
  { key: "conversation_backups", label: "Conversation backups" },
  { key: "contacts", label: "Contacts (skips any with job history)" },
  { key: "supply_houses", label: "Supply houses (skips any referenced by POs)" },
] as const;
export type ClearDataCategory = (typeof CLEAR_DATA_CATEGORIES)[number]["key"];

export interface ClearDataResult {
  ok: boolean;
  dry_run: boolean;
  results: Array<{ category: ClearDataCategory; count?: number; deleted?: number; blocked?: number }>;
}

// owner_admin / support_admin + debug_mode only (enforced server-side too).
export function clearData(categories: ClearDataCategory[], dryRun: boolean) {
  return callEdge("settings", {
    method: "POST",
    body: { action: "clear_data", categories, dry_run: dryRun },
  }) as Promise<ClearDataResult>;
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

export interface ContactsPullResult {
  location?: string;
  mode: string;
  dry_run: boolean;
  scanned?: number;
  capped?: boolean;
  // Tag-derived role breakdown (includes an "unrecognized" bucket for skipped contacts).
  by_role?: Record<string, number>;
  would_import?: number;
  preview?: Array<{ id: string; name: string | null; role: string; tags: string[] }>;
  unrecognized?: Array<{ name: string | null; email: string | null; tags: string[] }>;
  contacts_imported?: number;
  contacts_updated?: number;
  supply_imported?: number;
  supply_updated?: number;
  supply_linked?: number;
  skipped?: number;
  errors?: Array<{ id?: string; where?: string; error?: string }>;
}

export interface UptiqSyncResult {
  location?: string;
  mode: string;
  dry_run: boolean;
  pull: ContactsPullResult;
  link: ContactsSyncResult;
}

// THE Uptiq contact sync — ONE command, two steps server-side. Step 1 (pull) imports every
// tagged Uptiq contact into the app contacts table by role (crew/customer/owner/office/
// supply_house), repairing stale links (the pull is the id authority; supply houses also land
// in the Supply Houses ordering table). Step 2 (link) finds any app party still missing a Uptiq
// id by email/phone and stores it — never overwriting an existing id. Read-only in Uptiq,
// additive; dry_run previews both steps without writing anything.
export function syncWithUptiq(opts: { dryRun?: boolean } = {}) {
  return callEdge("contacts-sync", { method: "POST", body: { mode: "sync", dry_run: Boolean(opts.dryRun) } }) as unknown as Promise<UptiqSyncResult>;
}

export function timeForInput(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

export function moneyLabel(value: number | null | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "-";
}
