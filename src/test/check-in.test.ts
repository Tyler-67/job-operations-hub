import { describe, it, expect } from "vitest";
import {
  buildDailyLogFields,
  classifyParts,
  normalizeCheckInInput,
  todayIso,
} from "../../supabase/functions/_shared/check-in";

describe("normalizeCheckInInput", () => {
  it("cleans, bounds, and types the raw form body", () => {
    const input = normalizeCheckInInput({
      log_date: " 2026-06-08 ",
      state_progress_pct: "140",
      hours_worked: "8.5",
      parts_source: "field_purchase",
      parts_list: "  copper fittings ",
      field_purchase_amount: "-5",
      field_purchase_vendor: "Home Depot",
      receipt_photo_url: "logs/r.jpg",
      job_site_photo_urls: ["a.jpg", "", 3, "b.jpg"],
      issues: "",
      inspection_requested: true,
    });

    expect(input.logDate).toBe("2026-06-08");
    expect(input.stateProgressPct).toBe(100); // clamped to 100
    expect(input.hoursWorked).toBe(8.5);
    expect(input.partsSource).toBe("field_purchase");
    expect(input.partsList).toBe("copper fittings");
    expect(input.fieldPurchaseAmount).toBe(0); // negative floored to 0
    expect(input.fieldPurchaseVendor).toBe("Home Depot");
    expect(input.receiptPhotoUrl).toBe("logs/r.jpg");
    expect(input.jobSitePhotoUrls).toEqual(["a.jpg", "b.jpg"]);
    expect(input.issues).toBeNull();
    expect(input.inspectionRequested).toBe(true);
  });

  it("falls back to the supplied log date, then today", () => {
    expect(normalizeCheckInInput({}, "2026-01-02").logDate).toBe("2026-01-02");
    expect(normalizeCheckInInput({}).logDate).toBe(todayIso());
  });

  it("defaults unknown parts_source to none and treats absent inspection flag as false", () => {
    const input = normalizeCheckInInput({ parts_source: "bogus" });
    expect(input.partsSource).toBe("none");
    expect(input.inspectionRequested).toBe(false);
    expect(input.stateProgressPct).toBeNull();
    expect(input.hoursWorked).toBeNull();
    expect(input.supplyHouseId).toBeNull();
    expect(input.supplyHouseAction).toBeNull();
  });

  it("captures supply house id + action only for supply_house parts", () => {
    const place = normalizeCheckInInput({
      parts_source: "supply_house",
      supply_house_action: "place_order",
      supply_house_id: " sh-123 ",
    });
    expect(place.supplyHouseAction).toBe("place_order");
    expect(place.supplyHouseId).toBe("sh-123");

    const already = normalizeCheckInInput({
      parts_source: "supply_house",
      supply_house_action: "already_ordered",
      supply_house_id: "sh-9",
    });
    expect(already.supplyHouseAction).toBe("already_ordered");

    // Absent/unknown action defaults to the safe already_ordered (never auto-places).
    const defaulted = normalizeCheckInInput({ parts_source: "supply_house" });
    expect(defaulted.supplyHouseAction).toBe("already_ordered");

    // Ignored entirely when the source isn't supply_house.
    const fieldPurchase = normalizeCheckInInput({
      parts_source: "field_purchase",
      supply_house_action: "place_order",
      supply_house_id: "sh-1",
    });
    expect(fieldPurchase.supplyHouseAction).toBeNull();
    expect(fieldPurchase.supplyHouseId).toBeNull();
  });
});

describe("classifyParts", () => {
  it("produces a field_purchase expense and prefers its description over parts_list", () => {
    const { expense, purchaseOrder } = classifyParts(normalizeCheckInInput({
      parts_source: "field_purchase",
      field_purchase_amount: "42.50",
      field_purchase_vendor: "Ferguson",
      field_purchase_description: "PVC + glue",
      parts_list: "ignored when description present",
      receipt_photo_url: "r.jpg",
      parts_photo_url: "p.jpg",
    }));

    expect(purchaseOrder).toBeNull();
    expect(expense).toEqual({
      kind: "field_purchase",
      amount: 42.5,
      vendor: "Ferguson",
      description: "PVC + glue",
      receipt_url: "r.jpg",
      parts_photo_url: "p.jpg",
    });
  });

  it("falls back to parts_list when no field purchase description is given", () => {
    const { expense } = classifyParts(normalizeCheckInInput({
      parts_source: "field_purchase",
      parts_list: "misc parts",
    }));
    expect(expense?.amount).toBe(0);
    expect(expense?.description).toBe("misc parts");
  });

  it("produces a 'sent' purchase order that needs a PO number when placing an order", () => {
    const { expense, purchaseOrder } = classifyParts(normalizeCheckInInput({
      parts_source: "supply_house",
      supply_house_action: "place_order",
      supply_house_id: "sh-42",
      parts_list: "valve package",
    }));
    expect(expense).toBeNull();
    expect(purchaseOrder).toEqual({
      status: "sent",
      description: "valve package",
      supplyHouseId: "sh-42",
      placeOrder: true,
    });
  });

  it("produces a pending_value purchase order when the crew already ordered", () => {
    const { expense, purchaseOrder } = classifyParts(normalizeCheckInInput({
      parts_source: "supply_house",
      supply_house_action: "already_ordered",
      supply_house_id: "sh-7",
      parts_list: "ordered from supply house",
    }));
    expect(expense).toBeNull();
    expect(purchaseOrder).toEqual({
      status: "pending_value",
      description: "ordered from supply house",
      supplyHouseId: "sh-7",
      placeOrder: false,
    });
  });

  it("produces neither when no parts were used", () => {
    const result = classifyParts(normalizeCheckInInput({ parts_source: "none" }));
    expect(result).toEqual({ expense: null, purchaseOrder: null });
  });
});

describe("buildDailyLogFields", () => {
  it("maps normalized input to daily_logs columns", () => {
    const fields = buildDailyLogFields(normalizeCheckInInput({
      log_date: "2026-06-08",
      hours_worked: "6",
      parts_source: "supply_house",
      parts_list: "fittings",
      inspection_requested: true,
      state_progress_pct: "75",
    }));

    expect(fields).toMatchObject({
      log_date: "2026-06-08",
      hours_worked: 6,
      parts_source: "supply_house",
      parts_list: "fittings",
      inspection_requested: true,
      state_progress_pct: 75,
      job_site_photo_urls: [],
    });
    // identity/state columns are supplied by the function, not this mapper
    expect("job_id" in fields).toBe(false);
    expect("crew_contact_id" in fields).toBe(false);
    expect("state_id" in fields).toBe(false);
  });
});
