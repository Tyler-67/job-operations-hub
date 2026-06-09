import { describe, it, expect } from "vitest";
import {
  isValidIsoDate,
  normalizeInspectionDateInput,
  buildAppointmentTimes,
  slotHour,
  slotLabel,
} from "../../supabase/functions/_shared/inspection";

describe("isValidIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(isValidIsoDate("2026-06-12")).toBe(true);
  });
  it("rejects the wrong shape", () => {
    expect(isValidIsoDate("06/12/2026")).toBe(false);
    expect(isValidIsoDate("2026-6-2")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate(20260612)).toBe(false);
  });
  it("rejects impossible days that JS would roll over", () => {
    expect(isValidIsoDate("2026-13-40")).toBe(false);
    expect(isValidIsoDate("2026-06-31")).toBe(false);
  });
});

describe("normalizeInspectionDateInput", () => {
  it("keeps a valid date and explicit afternoon slot", () => {
    expect(normalizeInspectionDateInput({ inspection_date: " 2026-06-12 ", slot: "1pm" }))
      .toEqual({ inspectionDate: "2026-06-12", slot: "1pm" });
  });
  it("nulls a garbage date and defaults the slot to the morning window", () => {
    expect(normalizeInspectionDateInput({ inspection_date: "next tuesday", slot: "whenever" }))
      .toEqual({ inspectionDate: null, slot: "9am" });
  });
  it("nulls a missing date", () => {
    expect(normalizeInspectionDateInput({}).inspectionDate).toBeNull();
  });
});

describe("buildAppointmentTimes", () => {
  it("makes a 9-10 window for the morning slot", () => {
    expect(buildAppointmentTimes("2026-06-12", "9am")).toEqual({
      startLocal: "2026-06-12T09:00:00",
      endLocal: "2026-06-12T10:00:00",
    });
  });
  it("makes a 13-14 window for the afternoon slot", () => {
    expect(buildAppointmentTimes("2026-06-12", "1pm")).toEqual({
      startLocal: "2026-06-12T13:00:00",
      endLocal: "2026-06-12T14:00:00",
    });
  });
});

describe("slot helpers", () => {
  it("maps slots to their hour and label", () => {
    expect(slotHour("9am")).toBe(9);
    expect(slotHour("1pm")).toBe(13);
    expect(slotLabel("9am")).toBe("9:00 AM");
    expect(slotLabel("1pm")).toBe("1:00 PM");
  });
});
