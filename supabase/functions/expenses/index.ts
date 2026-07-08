/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const ADMIN_ROLES = new Set(["owner_admin", "office_manager", "support_admin"]);
const EXPENSE_KINDS = new Set(["field_purchase", "adjustment"]);
const PO_STATUSES = new Set(["draft", "sent", "pending_value", "cancelled"]);

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function requiredAmount(value: unknown) {
  const num = nullableNumber(value);
  if (num === null) throw new Error("amount_required");
  return Math.round(num * 100) / 100;
}

function canWrite(role: unknown) {
  return ADMIN_ROLES.has(String(role ?? ""));
}

async function loadJob(sb: any, locationId: string, jobId: string | null) {
  if (!jobId) return null;
  const { data, error } = await sb
    .from("jobs")
    .select("id, address, active, total_expenses, total_field_purchase_expenses, total_po_expenses, updated_at")
    .eq("location_id", locationId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadSupplyHouse(sb: any, locationId: string, supplyHouseId: string | null) {
  if (!supplyHouseId) return null;
  const { data, error } = await sb
    .from("supply_house_contacts")
    .select("id, name, rep_name, email, phone, active")
    .eq("location_id", locationId)
    .eq("id", supplyHouseId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadPurchaseOrder(sb: any, locationId: string, id: string | null) {
  if (!id) return null;
  const { data, error } = await sb.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const job = await loadJob(sb, locationId, data.job_id);
  if (!job) return null;
  return { ...data, job };
}

async function loadExpense(sb: any, locationId: string, id: string | null) {
  if (!id) return null;
  const { data, error } = await sb.from("job_expenses").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const job = await loadJob(sb, locationId, data.job_id);
  if (!job) return null;
  return { ...data, job };
}

async function recalcJobTotals(sb: any, jobId: string) {
  const { data, error } = await sb.from("job_expenses").select("kind, amount").eq("job_id", jobId);
  if (error) throw error;

  let total = 0;
  let field = 0;
  let po = 0;
  for (const row of data ?? []) {
    const amount = Number(row.amount ?? 0);
    total += amount;
    if (row.kind === "field_purchase") field += amount;
    if (row.kind === "po") po += amount;
  }

  const { error: updateErr } = await sb
    .from("jobs")
    .update({
      total_expenses: Math.round(total * 100) / 100,
      total_field_purchase_expenses: Math.round(field * 100) / 100,
      total_po_expenses: Math.round(po * 100) / 100,
    })
    .eq("id", jobId);
  if (updateErr) throw updateErr;
}

function attachJobAndSupply(rows: any[], jobsById: Map<string, any>, supplyById: Map<string, any>) {
  return rows.map((row) => ({
    ...row,
    job: jobsById.get(row.job_id) ?? null,
    supply_house: row.supply_house_id ? supplyById.get(row.supply_house_id) ?? null : null,
  }));
}

async function expensesPayload(sb: any, locationId: string, includeArchived = false, limit = 500) {
  let jobsQuery = sb
    .from("jobs")
    .select("id, address, active, total_expenses, total_field_purchase_expenses, total_po_expenses, updated_at")
    .eq("location_id", locationId)
    .order("active", { ascending: false })
    .order("address", { ascending: true });
  if (!includeArchived) jobsQuery = jobsQuery.eq("active", true);

  const [{ data: jobs, error: jobsErr }, { data: supplyHouses, error: supplyErr }] = await Promise.all([
    jobsQuery,
    sb
      .from("supply_house_contacts")
      .select("id, name, rep_name, email, phone, active")
      .eq("location_id", locationId)
      .order("name"),
  ]);
  if (jobsErr) throw jobsErr;
  if (supplyErr) throw supplyErr;

  const jobRows = jobs ?? [];
  const jobIds = jobRows.map((job: any) => job.id);
  const jobsById = new Map(jobRows.map((job: any) => [job.id, job]));
  const supplyById = new Map((supplyHouses ?? []).map((supply: any) => [supply.id, supply]));

  const [poResult, expenseResult] = jobIds.length
    ? await Promise.all([
      sb.from("purchase_orders").select("*").in("job_id", jobIds).order("updated_at", { ascending: false }),
      sb.from("job_expenses").select("*").in("job_id", jobIds).order("created_at", { ascending: false }).limit(limit),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (poResult.error) throw poResult.error;
  if (expenseResult.error) throw expenseResult.error;

  const purchaseOrders = attachJobAndSupply(poResult.data ?? [], jobsById, supplyById);
  const expenses = attachJobAndSupply(expenseResult.data ?? [], jobsById, supplyById);

  return {
    jobs: jobRows,
    supply_houses: supplyHouses ?? [],
    purchase_orders: purchaseOrders,
    expenses,
    metrics: {
      active_job_count: jobRows.filter((job: any) => job.active).length,
      pending_po_count: purchaseOrders.filter((po: any) => po.status === "pending_value").length,
      total_expenses: jobRows.reduce((sum: number, job: any) => sum + Number(job.total_expenses ?? 0), 0),
      total_field_purchase_expenses: jobRows.reduce((sum: number, job: any) => sum + Number(job.total_field_purchase_expenses ?? 0), 0),
      total_po_expenses: jobRows.reduce((sum: number, job: any) => sum + Number(job.total_po_expenses ?? 0), 0),
    },
  };
}

async function createExpense(sb: any, locationId: string, body: Record<string, unknown>) {
  const job = await loadJob(sb, locationId, cleanText(body.job_id));
  if (!job) throw new Error("job_not_found");

  const kind = cleanText(body.kind) ?? "field_purchase";
  if (!EXPENSE_KINDS.has(kind)) throw new Error("invalid_expense_kind");

  const amount = requiredAmount(body.amount);
  if (kind === "field_purchase" && amount < 0) throw new Error("amount_must_be_positive");

  // Optional managed supply house; when set, snapshot its name into the free-text vendor
  // column so the expenses table + job rollups display it without a join (mirrors valuePurchaseOrder).
  const supplyHouseId = cleanText(body.supply_house_id);
  let supplyHouse: any = null;
  if (supplyHouseId) {
    supplyHouse = await loadSupplyHouse(sb, locationId, supplyHouseId);
    if (!supplyHouse) throw new Error("invalid_supply_house");
  }

  const { error } = await sb.from("job_expenses").insert({
    job_id: job.id,
    kind,
    amount,
    supply_house_id: supplyHouseId,
    vendor: supplyHouse?.name ?? cleanText(body.vendor),
    description: cleanText(body.description),
    receipt_url: cleanText(body.receipt_url),
    parts_photo_url: cleanText(body.parts_photo_url),
  });
  if (error) throw error;
  await recalcJobTotals(sb, job.id);
}

async function updateExpense(sb: any, locationId: string, body: Record<string, unknown>) {
  const expense = await loadExpense(sb, locationId, cleanText(body.id));
  if (!expense) throw new Error("expense_not_found");
  if (expense.purchase_order_id) throw new Error("po_expense_locked");

  const patch: Record<string, unknown> = {};
  if ("kind" in body) {
    const kind = cleanText(body.kind);
    if (!kind || !EXPENSE_KINDS.has(kind)) throw new Error("invalid_expense_kind");
    patch.kind = kind;
  }
  if ("amount" in body) {
    const amount = requiredAmount(body.amount);
    const nextKind = String(patch.kind ?? expense.kind);
    if (nextKind === "field_purchase" && amount < 0) throw new Error("amount_must_be_positive");
    patch.amount = amount;
  }
  for (const key of ["vendor", "description", "receipt_url", "parts_photo_url"]) {
    if (key in body) patch[key] = cleanText(body[key]);
  }
  if ("supply_house_id" in body) {
    const supplyHouseId = cleanText(body.supply_house_id);
    if (supplyHouseId) {
      const supplyHouse = await loadSupplyHouse(sb, locationId, supplyHouseId);
      if (!supplyHouse) throw new Error("invalid_supply_house");
      patch.supply_house_id = supplyHouseId;
      patch.vendor = supplyHouse.name; // snapshot; overrides any free-text vendor above
    } else {
      patch.supply_house_id = null;
    }
  }

  if (Object.keys(patch).length) {
    const { error } = await sb.from("job_expenses").update(patch).eq("id", expense.id);
    if (error) throw error;
    await recalcJobTotals(sb, expense.job_id);
  }
}

async function deleteExpense(sb: any, locationId: string, body: Record<string, unknown>) {
  const expense = await loadExpense(sb, locationId, cleanText(body.id));
  if (!expense) throw new Error("expense_not_found");
  if (expense.purchase_order_id) throw new Error("po_expense_locked");

  const { error } = await sb.from("job_expenses").delete().eq("id", expense.id);
  if (error) throw error;
  await recalcJobTotals(sb, expense.job_id);
}

async function createPurchaseOrder(sb: any, locationId: string, body: Record<string, unknown>) {
  const job = await loadJob(sb, locationId, cleanText(body.job_id));
  if (!job) throw new Error("job_not_found");

  const supplyHouseId = cleanText(body.supply_house_id);
  if (supplyHouseId) {
    const supplyHouse = await loadSupplyHouse(sb, locationId, supplyHouseId);
    if (!supplyHouse) throw new Error("invalid_supply_house");
  }

  const status = cleanText(body.status) ?? "pending_value";
  if (!PO_STATUSES.has(status)) throw new Error("invalid_po_status");

  const { error } = await sb.from("purchase_orders").insert({
    job_id: job.id,
    supply_house_id: supplyHouseId,
    status,
    estimated_amount: nullableNumber(body.estimated_amount),
    description: cleanText(body.description),
    sent_at: status === "draft" ? null : cleanText(body.sent_at) ?? new Date().toISOString(),
  });
  if (error) throw error;
}

async function valuePurchaseOrder(sb: any, locationId: string, appUserId: string, body: Record<string, unknown>) {
  const po = await loadPurchaseOrder(sb, locationId, cleanText(body.id));
  if (!po) throw new Error("po_not_found");

  const amount = requiredAmount(body.final_amount ?? body.amount);
  if (amount < 0) throw new Error("amount_must_be_positive");

  const supplyHouse = po.supply_house_id ? await loadSupplyHouse(sb, locationId, po.supply_house_id) : null;
  if (po.supply_house_id && !supplyHouse) throw new Error("invalid_supply_house");

  const now = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("purchase_orders")
    .update({
      final_amount: amount,
      status: "valued",
      valued_at: now,
      valued_by_app_user_id: appUserId,
    })
    .eq("id", po.id);
  if (updateErr) throw updateErr;

  const vendor = supplyHouse?.name ?? cleanText(body.vendor);
  const description = cleanText(body.description) ?? po.description;
  const { data: existing, error: existingErr } = await sb
    .from("job_expenses")
    .select("id")
    .eq("purchase_order_id", po.id)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const { error } = await sb
      .from("job_expenses")
      .update({ job_id: po.job_id, kind: "po", amount, vendor, description })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("job_expenses").insert({
      job_id: po.job_id,
      purchase_order_id: po.id,
      kind: "po",
      amount,
      vendor,
      description,
    });
    if (error) throw error;
  }

  await recalcJobTotals(sb, po.job_id);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const locationId = claims.loc as string;
  const sb = serviceClient();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const includeArchived = url.searchParams.get("include_archived") === "true";
      const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
      const limit = Number.isFinite(requestedLimit) ? Math.min(1000, Math.max(50, requestedLimit)) : 500;
      return json(await expensesPayload(sb, locationId, includeArchived, limit));
    }

    if (!canWrite(claims.role)) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      if (body.action === "create_po") {
        await createPurchaseOrder(sb, locationId, body);
      } else {
        await createExpense(sb, locationId, body);
      }
      return json(await expensesPayload(sb, locationId), 201);
    }

    if (req.method === "PATCH") {
      if (body.action === "value_po") await valuePurchaseOrder(sb, locationId, String(claims.sub ?? ""), body);
      else if (body.action === "update_expense") await updateExpense(sb, locationId, body);
      else if (body.action === "delete_expense") await deleteExpense(sb, locationId, body);
      else return json({ error: "unknown_action" }, 400);
      return json(await expensesPayload(sb, locationId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = [
      "amount_required",
      "amount_must_be_positive",
      "invalid_expense_kind",
      "invalid_po_status",
      "invalid_supply_house",
      "unknown_action",
    ].includes(message)
      ? 400
      : ["job_not_found", "po_not_found", "expense_not_found"].includes(message)
        ? 404
        : message === "po_expense_locked"
          ? 409
          : 500;
    return json({ error: message }, status);
  }
});
