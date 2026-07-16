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
import { accumulateHours, buildDailyLogFields, classifyParts, normalizeCheckInInput } from "../_shared/check-in.ts";
import { enqueueFinishWalkthroughAsk } from "../_shared/finish-walkthrough.ts";
import { localContext } from "../_shared/check-in-schedule.ts";
import { queueInspectionDateAsk } from "../_shared/inspection-notify.ts";
import { triggerDrain } from "../_shared/drain.ts";

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

// Expense totals are recomputed from the sum (the office edits expenses elsewhere, so re-deriving
// keeps them authoritative). Hours are NOT summed here — each check-in ADDS its hours to the job's
// running total (step 3), so an office correction to the hours is never reverted by a later check-in.
async function recomputeExpenseTotals(sb: any, jobId: string) {
  const { data: expenses, error: expErr } = await sb.from("job_expenses").select("kind, amount").eq("job_id", jobId);
  if (expErr) throw expErr;

  let fieldPurchase = 0;
  let po = 0;
  let total = 0;
  for (const e of expenses ?? []) {
    const amount = Number(e.amount ?? 0);
    total += amount;
    if (e.kind === "field_purchase") fieldPurchase += amount;
    else if (e.kind === "po") po += amount;
  }
  return { fieldPurchase, po, total };
}

// v1 Test 12: when a check-in records a field-purchase expense, text BOTH owner and
// office the purchase with its receipt + parts photo links. Recipients are Uptiq contact
// IDs (owner_contact_id/office_contact_id) so the drain cron can deliver them; a per-recipient
// dedupe key keeps a replayed submit from double-sending (dedupe_key is UNIQUE).
async function queueFieldPurchaseNotice(sb: any, opts: {
  locationId: string;
  jobId: string;
  dailyLogId: string;
  address: string;
  crewName: string | null;
  receiptUrl: string | null;
  partsPhotoUrl: string | null;
}) {
  const { data: settings, error } = await sb
    .from("company_settings")
    .select("owner_contact_id, office_contact_id")
    .eq("location_id", opts.locationId)
    .maybeSingle();
  if (error) throw error;

  const now = new Date().toISOString();
  const payload = {
    job_id: opts.jobId,
    daily_log_id: opts.dailyLogId,
    address: opts.address,
    crew_name: opts.crewName,
    receipt_url: opts.receiptUrl,
    parts_photo_url: opts.partsPhotoUrl,
  };
  for (const raw of [settings?.owner_contact_id, settings?.office_contact_id]) {
    const contactId = typeof raw === "string" ? raw.trim() : "";
    if (!contactId) continue;
    const { error: insErr } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "sms",
      recipient: contactId,
      template_key: "field_purchase_notice",
      payload,
      scheduled_for: now,
      dedupe_key: `notif:field_purchase:${opts.dailyLogId}:${contactId}`,
    });
    if (insErr && !isDuplicateKeyError(insErr)) throw insErr;
  }
}

