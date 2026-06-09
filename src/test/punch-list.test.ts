import { describe, it, expect } from "vitest";
import { normalizePunchListInput, appendPunchListNote } from "../../supabase/functions/_shared/punch-list";

describe("normalizePunchListInput", () => {
  it("trims and keeps non-empty details", () => {
    expect(normalizePunchListInput({ details: "  caulk the tub; touch up paint  " }))
      .toEqual({ details: "caulk the tub; touch up paint" });
  });

  it("returns null for blank, whitespace, or missing details", () => {
    expect(normalizePunchListInput({ details: "   " }).details).toBeNull();
    expect(normalizePunchListInput({ details: "" }).details).toBeNull();
    expect(normalizePunchListInput({}).details).toBeNull();
    expect(normalizePunchListInput({ details: 42 }).details).toBeNull();
  });
});

describe("appendPunchListNote", () => {
  it("formats a dated punch-list line when there are no prior notes", () => {
    expect(appendPunchListNote(null, "2026-06-09", "re-hang the closet door"))
      .toBe("[2026-06-09] Walkthrough punch list: re-hang the closet door");
  });

  it("appends below existing notes, preserving them", () => {
    expect(appendPunchListNote("Prior note.", "2026-06-09", "fix grout"))
      .toBe("Prior note.\n[2026-06-09] Walkthrough punch list: fix grout");
  });
});
