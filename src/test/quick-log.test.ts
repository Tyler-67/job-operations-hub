import { describe, it, expect } from "vitest";
import {
  parseInboundSms,
  normalizePhone,
  isQuickLogKeyword,
  quickLogLinkDedupeKey,
  normalizeQuickLogInput,
  buildQuickLogLogFields,
} from "../../supabase/functions/_shared/quick-log";

describe("normalizePhone", () => {
  it("reduces varied formats to the last 10 digits", () => {
    expect(normalizePhone("+1 (415) 555-0100")).toBe("4155550100");
    expect(normalizePhone("14155550100")).toBe("4155550100");
    expect(normalizePhone("415-555-0100")).toBe("4155550100");
  });

  it("returns null for too-few digits or junk", () => {
    expect(normalizePhone("555-0100")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("parseInboundSms", () => {
  it("extracts the keyword, contact id, and message id from an Uptiq inbound payload", () => {
    const p = parseInboundSms({
      messageId: "msg-1",
      body: "LOG please",
      contactId: "ct-9",
      phone: "(415) 555-0100",
    });
    expect(p.keyword).toBe("LOG");
    expect(p.text).toBe("LOG please");
    expect(p.messageId).toBe("msg-1");
    expect(p.fromContactId).toBe("ct-9");
    expect(p.fromPhone).toBe("4155550100");
  });

  it("falls back to legacy 'message' and 'id' fields and lowercases nothing", () => {
    const p = parseInboundSms({ id: "x", message: "log" });
    expect(p.keyword).toBe("LOG");
    expect(p.messageId).toBe("x");
    expect(p.fromContactId).toBeNull();
    expect(p.fromPhone).toBeNull();
  });
});

describe("isQuickLogKeyword", () => {
  it("matches LOG case-insensitively and nothing else", () => {
    expect(isQuickLogKeyword("log")).toBe(true);
    expect(isQuickLogKeyword("LOG")).toBe(true);
    expect(isQuickLogKeyword("PASS")).toBe(false);
  });
});

describe("quickLogLinkDedupeKey", () => {
  it("is stable per inbound message", () => {
    expect(quickLogLinkDedupeKey("msg-1")).toBe("notif:quick_log_link:msg-1");
  });
});

describe("normalizeQuickLogInput", () => {
  it("bounds hours and progress and passes job_id/note through", () => {
    const input = normalizeQuickLogInput(
      { job_id: "j1", hours_worked: "8.5", state_progress_pct: "150", note: "  framed it  " },
      "2026-06-09",
    );
    expect(input).toEqual({
      logDate: "2026-06-09",
      jobId: "j1",
      hoursWorked: 8.5,
      stateProgressPct: 100,
      note: "framed it",
    });
  });

  it("nulls empty/invalid numbers and a blank note", () => {
    const input = normalizeQuickLogInput({ hours_worked: "", state_progress_pct: "abc", note: "   " }, "2026-06-09");
    expect(input.hoursWorked).toBeNull();
    expect(input.stateProgressPct).toBeNull();
    expect(input.note).toBeNull();
    expect(input.jobId).toBeNull();
  });
});

describe("buildQuickLogLogFields", () => {
  it("pins parts_source to none and maps the note to issues", () => {
    const fields = buildQuickLogLogFields({
      logDate: "2026-06-09",
      jobId: "j1",
      hoursWorked: 4,
      stateProgressPct: 50,
      note: "tied in the main",
    });
    expect(fields).toEqual({
      log_date: "2026-06-09",
      hours_worked: 4,
      state_progress_pct: 50,
      parts_source: "none",
      issues: "tied in the main",
    });
  });
});
