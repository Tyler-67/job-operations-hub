import { describe, it, expect } from "vitest";
import { buildCompletionReportSnapshot } from "../../supabase/functions/_shared/completion-report";

const JOB = {
  id: "job-1",
  address: "1420 Canyon Rd",
  scope_of_work: "Rough-in + finish for the master bath.",
  notes: "[2026-06-08] Walkthrough punch list: caulk the tub.",
  start_date: "2026-05-01",
  job_completion_pct: 100,
  total_hours: "42.50",
  total_expenses: "1875.00",
  original_estimate: "2000",
};

describe("buildCompletionReportSnapshot", () => {
  it("assembles a snapshot with state, notes, coerced totals, and parties", () => {
    const snap = buildCompletionReportSnapshot(
      JOB,
      { slug: "complete", label: "Complete" },
      { name: "Dana Owner", phone: "+12085551212", uptiq_contact_id: "cust-1" },
      { name: "Lee Lead", phone: null, uptiq_contact_id: "crew-1" },
      "2026-06-09T17:00:00.000Z",
    );
    expect(snap).toMatchObject({
      generated_at: "2026-06-09T17:00:00.000Z",
      job_id: "job-1",
      address: "1420 Canyon Rd",
      final_state: { slug: "complete", label: "Complete" },
      notes: "[2026-06-08] Walkthrough punch list: caulk the tub.",
      completed_pct: 100,
      totals: { hours: 42.5, expenses: 1875, original_estimate: 2000 },
      customer: { name: "Dana Owner", uptiq_contact_id: "cust-1" },
      crew_lead: { name: "Lee Lead", uptiq_contact_id: "crew-1" },
    });
  });

  it("keeps a null original_estimate null and tolerates missing parties", () => {
    const snap = buildCompletionReportSnapshot(
      { ...JOB, original_estimate: null },
      { slug: "complete", label: "Complete" },
      null,
      null,
      "2026-06-09T17:00:00.000Z",
    );
    expect((snap.totals as any).original_estimate).toBeNull();
    expect(snap.customer).toBeNull();
    expect(snap.crew_lead).toBeNull();
  });
});
