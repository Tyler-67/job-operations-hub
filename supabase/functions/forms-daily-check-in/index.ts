/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /forms-daily-check-in  { token, log_date?, state_progress_pct?, hours_worked?,
//   parts_source?, parts_list?, field_purchase_*?, *_photo_url?, job_site_photo_urls?,
//   issues?, inspection_requested? }
//
// The crew's branded check-in form submits here. The action token (minted by the
// daily-send cron, action "daily_check_in") binds the submission to one job + crew
// contact, so the form body never carries identity. The token is single-use and is
// consumed FIRST: a replayed submit returns 410, which also makes the purchase-order
// and notification writes below safe without their own dedupe keys.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { applyTransition } from "../_shared/state-machine.ts";
import { buildDailyLogFields, classifyParts, normalizeCheckInInput } from "../_shared/check-in.ts";

const CHECK_IN_ACTION = "daily_check_in";

function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}

// Atomically claims the token: marks it used only while it is still unused and
// unexpired, returning the bound job/contact. Null means already used / expired.
async function consumeToken(sb: any, token: string) {
  const hash = await hashActionToken(token, resolveActionSecret());
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("action_tokens")
    .update({ used_at: now })
    .eq("token_hash", hash)
    .eq("action", CHECK_IN_ACTION)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("job_id, contact_id, payload")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function recomputeJobTotals(sb: any, jobId: string) {
  const [{ data: logs, error: logsErr }, { data: expenses, error: expErr }] = await Promise.all([
    sb.from("daily_logs").select("hours_worked").eq("job_id", jobId),
    sb.from("job_expenses").select("kind, amount").eq("job_id", jobId),
  ]);
  if (logsErr) throw logsErr;
  if (expErr) throw expErr;

  const totalHours = (logs ?? []).reduce((sum: number, r: any) => sum + Number(r.hours_worked ?? 0), 0);
  let fieldPurchase = 0;
  let po = 0;
  let total = 0;
  for (const e of expenses ?? []) {
    const amount = Number(e.amount ?? 0);
    total += amount;
    if (e.kind === "field_purchase") fieldPurchase += amount;
    else if (e.kind === "po") po += amount;
  }
  return { totalHours, fieldPurchase, po, total };
}

async function queueOwnerOfficeNotices(sb: any, opts: {
  locationId: string;
  jobId: string;
  dailyLogId: string;
  logDate: string;
  address: string;
}) {
  // Addressed by Uptiq contact ID (owner + office), so the drain cron can deliver them.
  const { data: settings, error } = await sb
    .from("company_settings")
    .select("owner_contact_id, office_contact_id")
    .eq("location_id", opts.locationId)
    .maybeSingle();
  if (error) throw error;

  const now = new Date().toISOString();
  const payload = { job_id: opts.jobId, daily_log_id: opts.dailyLogId, log_date: opts.logDate, address: opts.address };
  for (const raw of [settings?.owner_contact_id, settings?.office_contact_id]) {
    const contactId = typeof raw === "string" ? raw.trim() : "";
    if (!contactId) continue;
    const { error: insErr } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "email",
      recipient: contactId,
      template_key: "daily_check_in_summary",
      payload,
      scheduled_for: now,
      dedupe_key: `notif:check_in:${opts.dailyLogId}:${contactId}`,
    });
    if (insErr && !isDuplicateKeyError(insErr)) throw insErr;
  }
}

