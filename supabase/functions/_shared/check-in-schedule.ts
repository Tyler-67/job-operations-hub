// Pure scheduling math for the hourly check-in cron: given a company's IANA timezone
// and send-time, decide whether "now" is the moment to send. Server time is UTC, so the
// company's local hour/weekday/date are resolved via Intl.DateTimeFormat — never the raw
// Date. No Deno/remote imports, so the eligibility gate is unit-testable under vitest.

// Mon=1 .. Sun=7, matching Postgres ISODOW and the check_in_weekdays default {1..5}.
const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export interface LocalContext {
  hour: number; // 0..23 in the company's local zone
  weekday: number; // 1..7 (Mon..Sun); 0 if unparseable
  date: string; // YYYY-MM-DD in the company's local zone, used for per-day dedupe
}

export function localContext(timeZone: string, now: Date): LocalContext {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    hour: Number(parts.hour),
    weekday: ISO_WEEKDAY[parts.weekday] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// "15:00:00" / "15:00" -> 15; null when not a valid 0..23 hour.
export function sendHourOf(time: unknown): number | null {
  if (typeof time !== "string") return null;
  const h = Number(time.split(":")[0]);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

// True when this hourly tick is the one that should send for the company.
export function shouldSendNow(
  opts: { timeZone: string; sendTime: unknown; weekdays: unknown },
  now: Date,
): boolean {
  const sendHour = sendHourOf(opts.sendTime);
  if (sendHour === null) return false;
  const { hour, weekday } = localContext(opts.timeZone, now);
  if (hour !== sendHour) return false;
  const weekdays = Array.isArray(opts.weekdays) ? opts.weekdays.map(Number) : [];
  return weekdays.includes(weekday);
}
