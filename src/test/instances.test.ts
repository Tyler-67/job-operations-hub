import { describe, expect, it } from "vitest";
import { appBaseUrlFor, uptiqApiLocationId } from "../../supabase/functions/_shared/instances.ts";

// appBaseUrlFor: per-tenant frontend origin with env fallback (two-instance era).
describe("appBaseUrlFor", () => {
  it("prefers the location's own app_base_url", () => {
    expect(appBaseUrlFor({ app_base_url: "https://dev.example.com" }, "https://prod.example.com"))
      .toBe("https://dev.example.com");
  });

  it("falls back to the provided env base when the column is null/blank", () => {
    expect(appBaseUrlFor({ app_base_url: null }, "https://prod.example.com")).toBe("https://prod.example.com");
    expect(appBaseUrlFor({ app_base_url: "   " }, "https://prod.example.com")).toBe("https://prod.example.com");
    expect(appBaseUrlFor(null, "https://prod.example.com")).toBe("https://prod.example.com");
  });

  it("trims trailing slashes so callers can append /path", () => {
    expect(appBaseUrlFor({ app_base_url: "https://dev.example.com/" }, null)).toBe("https://dev.example.com");
    expect(appBaseUrlFor(null, "https://prod.example.com//")).toBe("https://prod.example.com");
  });

  it("returns empty string when neither source is set (callers keep their fail-loud guards)", () => {
    expect(appBaseUrlFor(null, "")).toBe("");
    expect(appBaseUrlFor({ app_base_url: "" }, null)).toBe("");
  });
});

// uptiqApiLocationId: the sync bridge — pull/link + calendar may address a different GHL
// location than the tenant's (unique) iframe binding.
describe("uptiqApiLocationId", () => {
  it("prefers the sync bridge column", () => {
    expect(uptiqApiLocationId({ uptiq_location_id: "DEV-INTERNAL-1", uptiq_sync_location_id: "RealGhlLoc" }))
      .toBe("RealGhlLoc");
  });

  it("falls back to the raw binding when no bridge is set", () => {
    expect(uptiqApiLocationId({ uptiq_location_id: "RealGhlLoc", uptiq_sync_location_id: null })).toBe("RealGhlLoc");
    expect(uptiqApiLocationId({ uptiq_location_id: "RealGhlLoc" })).toBe("RealGhlLoc");
  });

  it("returns null when the location has neither", () => {
    expect(uptiqApiLocationId(null)).toBeNull();
    expect(uptiqApiLocationId({ uptiq_location_id: "  ", uptiq_sync_location_id: "" })).toBeNull();
  });
});