// place_order only: queues the warehouse email to the supply house (parts list, pickup
// time, "don't exceed $X" ceiling) plus an owner + office "parts ordered" SMS — exactly
// the v1 n8n shape. Every recipient is an Uptiq contact ID because the drain cron sends
// through the Uptiq conversations API, which only addresses contacts. Dedupe keys are
// per-PO so a replayed run never double-sends; the actual send happens in the drain cron.
async function queueSupplyHouseOrder(sb: any, opts: {
  locationId: string;
  jobId: string;
  address: string;
  supplyHouseId: string | null;
  purchaseOrderId: string;
  poNumber: string;
  partsList: string | null;
}) {
  const now = new Date().toISOString();

  const [{ data: house, error: houseErr }, { data: settings, error: settingsErr }] = await Promise.all([
    opts.supplyHouseId
      ? sb.from("supply_house_contacts").select("name, rep_name, uptiq_contact_id").eq("id", opts.supplyHouseId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from("company_settings")
      .select("supply_house_pickup_time, parts_cost_ceiling, owner_contact_id, office_contact_id")
      .eq("location_id", opts.locationId)
      .maybeSingle(),
  ]);
  if (houseErr) throw houseErr;
  if (settingsErr) throw settingsErr;

  const payload = {
    po_number: opts.poNumber,
    parts_list: opts.partsList,
    pickup_time: (settings?.supply_house_pickup_time as string | null) ?? null,
    cost_ceiling: settings?.parts_cost_ceiling ?? null,
    address: opts.address,
    supply_house_name: house?.name ?? null,
    rep_name: house?.rep_name ?? null,
    job_id: opts.jobId,
    purchase_order_id: opts.purchaseOrderId,
  };

  // 1. Warehouse email to the supply house's Uptiq contact.
  const houseContactId = typeof house?.uptiq_contact_id === "string" ? house.uptiq_contact_id.trim() : "";
  if (houseContactId) {
    const { error } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "email",
      recipient: houseContactId,
      template_key: "supply_house_parts_order",
      payload,
      scheduled_for: now,
      dedupe_key: `notif:po_order:${opts.purchaseOrderId}`,
    });
    if (error && !isDuplicateKeyError(error)) throw error;
  }

  // 2. Owner + office "parts ordered" SMS, by Uptiq contact ID.
  const ownerOfficeIds = [settings?.owner_contact_id, settings?.office_contact_id];
  for (const raw of ownerOfficeIds) {
    const contactId = typeof raw === "string" ? raw.trim() : "";
    if (!contactId) continue;
    const { error } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "sms",
      recipient: contactId,
      template_key: "supply_house_parts_ordered_notice",
      payload,
      scheduled_for: now,
      dedupe_key: `notif:po_order_notice:${opts.purchaseOrderId}:${contactId}`,
    });
    if (error && !isDuplicateKeyError(error)) throw error;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = serviceClient();

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return json({ error: "missing_token" }, 400);

    const claim = await consumeToken(sb, token);
    if (!claim) return json({ error: "invalid_or_expired" }, 410);
    if (!claim.job_id || !claim.contact_id) return json({ error: "token_not_bound" }, 422);

    const jobId = claim.job_id as string;
    const crewContactId = claim.contact_id as string;

    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, location_id, state_set_id, current_state_id, address")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);

    const tokenPayload = (claim.payload ?? {}) as Record<string, unknown>;
    const input = normalizeCheckInInput(
      body,
      typeof tokenPayload.log_date === "string" ? tokenPayload.log_date : undefined,
    );

    // 1. Upsert the daily log (UNIQUE(log_date, job_id, crew_contact_id) keeps it idempotent).
    const { data: log, error: logErr } = await sb
      .from("daily_logs")
      .upsert({
        ...buildDailyLogFields(input),
        job_id: jobId,
        crew_contact_id: crewContactId,
        state_id: job.current_state_id,
      }, { onConflict: "log_date,job_id,crew_contact_id" })
      .select("id")
      .single();
    if (logErr) throw logErr;
    const dailyLogId = log.id as string;

    // 2. Parts → field-purchase expense or pending-value purchase order.
    const parts = classifyParts(input);

    await sb.from("job_expenses").delete().eq("daily_log_id", dailyLogId).eq("kind", "field_purchase");
    if (parts.expense) {
      const { error: expErr } = await sb.from("job_expenses").insert({
        job_id: jobId,
        daily_log_id: dailyLogId,
        recorded_by_contact_id: crewContactId,
        kind: parts.expense.kind,
        amount: parts.expense.amount,
        vendor: parts.expense.vendor,
        description: parts.expense.description,
        receipt_url: parts.expense.receipt_url,
        parts_photo_url: parts.expense.parts_photo_url,
      });
      if (expErr) throw expErr;
    }

    let purchaseOrderId: string | null = null;
    let placedPoNumber: string | null = null;
    if (parts.purchaseOrder) {
      const po = parts.purchaseOrder;
      const poInsert: Record<string, unknown> = {
        job_id: jobId,
        status: po.status,
        description: po.description,
        supply_house_id: po.supplyHouseId,
        created_by_contact_id: crewContactId,
      };
      // place_order: the app authors the PO now — mint a human-readable number
      // (atomic per company/day) and stamp it sent. already_ordered stays
      // pending_value with no number for the office to value later.
      if (po.placeOrder) {
        const orderDate = new Date().toISOString().slice(0, 10);
        const { data: poNumber, error: rpcErr } = await sb.rpc("next_po_number", {
          p_location_id: job.location_id,
          p_date: orderDate,
        });
        if (rpcErr) throw rpcErr;
        placedPoNumber = poNumber as string;
        poInsert.po_number = placedPoNumber;
        poInsert.sent_at = new Date().toISOString();
      }
      const { data: poRow, error: poErr } = await sb.from("purchase_orders").insert(poInsert).select("id").single();
      if (poErr) throw poErr;
      purchaseOrderId = poRow.id as string;
    }

    // 3. Roll authoritative totals onto the job (recomputed from sums, so replays
    //    never double-count) and apply this log's progress.
    const totals = await recomputeJobTotals(sb, jobId);
    const jobPatch: Record<string, unknown> = {
      total_hours: totals.totalHours,
      total_field_purchase_expenses: totals.fieldPurchase,
      total_po_expenses: totals.po,
      total_expenses: totals.total,
    };
    if (input.stateProgressPct !== null) jobPatch.state_progress_pct = input.stateProgressPct;
    if (purchaseOrderId) jobPatch.latest_po = purchaseOrderId;
    const { error: jobPatchErr } = await sb.from("jobs").update(jobPatch).eq("id", jobId);
    if (jobPatchErr) throw jobPatchErr;

    // 4. Inspection request advances the job through the configurable state engine.
    let transition = null;
    if (input.inspectionRequested) {
      transition = await applyTransition(sb, {
        locationId: job.location_id,
        jobId,
        trigger: "inspection_requested",
        actorContactId: crewContactId,
        dedupeKey: `check_in_inspection:${jobId}:${input.logDate}`,
      });
    }

    // 5. Notify owner/office of the daily check-in, and — when the crew placed an
    //    order — fire the warehouse email + owner/office "parts ordered" notice.
    await queueOwnerOfficeNotices(sb, {
      locationId: job.location_id,
      jobId,
      dailyLogId,
      logDate: input.logDate,
      address: job.address,
    });
    if (parts.purchaseOrder?.placeOrder && purchaseOrderId && placedPoNumber) {
      await queueSupplyHouseOrder(sb, {
        locationId: job.location_id,
        jobId,
        address: job.address,
        supplyHouseId: input.supplyHouseId,
        purchaseOrderId,
        poNumber: placedPoNumber,
        partsList: input.partsList,
      });
    }

    // 6. Idempotent audit entry.
    const { error: evtErr } = await sb.from("event_log").insert({
      location_id: job.location_id,
      source: "form",
      kind: "form.daily_check_in",
      dedupe_key: `daily_check_in:${jobId}:${crewContactId}:${input.logDate}`,
      actor_contact_id: crewContactId,
      payload: {
        job_id: jobId,
        daily_log_id: dailyLogId,
        log_date: input.logDate,
        parts_source: input.partsSource,
        purchase_order_id: purchaseOrderId,
        po_number: placedPoNumber,
        inspection_requested: input.inspectionRequested,
      },
      status: "ok",
    });
    if (evtErr && !isDuplicateKeyError(evtErr)) throw evtErr;

    return json({
      ok: true,
      job_id: jobId,
      daily_log_id: dailyLogId,
      purchase_order_id: purchaseOrderId,
      state_changed: transition?.changed ?? false,
      to_state_id: transition?.toStateId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
