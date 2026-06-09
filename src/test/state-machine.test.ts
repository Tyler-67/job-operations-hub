import { describe, it, expect } from "vitest";
import {
  conditionsMet,
  resolveTransition,
  type TransitionRow,
} from "../../supabase/functions/_shared/state-machine";

// Mirrors the seeded "Default Plumbing Template" transitions. State ids use slugs
// for readability; the resolver only compares ids by equality.
const PLUMBING: TransitionRow[] = [
  { id: "t1", from_state_id: "dirt_work", to_state_id: "dirt_work_inspection", trigger: "inspection_requested" },
  { id: "t2", from_state_id: "roughin", to_state_id: "roughin_inspection", trigger: "inspection_requested" },
  { id: "t3", from_state_id: "finish_work", to_state_id: "inspection", trigger: "inspection_requested" },
  { id: "t4", from_state_id: "dirt_work_inspection", to_state_id: "roughin", trigger: "pass" },
  { id: "t5", from_state_id: "roughin_inspection", to_state_id: "finish_work", trigger: "pass" },
  { id: "t6", from_state_id: "inspection", to_state_id: "walkthrough", trigger: "pass" },
  { id: "t7", from_state_id: "dirt_work_inspection", to_state_id: "dirt_work", trigger: "fail" },
  { id: "t8", from_state_id: "roughin_inspection", to_state_id: "roughin", trigger: "fail" },
  { id: "t9", from_state_id: "inspection", to_state_id: "finish_work", trigger: "fail" },
  { id: "t10", from_state_id: "finish_work", to_state_id: "walkthrough", trigger: "progress_100_owner_yes" },
  { id: "t11", from_state_id: "walkthrough", to_state_id: "complete", trigger: "walkthrough_approved" },
  { id: "t12", from_state_id: "complete", to_state_id: "paid", trigger: "manual" },
];

describe("resolveTransition", () => {
  it("advances each work state to its inspection on inspection_requested", () => {
    expect(resolveTransition(PLUMBING, "dirt_work", "inspection_requested")?.to_state_id).toBe("dirt_work_inspection");
    expect(resolveTransition(PLUMBING, "roughin", "inspection_requested")?.to_state_id).toBe("roughin_inspection");
    expect(resolveTransition(PLUMBING, "finish_work", "inspection_requested")?.to_state_id).toBe("inspection");
  });

  it("advances inspections forward on pass", () => {
    expect(resolveTransition(PLUMBING, "dirt_work_inspection", "pass")?.to_state_id).toBe("roughin");
    expect(resolveTransition(PLUMBING, "roughin_inspection", "pass")?.to_state_id).toBe("finish_work");
    expect(resolveTransition(PLUMBING, "inspection", "pass")?.to_state_id).toBe("walkthrough");
  });

  it("reverts inspections to their work state on fail", () => {
    expect(resolveTransition(PLUMBING, "dirt_work_inspection", "fail")?.to_state_id).toBe("dirt_work");
    expect(resolveTransition(PLUMBING, "roughin_inspection", "fail")?.to_state_id).toBe("roughin");
    expect(resolveTransition(PLUMBING, "inspection", "fail")?.to_state_id).toBe("finish_work");
  });

  it("moves finish_work to walkthrough only on owner-confirmed completion", () => {
    expect(resolveTransition(PLUMBING, "finish_work", "progress_100_owner_yes")?.to_state_id).toBe("walkthrough");
    expect(resolveTransition(PLUMBING, "walkthrough", "walkthrough_approved")?.to_state_id).toBe("complete");
  });

  it("returns null when no rule matches the from-state + trigger", () => {
    expect(resolveTransition(PLUMBING, "dirt_work", "pass")).toBeNull();
    expect(resolveTransition(PLUMBING, "complete", "inspection_requested")).toBeNull();
    expect(resolveTransition(PLUMBING, "paid", "manual")).toBeNull();
  });

  it("returns null for a missing from-state", () => {
    expect(resolveTransition(PLUMBING, null, "pass")).toBeNull();
    expect(resolveTransition(PLUMBING, undefined, "pass")).toBeNull();
  });

  it("does not match a trigger that is not configured", () => {
    expect(resolveTransition(PLUMBING, "dirt_work", "walkthrough_approved")).toBeNull();
  });
});

describe("conditionsMet", () => {
  it("passes when conditions are empty or absent", () => {
    expect(conditionsMet({}, { state_progress_pct: 40 })).toBe(true);
    expect(conditionsMet(null, {})).toBe(true);
    expect(conditionsMet(undefined, {})).toBe(true);
  });

  it("requires every condition key to match the context", () => {
    expect(conditionsMet({ state_progress_pct: 100 }, { state_progress_pct: 100 })).toBe(true);
    expect(conditionsMet({ state_progress_pct: 100 }, { state_progress_pct: 80 })).toBe(false);
    expect(conditionsMet({ state_progress_pct: 100 }, {})).toBe(false);
  });

  it("narrows transition selection by conditions", () => {
    const gated: TransitionRow[] = [
      { id: "g1", from_state_id: "finish_work", to_state_id: "walkthrough", trigger: "progress", conditions: { state_progress_pct: 100 } },
    ];
    expect(resolveTransition(gated, "finish_work", "progress", { state_progress_pct: 100 })?.to_state_id).toBe("walkthrough");
    expect(resolveTransition(gated, "finish_work", "progress", { state_progress_pct: 50 })).toBeNull();
  });
});
