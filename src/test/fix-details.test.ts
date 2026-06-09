import { describe, it, expect } from "vitest";
import { appendFixDetailsNote, normalizeFixDetailsInput } from "../../supabase/functions/_shared/fix-details";

describe("normalizeFixDetailsInput", () => {
  it("keeps trimmed non-empty details", () => {
    expect(normalizeFixDetailsInput({ details: "  Re-strap the vent stack  " }))
      .toEqual({ details: "Re-strap the vent stack" });
  });

  it("nulls blank or whitespace-only details", () => {
    expect(normalizeFixDetailsInput({ details: "   " })).toEqual({ details: null });
  });

  it("nulls missing or non-string details", () => {
    expect(normalizeFixDetailsInput({})).toEqual({ details: null });
    expect(normalizeFixDetailsInput({ details: 42 })).toEqual({ details: null });
  });
});

describe("appendFixDetailsNote", () => {
  it("starts the note when there are no prior notes", () => {
    expect(appendFixDetailsNote(null, "2026-06-09", "cap the tee"))
      .toBe("[2026-06-09] Inspection fixes: cap the tee");
  });

  it("appends below existing notes, preserving them", () => {
    expect(appendFixDetailsNote("Existing note.", "2026-06-09", "cap the tee"))
      .toBe("Existing note.\n[2026-06-09] Inspection fixes: cap the tee");
  });

  it("treats whitespace-only existing notes as empty", () => {
    expect(appendFixDetailsNote("   ", "2026-06-09", "cap the tee"))
      .toBe("[2026-06-09] Inspection fixes: cap the tee");
  });
});
