// Pure, I/O-free helpers for the daily check-in submission flow. No Deno or remote
// imports so the parsing/classification rules are unit-testable under vitest. The
// edge function (forms-daily-check-in) does the DB writes; everything here is a
// deterministic transform of the raw form body.

export type PartsSource = "none" | "field_purchase" | "supply_house";

// Only meaningful when partsSource === "supply_house":
//  - place_order     → the app places the order now (mint a PO number, email the rep)
//  - already_ordered → the crew already ordered; office values the PO later
export type SupplyHouseAction = "place_order" | "already_ordered";

export interface CheckInInput {
  logDate: string;
  stateProgressPct: number | null;
  hoursWorked: number | null;
  partsSource: PartsSource;
  partsList: string | null;
  supplyHouseId: string | null;
  supplyHouseAction: SupplyHouseAction | null;
  fieldPurchaseAmount: number | null;
  fieldPurchaseVendor: string | null;
  fieldPurchaseDescription: string | null;
  receiptPhotoUrl: string | null;
  partsPhotoUrl: string | null;
  jobSitePhotoUrls: string[];
  issues: string | null;
  inspectionRequested: boolean;
}

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function clampPct(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, num);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => cleanText(v)).filter((v): v is string => v !== null);
}

function partsSourceOf(value: unknown): PartsSource {
  return value === "field_purchase" || value === "supply_house" ? value : "none";
}

// Defaults to the safe, non-destructive option: an unrecognized/absent action
// never auto-places an order or emails a supply house.
function supplyHouseActionOf(value: unknown): SupplyHouseAction {
  return value === "place_order" ? "place_order" : "already_ordered";
}

// Today's date as YYYY-MM-DD in UTC; used only when the form omits log_date.
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Normalizes the untrusted form body into typed, bounded fields.
export function normalizeCheckInInput(
  body: Record<string, unknown>,
  fallbackLogDate: string = todayIso(),
): CheckInInput {
  const partsSource = partsSourceOf(body.parts_source);
  return {
    logDate: cleanText(body.log_date) ?? fallbackLogDate,
    stateProgressPct: clampPct(body.state_progress_pct),
    hoursWorked: nonNegativeNumber(body.hours_worked),
    partsSource,
    partsList: cleanText(body.parts_list),
    supplyHouseId: partsSource === "supply_house" ? cleanText(body.supply_house_id) : null,
    supplyHouseAction: partsSource === "supply_house" ? supplyHouseActionOf(body.supply_house_action) : null,
    fieldPurchaseAmount: nonNegativeNumber(body.field_purchase_amount),
    fieldPurchaseVendor: cleanText(body.field_purchase_vendor),
    fieldPurchaseDescription: cleanText(body.field_purchase_description),
    receiptPhotoUrl: cleanText(body.receipt_photo_url),
    partsPhotoUrl: cleanText(body.parts_photo_url),
    jobSitePhotoUrls: stringArray(body.job_site_photo_urls),
    issues: cleanText(body.issues),
    inspectionRequested: body.inspection_requested === true,
  };
}

export interface ClassifiedExpense {
  kind: "field_purchase";
  amount: number;
  vendor: string | null;
  description: string | null;
  receipt_url: string | null;
  parts_photo_url: string | null;
}

export interface ClassifiedPurchaseOrder {
  // "sent" when the app places the order now; "pending_value" when the crew
  // already ordered and the office still has to value it.
  status: "sent" | "pending_value";
  description: string | null;
  supplyHouseId: string | null;
  // true → the function must mint a PO number and email the supply-house rep.
  placeOrder: boolean;
}

export interface PartsClassification {
  expense: ClassifiedExpense | null;
  purchaseOrder: ClassifiedPurchaseOrder | null;
}

// Decides what financial record a check-in produces:
//  - field_purchase             → an immediate job_expense (crew paid out of pocket / on a card)
//  - supply_house place_order   → a "sent" purchase_order; the app authors a PO number and emails the rep
//  - supply_house already_ordered → a "pending_value" purchase_order the office values later
//  - none                       → nothing
export function classifyParts(input: CheckInInput): PartsClassification {
  if (input.partsSource === "field_purchase") {
    return {
      expense: {
        kind: "field_purchase",
        amount: input.fieldPurchaseAmount ?? 0,
        vendor: input.fieldPurchaseVendor,
        description: input.fieldPurchaseDescription ?? input.partsList,
        receipt_url: input.receiptPhotoUrl,
        parts_photo_url: input.partsPhotoUrl,
      },
      purchaseOrder: null,
    };
  }
  if (input.partsSource === "supply_house") {
    const placeOrder = input.supplyHouseAction === "place_order";
    return {
      expense: null,
      purchaseOrder: {
        status: placeOrder ? "sent" : "pending_value",
        description: input.partsList,
        supplyHouseId: input.supplyHouseId,
        placeOrder,
      },
    };
  }
  return { expense: null, purchaseOrder: null };
}

// A crew's hours ADD UP across every check-in for the same day (they "compile") rather than the
// latest submission replacing the day's entry. `prior` is the day's existing logged hours (null if
// the crew hasn't logged yet); a submission that enters no hours leaves the prior total untouched.
// All other daily-log fields (progress, issues, parts, photos) still take the latest submission.
export function accumulateHours(prior: number | null, submitted: number | null): number | null {
  if (submitted === null) return prior;
  return (prior ?? 0) + submitted;
}

// Maps normalized input to the daily_logs column shape (minus the keys the
// function supplies: job_id, crew_contact_id, state_id).
export function buildDailyLogFields(input: CheckInInput): Record<string, unknown> {
  return {
    log_date: input.logDate,
    inspection_requested: input.inspectionRequested,
    state_progress_pct: input.stateProgressPct,
    hours_worked: input.hoursWorked,
    parts_source: input.partsSource,
    parts_list: input.partsList,
    field_purchase_amount: input.fieldPurchaseAmount,
    field_purchase_vendor: input.fieldPurchaseVendor,
    field_purchase_description: input.fieldPurchaseDescription,
    receipt_photo_url: input.receiptPhotoUrl,
    parts_photo_url: input.partsPhotoUrl,
    job_site_photo_urls: input.jobSitePhotoUrls,
    issues: input.issues,
  };
}
