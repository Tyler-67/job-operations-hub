import { describe, expect, it } from "vitest";
import { validateInstanceInput } from "../../supabase/functions/_shared/instance-admin";

// Input validation for the Developer console's create-instance action.
describe("validateInstanceInput", () => {
  const base = {
    company_name: "Daily Burn QA",
    timezone: "America/Boise",
    uptiq_location_id: "QA-INTERNAL-1",
    app_base_url: "https://qa.example.com/",
    uptiq_sync_location_id: " JrBcbFAsvPtRlR0UfaLj ",
  };

  it("normalizes a valid draft (trims, strips trailing slash, blanks -> null)", () => {
    const out = validateInstanceInput(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.app_base_url).toBe("https://qa.example.com");
    expect(out.value.uptiq_sync_location_id).toBe("JrBcbFAsvPtRlR0UfaLj");
    const blanks = validateInstanceInput({ ...base, app_base_url: "  ", uptiq_sync_location_id: "" });
    if (blanks.ok) {
      expect(blanks.value.app_base_url).toBeNull();
      expect(blanks.value.uptiq_sync_location_id).toBeNull();
    } else {
      throw new Error("expected ok");
    }
  });

  it("requires a company name and a plausible binding id", () => {
    expect(validateInstanceInput({ ...base, company_name: " " })).toEqual({ ok: false, error: "company_name_required" });
    expect(validateInstanceInput({ ...base, uptiq_location_id: "" })).toEqual({ ok: false, error: "uptiq_location_id_required" });
    expect(validateInstanceInput({ ...base, uptiq_location_id: "has spaces!" })).toEqual({ ok: false, error: "uptiq_location_id_invalid" });
  });

  it("rejects a bogus timezone and a non-https app URL", () => {
    expect(validateInstanceInput({ ...base, timezone: "Mars/Olympus" })).toEqual({ ok: false, error: "timezone_invalid" });
    expect(validateInstanceInput({ ...base, app_base_url: "http://insecure.example.com" })).toEqual({ ok: false, error: "app_base_url_invalid" });
  });

  it("defaults timezone when blank", () => {
    const out = validateInstanceInput({ ...base, timezone: "" });
    expect(out.ok && out.value.timezone).toBe("America/Chicago");
  });
});
