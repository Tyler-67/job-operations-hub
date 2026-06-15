import { describe, it, expect } from "vitest";
import {
  buildWeeklyReportSnapshot,
  weeklyReportPeriod,
  weeklyReportDedupeKey,
  weeklyReportEmailDedupeKey,
  type WeeklyReportJobInput,
  type WeeklyReportStateInput,
} from "../../supabase/functions/_shared/weekly-report";

const STATES: WeeklyReportStateInput[] = [
  { id: "s-rough", label: "Rough-in", sort_order: 10 },
  { id: "s-finish", label: "Finish", sort_order: 20 },
  { id: "s-bill", label: "Complete", sort_order: 30 },
];

const NOW = new Date("2026-06-09T15:00:00.000Z");

describe("weeklyReportPeriod", () => {
  it("covers the trailing 7 days ending on (and including) the report date", () => {
    expect(weeklyReportPeriod("2026-06-09")).toEqual({ periodStart: "2026-06-03", periodEnd: "2026-06-09" });
  });

  it("crosses a month boundary correctly", () => {
    expect(weeklyReportPeriod("2026-07-02")).toEqual({ periodStart: "2026-06-26", periodEnd: "2026-07-02" });
  });
});

describe("dedupe keys", () => {
  it("are stable per location + period", () => {
    expect(weeklyReportDedupeKey("loc-1", "2026-06-03")).toBe("weekly_report:loc-1:2026-06-03");
    expect(weeklyReportEmailDedupeKey("loc-1", "2026-06-03")).toBe("notif:weekly_report:loc-1:2026-06-03");
  });
});

describe("buildWeeklyReportSnapshot", () => {
  const period = { periodStart: "2026-06-03", periodEnd: "2026-06-09" };

  function snap(jobs: WeeklyReportJobInput[], hoursLogged = 0) {
    return buildWeeklyReportSnapshot({ ...period, now: NOW, states: STATES, jobs, hoursLogged });
  }

  it("groups active jobs by phase ordered by sort_order", () => {
    const s = snap([
      { id: "j1", address: "A", active: true, current_state_id: "s-finish", completed_date: null, last_log_date: "2026-06-09", original_estimate: null },
      { id: "j2", address: "B", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-09", original_estimate: null },
      { id: "j3", address: "C", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-09", original_estimate: null },
    ]);
    expect(s.active_by_phase.map((p) => [p.label, p.count])).toEqual([
      ["Rough-in", 2],
      ["Finish", 1],
    ]);
    expect(s.totals.active_jobs).toBe(3);
  });

  it("lists jobs completed within the period and sums their estimates", () => {
    const s = snap([
      { id: "j1", address: "A", active: false, current_state_id: "s-bill", completed_date: "2026-06-05", last_log_date: "2026-06-04", original_estimate: 12000 },
      { id: "j2", address: "B", active: false, current_state_id: "s-bill", completed_date: "2026-05-30", last_log_date: "2026-05-29", original_estimate: 9000 }, // before window
      { id: "j3", address: "C", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-09", original_estimate: null },
    ]);
    expect(s.completed.map((c) => c.id)).toEqual(["j1"]);
    expect(s.totals.completed_jobs).toBe(1);
    expect(s.totals.completed_estimate_total).toBe(12000);
  });

  it("flags active jobs with a stale or missing last log as stalled with days_since", () => {
    const s = snap([
      { id: "fresh", address: "A", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-08", original_estimate: null },
      { id: "stale", address: "B", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-02", original_estimate: null },
      { id: "never", address: "C", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: null, original_estimate: null },
    ]);
    const stalledIds = s.stalled.map((j) => j.id);
    expect(stalledIds).toContain("stale");
    expect(stalledIds).toContain("never");
    expect(stalledIds).not.toContain("fresh");
    const stale = s.stalled.find((j) => j.id === "stale");
    expect(stale?.days_since).toBe(7);
    const never = s.stalled.find((j) => j.id === "never");
    expect(never?.days_since).toBeNull();
    expect(s.totals.stalled_jobs).toBe(2);
  });

  it("does not double-count a just-completed job as stalled, and excludes archived jobs from active", () => {
    const s = snap([
      { id: "done", address: "A", active: false, current_state_id: "s-bill", completed_date: "2026-06-06", last_log_date: "2026-06-01", original_estimate: 5000 },
    ]);
    expect(s.stalled).toHaveLength(0);
    expect(s.totals.active_jobs).toBe(0);
    expect(s.totals.completed_jobs).toBe(1);
  });

  it("passes hoursLogged through to totals", () => {
    const s = snap([], 42.5);
    expect(s.totals.hours_logged).toBe(42.5);
  });

  it("PAR-4: lists crew on an active job who logged nothing this week as coverage gaps", () => {
    const s = buildWeeklyReportSnapshot({
      ...period, now: NOW, states: STATES,
      jobs: [{ id: "j1", address: "A", active: true, current_state_id: "s-rough", completed_date: null, last_log_date: "2026-06-09", original_estimate: null }],
      hoursLogged: 0,
      crewAssignments: [
        { contact_id: "c-logged", name: "Bill", job_id: "j1", job_active: true },
        { contact_id: "c-silent", name: "Anna", job_id: "j1", job_active: true },
        { contact_id: "c-archived", name: "Zed", job_id: "j-old", job_active: false },
      ],
      loggedCrewIds: ["c-logged"],
      quickLogs: [],
    });
    expect(s.coverage_gaps.map((g) => g.name)).toEqual(["Anna"]); // Bill logged; Zed only on an inactive job
    expect(s.totals.coverage_gap_crew).toBe(1);
  });

  it("PAR-5: surfaces in-period quick-log rows as unlinked work, newest first", () => {
    const s = buildWeeklyReportSnapshot({
      ...period, now: NOW, states: STATES, jobs: [], hoursLogged: 0,
      crewAssignments: [], loggedCrewIds: [],
      quickLogs: [
        { daily_log_id: "q1", job_id: "j1", address: "A", crew_name: "Bill", log_date: "2026-06-04", hours_worked: 3 },
        { daily_log_id: "q2", job_id: "j2", address: "B", crew_name: "Anna", log_date: "2026-06-08", hours_worked: 5 },
        { daily_log_id: "q3", job_id: "j3", address: "C", crew_name: "Zed", log_date: "2026-05-30", hours_worked: 2 },
      ],
    });
    expect(s.unlinked_work.map((u) => u.daily_log_id)).toEqual(["q2", "q1"]);
    expect(s.totals.unlinked_logs).toBe(2);
  });
});
