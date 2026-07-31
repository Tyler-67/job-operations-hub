import { describe, it, expect } from "vitest";
import { checkInOverdueDays, needsCheckIn, checkInStatus, inspectionUnderway } from "@/lib/jobs";

// last_log_date is DATE-ONLY ("YYYY-MM-DD"). The regression this guards: parsing it with
// new Date() yields UTC midnight — the PRIOR day in US timezones — so a check-in submitted
// TODAY read as overdue. Bitten twice (Dashboard db6c441, then JobsList's private copy), so
// the predicates are single-sourced in src/lib/jobs.ts and pinned here.
function localDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const workState = { allow_check_ins: true, is_terminal: false, is_inspection: false } as never;
const job = (last: string | null, state: object | null = workState) =>
  ({ last_log_date: last, current_state: state } as never);

describe("checkInOverdueDays / needsCheckIn", () => {
  it("a check-in logged TODAY is not overdue (the UTC-midnight regression)", () => {
    expect(checkInOverdueDays(job(localDateString(0)))).toBe(0);
    expect(needsCheckIn(job(localDateString(0)))).toBe(false);
    expect(checkInStatus(job(localDateString(0)))).toBeNull();
  });

  it("yesterday's log is 1 day overdue", () => {
    expect(checkInOverdueDays(job(localDateString(1)))).toBe(1);
    expect(needsCheckIn(job(localDateString(1)))).toBe(true);
    expect(checkInStatus(job(localDateString(1)))).toBe("1 day overdue");
  });

  it("never logged is NOT an action (per Tyler 2026-07-31) — days stays null for display", () => {
    expect(checkInOverdueDays(job(null))).toBeNull();
    expect(needsCheckIn(job(null))).toBe(false);
    expect(checkInStatus(job(null))).toBeNull();
  });

  it("ineligible states (terminal / no check-ins) are never overdue", () => {
    const terminal = { allow_check_ins: false, is_terminal: true } as never;
    expect(checkInOverdueDays(job(null, terminal))).toBeUndefined();
    expect(needsCheckIn(job(null, terminal))).toBe(false);
  });
});

describe("inspectionUnderway", () => {
  const tagged = { is_inspection: true, allow_check_ins: true } as never;
  const dedicated = { is_inspection: true, allow_check_ins: false } as never;
  const mk = (state: object | null, req: string | null = null, date: string | null = null) =>
    ({ current_state: state, inspection_requested_at: req, inspection_date: date } as never);

  it("a tagged work stage alone is NOT underway — it needs a request or a date", () => {
    expect(inspectionUnderway(mk(tagged))).toBe(false);
    expect(inspectionUnderway(mk(tagged, "2026-07-29T00:00:00Z"))).toBe(true);
    expect(inspectionUnderway(mk(tagged, null, "2026-07-30"))).toBe(true);
  });

  it("a dedicated inspection state is always underway; non-inspection states never are", () => {
    expect(inspectionUnderway(mk(dedicated))).toBe(true);
    expect(inspectionUnderway(mk(workState))).toBe(false);
    expect(inspectionUnderway(mk(null))).toBe(false);
  });
});
