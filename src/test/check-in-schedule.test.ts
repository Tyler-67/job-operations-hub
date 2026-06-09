import { describe, it, expect } from "vitest";
import { localContext, sendHourOf, shouldSendNow } from "../../supabase/functions/_shared/check-in-schedule";

describe("sendHourOf", () => {
  it("parses HH:MM:SS and HH:MM", () => {
    expect(sendHourOf("15:00:00")).toBe(15);
    expect(sendHourOf("07:30")).toBe(7);
    expect(sendHourOf("00:00:00")).toBe(0);
  });
  it("rejects non-strings and out-of-range hours", () => {
    expect(sendHourOf(null)).toBeNull();
    expect(sendHourOf(15)).toBeNull();
    expect(sendHourOf("24:00")).toBeNull();
    expect(sendHourOf("nope")).toBeNull();
  });
});

describe("localContext", () => {
  // 2026-06-09T21:00:00Z is a Tuesday. In America/Boise (MDT, UTC-6 in summer) that is
  // 15:00 local, still Tuesday. In UTC it's hour 21.
  const utc9pmTue = new Date("2026-06-09T21:00:00Z");

  it("resolves the local hour/weekday/date for a zone behind UTC", () => {
    const ctx = localContext("America/Boise", utc9pmTue);
    expect(ctx.hour).toBe(15);
    expect(ctx.weekday).toBe(2); // Tuesday
    expect(ctx.date).toBe("2026-06-09");
  });

  it("rolls the local date/weekday back across the UTC midnight boundary", () => {
    // 2026-06-09T02:00:00Z is Tuesday in UTC, but 20:00 MON in America/Boise (UTC-6).
    const ctx = localContext("America/Boise", new Date("2026-06-09T02:00:00Z"));
    expect(ctx.hour).toBe(20);
    expect(ctx.weekday).toBe(1); // Monday
    expect(ctx.date).toBe("2026-06-08");
  });

  it("reports UTC unchanged for the UTC zone", () => {
    const ctx = localContext("UTC", utc9pmTue);
    expect(ctx.hour).toBe(21);
    expect(ctx.weekday).toBe(2);
    expect(ctx.date).toBe("2026-06-09");
  });
});

describe("shouldSendNow", () => {
  const tuesday3pmUtcForBoise = new Date("2026-06-09T21:00:00Z"); // 15:00 Tue in Boise

  it("fires when local hour matches send-time and local weekday is enabled", () => {
    expect(shouldSendNow(
      { timeZone: "America/Boise", sendTime: "15:00:00", weekdays: [1, 2, 3, 4, 5] },
      tuesday3pmUtcForBoise,
    )).toBe(true);
  });

  it("does not fire on the wrong hour", () => {
    expect(shouldSendNow(
      { timeZone: "America/Boise", sendTime: "16:00:00", weekdays: [1, 2, 3, 4, 5] },
      tuesday3pmUtcForBoise,
    )).toBe(false);
  });

  it("does not fire when the local weekday is excluded", () => {
    expect(shouldSendNow(
      { timeZone: "America/Boise", sendTime: "15:00:00", weekdays: [6, 7] },
      tuesday3pmUtcForBoise,
    )).toBe(false);
  });

  it("does not fire when the send-time is unparseable", () => {
    expect(shouldSendNow(
      { timeZone: "America/Boise", sendTime: null, weekdays: [1, 2, 3, 4, 5] },
      tuesday3pmUtcForBoise,
    )).toBe(false);
  });
});
