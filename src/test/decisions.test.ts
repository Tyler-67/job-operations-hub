import { describe, it, expect } from "vitest";
import { resolveDecision, followupDedupeKey } from "../../supabase/functions/_shared/decisions";

describe("resolveDecision", () => {
  it("maps inspection_pass to the pass trigger, notifying owner then crew_lead by SMS", () => {
    const d = resolveDecision("inspection_pass");
    expect(d).not.toBeNull();
    expect(d!.trigger).toBe("pass");
    expect(d!.followups).toEqual([
      { audience: "owner", channel: "sms", template_key: "decision_outcome" },
      { audience: "crew_lead", channel: "sms", template_key: "decision_outcome" },
    ]);
  });

  it("maps inspection_fail to the fail trigger, notifying owner and crew_lead", () => {
    const d = resolveDecision("inspection_fail")!;
    expect(d.trigger).toBe("fail");
    expect(d.followups.map((f) => f.audience)).toEqual(["owner", "crew_lead"]);
  });

  it("maps finish_walkthrough_yes to the progress_100_owner_yes trigger", () => {
    expect(resolveDecision("finish_walkthrough_yes")!.trigger).toBe("progress_100_owner_yes");
  });

  it("maps finish_walkthrough_no to an acknowledge-only decision (no trigger, no followups)", () => {
    const d = resolveDecision("finish_walkthrough_no")!;
    expect(d.trigger).toBeNull();
    expect(d.followups).toEqual([]);
  });

  it("maps walkthrough_approve to walkthrough_approved with an office followup", () => {
    const d = resolveDecision("walkthrough_approve")!;
    expect(d.trigger).toBe("walkthrough_approved");
    expect(d.followups[0].audience).toBe("office");
  });

  it("maps walkthrough_punch_list to an acknowledge-only decision handing the owner a form link", () => {
    const d = resolveDecision("walkthrough_punch_list")!;
    expect(d.trigger).toBeNull();
    expect(d.followups[0].audience).toBe("owner");
    expect(d.followups[0].link).toEqual({
      action: "walkthrough_punch_details",
      path: "/forms/walkthrough-punch-list",
    });
  });

  it("returns null for an unknown action", () => {
    expect(resolveDecision("not_a_decision")).toBeNull();
  });
});

describe("followupDedupeKey", () => {
  it("is stable and namespaced by action + job + audience", () => {
    expect(followupDedupeKey("inspection_pass", "job-1", "crew_lead")).toBe(
      "decision_followup:inspection_pass:job-1:crew_lead",
    );
  });

  it("distinguishes audiences for the same action and job", () => {
    expect(followupDedupeKey("walkthrough_approve", "job-9", "office")).not.toBe(
      followupDedupeKey("walkthrough_approve", "job-9", "owner"),
    );
  });
});
