// Single source for display formatting. `date` parses date-only "YYYY-MM-DD" strings as a LOCAL
// calendar date: new Date("YYYY-MM-DD") is UTC midnight, which renders the PRIOR day in US
// (negative-offset) timezones — an off-by-one. Full timestamps fall through and render as-is.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function money(value: number | null | undefined, opts: { cents?: boolean } = {}): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: opts.cents ? 2 : 0 }).format(value)
    : "-";
}

export function date(value: string | null | undefined): string {
  if (!value) return "-";
  const m = DATE_ONLY.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  return new Date(value).toLocaleDateString();
}

export function timeInput(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "";
}