// Immediate owner + office SMS the moment a crew check-in advances a job into an inspection
// phase. Without this, nobody heard about the request until the next daily inspection-reminder
// cron (up to ~1 day later). The reminder cron still owns date scheduling; this only removes
// the silence. phaseLabel names the inspection state the job just entered (e.g. "Rough-In
// Inspection"). Per-recipient/day dedupe key keeps a same-day re-submit from double-sending.
async function queueInspectionRequestedNotice(sb: any, opts: {
  locationId: string;
  jobId: string;
  logDate: string;
  address: string;
  toStateId: string | null;
}) {
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
  const [{ data: settings, error: settingsErr }, phaseRes, { data: locRow }] = await Promise.all([
    sb.from("company_settings")
      .select("owner_contact_id, office_contact_id")
      .eq("location_id", opts.locationId)
      .maybeSingle(),
    opts.toStateId
      ? sb.from("job_states").select("label").eq("id", opts.toStateId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from("locations").select("timezone").eq("id", opts.locationId).maybeSingle(),
  ]);
  if (settingsErr) throw settingsErr;
  if (phaseRes.error) throw phaseRes.error;

  const ownerContactId = typeof settings?.owner_contact_id === "string" ? settings.owner_contact_id.trim() : "";
  const officeContactId = typeof settings?.office_contact_id === "string" ? settings.office_contact_id.trim() : "";

  // OFFICE: heads-up only. The "the owner will be asked to schedule" copy is correct here — the
  // office can't set the date, so it just needs to know a request came in.
  if (officeContactId) {
    const { error: insErr } = await sb.from("scheduled_notifications").insert({
      location_id: opts.locationId,
      job_id: opts.jobId,
      channel: "sms",
      recipient: officeContactId,
      template_key: "inspection_requested_notice",
      payload: {
        job_id: opts.jobId,
        log_date: opts.logDate,
        address: opts.address,
        phase_label: typeof phaseRes.data?.label === "string" ? phaseRes.data.label : null,
      },
      scheduled_for: new Date().toISOString(),
      dedupe_key: `notif:insp_requested:${opts.jobId}:${opts.logDate}:${officeContactId}`,
    });
    if (insErr && !isDuplicateKeyError(insErr)) throw insErr;
  }

  // OWNER: the actual date-picker link, immediately — not a third-person "the owner will be asked"
  // teaser. Same helper + dedupe key as the reminder cron (keyed on the company-local date), so a
  // same-day cron run collapses to one message; the cron still follows up on later days if unset.
  if (ownerContactId && appBaseUrl) {
    const tz = (typeof locRow?.timezone === "string" && locRow.timezone.trim()) || "America/Chicago";
    const { date: localDate } = localContext(tz, new Date());
    await queueInspectionDateAsk(sb, {
      locationId: opts.locationId,
      jobId: opts.jobId,
      address: opts.address,
      ownerContactId,
      appBaseUrl,
      localDate,
    });
  }
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
      .select("id, location_id, state_set_id, current_state_id, address, total_hours")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return json({ error: "job_not_found" }, 404);

    const tokenPayload = (claim.payload ?? {}) as Record<string, unknown>;
    const input = normalizeCheckInInput(
      body,
      typeof tokenPayload.log_date === "string" ? tokenPayload.log_date : undefined,
    );

    // 1. Upsert the daily log (UNIQUE(log_date, job_id, crew_contact_id)). Hours ACCUMULATE across
    //    a crew's same-day check-ins (add, don't replace) so every check-in's hours compile into the
    //    day's total; all other fields take the latest submission. Read-then-add is fine here: each
    //    submission is a single-use token (no concurrent taps for the same crew/day).
    const { data: existingLog } = await sb
      .from("daily_logs")
      .select("hours_worked")
      .eq("log_date", input.logDate)
      .eq("job_id", jobId)
      .eq("crew_contact_id", crewContactId)
      .maybeSingle();
    const priorHours = existingLog ? Number(existingLog.hours_worked ?? 0) : null;
    const logFields = buildDailyLogFields(input);
    logFields.hours_worked = accumulateHours(priorHours, input.hoursWorked);

    const { data: log, error: logErr } = await sb
      .from("daily_logs")
      .upsert({
        ...logFields,
        job_id: jobId,
        crew_contact_id: crewContactId,
        state_id: job.current_state_id,
        source: "check_in",
      }, { onConflict: "log_date,job_id,crew_contact_id" })
      .select("id")
      .single();
    if (logErr) throw logErr;
    const dailyLogId = log.id as string;

    // 2. Parts → field-purchase expense or pending-value purchase order.
    const parts = classifyParts(input);

    if (parts.expense) {
      // Replace only when THIS check-in actually reports a field purchase: clear the day's prior
      // one (so a corrected same-day re-submit can't duplicate it) and insert the new one. A
      // check-in that reports NO field purchase — e.g. the later "ready for inspection" submit that
      // advances the state — must leave any existing field purchase untouched; deleting it here was
      // wiping a previously-logged field purchase the moment the job changed state.
      await sb.from("job_expenses").delete().eq("daily_log_id", dailyLogId).eq("kind", "field_purchase");
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

      // v1 Test 12: text owner + office the field purchase with its photo URLs.
      const { data: crew, error: crewErr } = await sb
        .from("contacts").select("name").eq("id", crewContactId).maybeSingle();
      if (crewErr) throw crewErr;
      await queueFieldPurchaseNotice(sb, {
        locationId: job.location_id,
        jobId,
        dailyLogId,
        address: job.address,
        crewName: typeof crew?.name === "string" ? crew.name.trim() : null,
        receiptUrl: parts.expense.receipt_url,
        partsPhotoUrl: parts.expense.parts_photo_url,
      });
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

    // 3. Roll totals onto the job. Expenses recompute from sums (replay-safe). Hours ADD this
    //    submission's amount to the job's running total — which already includes any office
    //    correction — so an office hours edit is never reverted by a later check-in. (This is the
    //    same amount the daily log grew by, and the single-use token means it's added exactly once.)
    const totals = await recomputeExpenseTotals(sb, jobId);
    const jobPatch: Record<string, unknown> = {
      total_hours: Number(job.total_hours ?? 0) + (input.hoursWorked ?? 0),
      total_field_purchase_expenses: totals.fieldPurchase,
      total_po_expenses: totals.po,
      total_expenses: totals.total,
    };
    if (input.stateProgressPct !== null) jobPatch.state_progress_pct = input.stateProgressPct;
    if (purchaseOrderId) jobPatch.latest_po = purchaseOrderId;
    const { error: jobPatchErr } = await sb.from("jobs").update(jobPatch).eq("id", jobId);
    if (jobPatchErr) throw jobPatchErr;

    // 4. Inspection request advances the job through the configurable state engine, and —
    //    when it actually moves — immediately texts owner + office so they hear right away
    //    instead of waiting for the next daily inspection-reminder cron.
    let transition = null;
    if (input.inspectionRequested) {
      transition = await applyTransition(sb, {
        locationId: job.location_id,
        jobId,
        trigger: "inspection_requested",
        actorContactId: crewContactId,
        dedupeKey: `check_in_inspection:${jobId}:${input.logDate}`,
      });
      if (transition.changed) {
        // A new inspection cycle begins here — void any inspection_date left over from a prior
        // cycle (a previous phase's pass/fail, or a failed inspection on this phase). Otherwise
        // the job re-enters an inspection state still carrying that stale (non-today) date, and
        // cron-inspection-reminders sends NOTHING: the date-ask only fires when the date is null
        // and the pass/fail ask only when it equals today. Clearing it makes the reminder cron
        // ask the owner for a fresh date, which then drives the pass/fail ask on that day.
        await sb.from("jobs").update({ inspection_date: null }).eq("id", jobId);
        await queueInspectionRequestedNotice(sb, {
          locationId: job.location_id,
          jobId,
          logDate: input.logDate,
          address: job.address,
          toStateId: transition.toStateId,
        });
      }
    }

    // 4b. Crew reporting the work 100% complete (and NOT requesting an inspection) asks
    //     the owner whether the job is ready for the final walkthrough. The ask is gated
    //     on the current state actually offering a progress_100_owner_yes transition, so
    //     inspection/terminal states never fire it. One ask per job per log date.
    let finishWalkthroughAsked = false;
    if (!input.inspectionRequested) {
      const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim() || undefined;
      finishWalkthroughAsked = await enqueueFinishWalkthroughAsk(
        sb,
        {
          id: jobId,
          location_id: job.location_id,
          state_set_id: job.state_set_id,
          current_state_id: job.current_state_id,
          address: job.address,
        },
        input.stateProgressPct,
        { appBaseUrl, logDate: input.logDate },
      );
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

    // When this check-in advanced the job into an inspection phase, flush the queued owner
    // date-picker link + office heads-up NOW instead of waiting up to ~15 min for the drain
    // cron — the owner needs the actionable date link the moment the job becomes an inspection.
    // Best-effort (the drain cron is still the backstop), and gated on the real state advance so
    // routine daily check-ins keep deferring their summary email to the cron. Mirrors the
    // decision spine's immediate drain (apply-decision.ts).
    if (transition?.changed) await triggerDrain();

    return json({
      ok: true,
      job_id: jobId,
      daily_log_id: dailyLogId,
      purchase_order_id: purchaseOrderId,
      state_changed: transition?.changed ?? false,
      to_state_id: transition?.toStateId ?? null,
      finish_walkthrough_asked: finishWalkthroughAsked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
