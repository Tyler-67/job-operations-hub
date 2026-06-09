import { describe, it, expect } from "vitest";
import { renderNotification } from "../../supabase/functions/_shared/notifications";

describe("renderNotification", () => {
  const order = {
    po_number: "PO-20260609-01",
    parts_list: "copper fittings, 3/4 valve",
    pickup_time: "7AM",
    cost_ceiling: 500,
    address: "1420 Canyon Rd",
  };

  it("builds the v1 warehouse email subject and an HTML body with the ceiling note", () => {
    const msg = renderNotification("supply_house_parts_order", order);
    expect(msg.subject).toBe("1420 Canyon Rd - Parts for pickup 7AM");
    expect(msg.body).toContain("PO PO-20260609-01");
    expect(msg.body).toContain("copper fittings, 3/4 valve");
    expect(msg.body).toContain("do not exceed $500 without calling the owner");
    expect(msg.body).toContain("<br>");
  });

  it("omits the ceiling note when no ceiling is set, and falls back to a job-site subject", () => {
    const msg = renderNotification("supply_house_parts_order", {
      parts_list: "pipe",
      pickup_time: "",
      cost_ceiling: null,
    });
    expect(msg.subject).toBe("Job site - Parts for pickup");
    expect(msg.body).not.toContain("do not exceed");
  });

  it("renders the owner/office notice as a subject-less SMS line", () => {
    const msg = renderNotification("supply_house_parts_ordered_notice", order);
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Parts ordered (PO PO-20260609-01) for 1420 Canyon Rd.");
    expect(msg.body).toContain("Items: copper fittings, 3/4 valve.");
    expect(msg.body).toContain("Pickup 7AM.");
  });

  it("escapes HTML in email bodies to avoid breaking the markup", () => {
    const msg = renderNotification("supply_house_parts_order", {
      parts_list: "<script>alert(1)</script> & fittings",
      address: "A & B St",
    });
    expect(msg.body).toContain("&lt;script&gt;");
    expect(msg.body).toContain("&amp;");
    expect(msg.body).not.toContain("<script>");
  });

  it("renders the daily check-in summary with the log date in the subject", () => {
    const msg = renderNotification("daily_check_in_summary", {
      log_date: "2026-06-09",
      address: "1420 Canyon Rd",
    });
    expect(msg.subject).toBe("Daily check-in — 2026-06-09");
    expect(msg.body).toContain("1420 Canyon Rd");
    expect(msg.body).toContain("2026-06-09");
  });

  it("renders the daily check-in link as a subject-less SMS with company, address, and link", () => {
    const msg = renderNotification("daily_check_in_link", {
      company_name: "Canyon Plumbing",
      address: "1420 Canyon Rd",
      link: "https://app.example.com/forms/check-in?token=abc",
    });
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Canyon Plumbing:");
    expect(msg.body).toContain("at 1420 Canyon Rd");
    expect(msg.body).toContain("https://app.example.com/forms/check-in?token=abc");
  });

  it("renders the inspection-date link as a subject-less SMS with the address and link", () => {
    const msg = renderNotification("inspection_date_link", {
      address: "1420 Canyon Rd",
      link: "https://app.example.com/forms/inspection-date?token=abc",
    });
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Pick the inspection date at 1420 Canyon Rd");
    expect(msg.body).toContain("https://app.example.com/forms/inspection-date?token=abc");
  });

  it("renders the inspection result ask with both PASS and FAIL links", () => {
    const msg = renderNotification("inspection_result_ask", {
      address: "1420 Canyon Rd",
      pass_link: "https://app.example.com/action/decision?token=pass",
      fail_link: "https://app.example.com/action/decision?token=fail",
    });
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Inspection result at 1420 Canyon Rd?");
    expect(msg.body).toContain("PASS https://app.example.com/action/decision?token=pass");
    expect(msg.body).toContain("FAIL https://app.example.com/action/decision?token=fail");
  });

  it("renders the inspection fix-details link to the owner with address and link", () => {
    const msg = renderNotification("inspection_fix_details_link", {
      address: "1420 Canyon Rd",
      link: "https://app.example.com/forms/inspection-fix-details?token=abc",
    });
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Inspection failed at 1420 Canyon Rd.");
    expect(msg.body).toContain("Tell the crew what to fix:");
    expect(msg.body).toContain("https://app.example.com/forms/inspection-fix-details?token=abc");
  });

  it("renders the crew fix-details notice with the actual fix list", () => {
    const msg = renderNotification("inspection_fix_details_notice", {
      address: "1420 Canyon Rd",
      details: "Re-strap the vent stack; cap the unused tee.",
    });
    expect(msg.subject).toBeNull();
    expect(msg.body).toContain("Inspection fixes needed at 1420 Canyon Rd:");
    expect(msg.body).toContain("Re-strap the vent stack; cap the unused tee.");
  });

  it("falls back to the template key + serialized payload for unknown templates", () => {
    const msg = renderNotification("mystery", { a: 1 });
    expect(msg.subject).toBe("mystery");
    expect(msg.body).toContain("\"a\":1");
  });
});
