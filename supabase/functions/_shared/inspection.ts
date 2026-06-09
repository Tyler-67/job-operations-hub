// Pure, I/O-free helpers for the inspection-date entry flow. No Deno or remote imports
// so the parsing/slot math is unit-testable under vitest. The edge function
// (forms-inspection-date) does the DB write + Uptiq calendar call; everything here is a
// deterministic transform of the raw form body.

// The owner picks one of two fixed inspection windows. Kept abstract (label + hour) so
// the form, the appointment, and the notification copy all read from one source.
export type InspectionSlot = "9am" | "1pm";

const SLOT_HOURS: Record<InspectionSlot, number> = { "9am": 9, "1pm": 13 };
const SLOT_LABELS: Record<InspectionSlot, string> = { "9am": "9:00 AM", "1pm": "1:00 PM" };

export interface InspectionDateInput {
  // Validated YYYY-MM-DD, or null when the body omits/garbles it (the function 422s).
  inspectionDate: string | null;
  slot: InspectionSlot;
}

// Accepts only a real calendar date in YYYY-MM-DD form. The regex pins the shape and
// Date.parse rejects impossible days (e.g. 2026-13-40), so a garbage value can't slip
// through to the jobs.inspection_date write.
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Guard the JS month rollover (Date.parse can normalize 2026-06-31 → Jul 1).
  return new Date(t).toISOString().slice(0, 10) === value;
}

// Normalizes the untrusted form body. Unknown slot falls back to the morning window —
// never an error, so a malformed slot can't block a valid date submission.
export function normalizeInspectionDateInput(body: Record<string, unknown>): InspectionDateInput {
  const raw = typeof body.inspection_date === "string" ? body.inspection_date.trim() : "";
  return {
    inspectionDate: isValidIsoDate(raw) ? raw : null,
    slot: body.slot === "1pm" ? "1pm" : "9am",
  };
}

export function slotHour(slot: InspectionSlot): number {
  return SLOT_HOURS[slot];
}

export function slotLabel(slot: InspectionSlot): string {
  return SLOT_LABELS[slot];
}

// Wall-clock start/end (1-hour window) as zone-less ISO strings, e.g.
// { startLocal: "2026-06-12T09:00:00", endLocal: "2026-06-12T10:00:00" }. The caller
// pairs these with the company's IANA timezone in the Uptiq appointment payload, so the
// zone is interpreted once at the boundary rather than baked into wall-clock math here.
export function buildAppointmentTimes(
  dateStr: string,
  slot: InspectionSlot,
): { startLocal: string; endLocal: string } {
  const h = SLOT_HOURS[slot];
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    startLocal: `${dateStr}T${pad(h)}:00:00`,
    endLocal: `${dateStr}T${pad(h + 1)}:00:00`,
  };
}
