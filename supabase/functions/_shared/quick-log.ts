// Pure, I/O-free helpers for the SMS quick-log flow. No Deno or remote imports so the
// parsing/normalization rules are unit-testable under vitest. Two concerns live here:
//   1. parseInboundSms  — pull the sender + keyword out of the raw Uptiq inbound webhook
//   2. normalizeQuickLogInput — bound the untrusted quick-log form body to typed fields
// The edge functions (inbound-sms, forms-quick-log) do the DB writes; everything here is
// a deterministic transform.

// Keywords (first word of the text, case-insensitive) that request a quick-log link.
export const QUICK_LOG_KEYWORDS = ["LOG"];

export interface ParsedInboundSms {
  messageId: string;
  text: string;
  keyword: string; // first word, uppercased
  fromContactId: string | null;
  fromPhone: string | null; // normalized to last-10 digits, or null
}

function str(value: unknown): string | null {
  const t = typeof value === "string" ? value.trim() : "";
  return t.length ? t : null;
}

// Reduces a phone to its last 10 digits so "+1 (415) 555-0100", "14155550100" and
// "415-555-0100" all match the same contact. Returns null when fewer than 10 digits.
export function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// Uptiq's inbound-message webhook carries the body under "body" (older payloads used
// "message"); the sender is identified by "contactId", with "phone" as a fallback when
// the contact id is absent. messageId keys the reply's dedupe.
export function parseInboundSms(body: Record<string, unknown>): ParsedInboundSms {
  const text = String((body.body ?? body.message ?? "") as unknown).trim();
  const keyword = (text.split(/\s+/)[0] ?? "").toUpperCase();
  return {
    messageId: str(body.messageId) ?? str(body.id) ?? "",
    text,
    keyword,
    fromContactId: str(body.contactId),
    fromPhone: normalizePhone(body.phone),
  };
}

export function isQuickLogKeyword(keyword: string): boolean {
  return QUICK_LOG_KEYWORDS.includes((keyword ?? "").toUpperCase());
}

// Stable dedupe so the same inbound message never enqueues two reply links.
export function quickLogLinkDedupeKey(messageId: string): string {
  return `notif:quick_log_link:${messageId}`;
}

export interface QuickLogInput {
  logDate: string;
  jobId: string | null;
  hoursWorked: number | null;
  stateProgressPct: number | null;
  note: string | null;
}

// Today as YYYY-MM-DD (UTC); used when the form omits log_date.
export function quickLogToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function clampPct(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, num);
}

// Normalizes the untrusted quick-log form body into typed, bounded fields. job_id is the
// crew member's chosen job (validated against their crew membership by the handler).
export function normalizeQuickLogInput(
  body: Record<string, unknown>,
  fallbackLogDate: string = quickLogToday(),
): QuickLogInput {
  return {
    logDate: str(body.log_date) ?? fallbackLogDate,
    jobId: str(body.job_id),
    hoursWorked: nonNegativeNumber(body.hours_worked),
    stateProgressPct: clampPct(body.state_progress_pct),
    note: str(body.note),
  };
}

// Maps normalized input to the daily_logs column shape (minus job_id/crew_contact_id/
// state_id, which the handler supplies). A quick log never carries parts or photos, so
// parts_source is pinned to "none" and the free-text note lands in issues.
export function buildQuickLogLogFields(input: QuickLogInput): Record<string, unknown> {
  return {
    log_date: input.logDate,
    hours_worked: input.hoursWorked,
    state_progress_pct: input.stateProgressPct,
    parts_source: "none",
    issues: input.note,
  };
}
