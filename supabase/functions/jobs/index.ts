/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession, logEvent } from "../_shared/util.ts";
import { markJobPaid } from "../_shared/job-payments.ts";
import { maybeBuildCompletionReport } from "../_shared/completion-report.ts";
import { maybeEnqueueReviewRequest } from "../_shared/review-request.ts";
import { resolveDecision } from "../_shared/decisions.ts";
import { applyDecision } from "../_shared/apply-decision.ts";
import { syncInspectionAppointment, cancelInspectionAppointment, type InspectionCalendarResult } from "../_shared/inspection-calendar.ts";
import { queueInspectionDateAsk, queueInspectionResultAsk } from "../_shared/inspection-notify.ts";
import { enqueueWalkthroughResultAsk, stateOffersWalkthroughApproved } from "../_shared/walkthrough.ts";
import { queueWalkthroughScheduleAsk } from "../_shared/walkthrough-notify.ts";
import { localContext } from "../_shared/check-in-schedule.ts";
import { triggerDrain } from "../_shared/drain.ts";
import { canUseDebugTool } from "../_shared/debug-access.ts";

const ADMIN_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function numberValue(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function canWrite(role: unknown) {
  return ADMIN_ROLES.has(String(role ?? ""));
}

// A fired decision must match the job's current state kind — mirrors the JobDetail button
// gating, enforced server-side so a crafted request can't fire e.g. a walkthrough punch-list
// SMS against a dirt-work job. State-advancing decisions are also implicitly guarded by
// applyTransition (no matching transition = no-op), but the acknowledge-only walkthrough
// decisions (trigger: null) enqueue regardless of state, so this is the real guard for those.
function decisionAllowedForState(
  action: string,
  state: { is_inspection?: boolean; is_walkthrough?: boolean; slug?: string } | null,
): boolean {
  if (!state) return false;
  if (action === "inspection_pass" || action === "inspection_fail") return state.is_inspection === true;
  if (action.startsWith("walkthrough_")) return state.is_walkthrough === true;
  if (action === "finish_walkthrough_yes" || action === "finish_walkthrough_no") return state.slug === "finish_work";
  return false;
}

function errorStatus(message: string) {
  if (message === "not_found") return 404;
  if (["id_required", "invalid_state", "invalid_paid_source", "missing_paid_state"].includes(message)) return 400;
  return 500;
}

async function defaultStateSet(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("job_state_sets")
    .select("id")
    .eq("location_id", locationId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function statesForSet(sb: any, stateSetId: string | null) {
  if (!stateSetId) return [];
  const { data, error } = await sb
    .from("job_states")
    .select("*")
    .eq("state_set_id", stateSetId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

async function firstStateId(sb: any, stateSetId: string) {
  const states = await statesForSet(sb, stateSetId);
  return states[0]?.id ?? null;
}

async function ensureStateBelongsToSet(sb: any, stateId: string | null, stateSetId: string) {
  if (!stateId) return null;
  const { data, error } = await sb
    .from("job_states")
    .select("id")
    .eq("id", stateId)
    .eq("state_set_id", stateSetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("invalid_state");
  return stateId;
}

async function findOrCreateContact(sb: any, locationId: string, input: any, role: "customer" | "crew") {
  const name = cleanText(typeof input === "string" ? input : input?.name);
  if (!name) return null;

  const { data: existing, error: existingErr } = await sb
    .from("contacts")
    .select("id, name, email, phone, role")
    .eq("location_id", locationId)
    .eq("role", role)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return existing;

  const { data, error } = await sb
    .from("contacts")
    .insert({
      location_id: locationId,
      name,
      email: cleanText(input?.email),
      phone: cleanText(input?.phone),
      role,
    })
    .select("id, name, email, phone, role")
    .single();
  if (error) throw error;
  return data;
}

async function replaceJobPeople(sb: any, locationId: string, jobId: string, payload: any) {
  if (payload.customer) {
    await sb.from("job_customers").delete().eq("job_id", jobId);
    const customer = await findOrCreateContact(sb, locationId, payload.customer, "customer");
    if (customer) {
      const { error } = await sb.from("job_customers").insert({
        job_id: jobId,
        contact_id: customer.id,
        is_primary: true,
      });
      if (error) throw error;
    }
  }

  if (Array.isArray(payload.crew_names)) {
    await sb.from("job_crew").delete().eq("job_id", jobId);
    const leadName = cleanText(payload.crew_lead_name)?.toLowerCase() ?? "";
    const crewContacts: any[] = [];
    for (const rawName of payload.crew_names) {
      const crew = await findOrCreateContact(sb, locationId, rawName, "crew");
      if (crew && !crewContacts.some((c) => c.id === crew.id)) crewContacts.push(crew);
    }
    // Exactly one lead: the named lead if it matches, else the first crew member. Never
    // leave a job with zero leads — cron-send-check-ins only texts is_lead crew, so a
    // leadless job is silently skipped by the daily check-in loop.
    let leadIdx = leadName ? crewContacts.findIndex((c) => (c.name ?? "").toLowerCase() === leadName) : -1;
    if (leadIdx < 0 && crewContacts.length) leadIdx = 0;
    for (let i = 0; i < crewContacts.length; i++) {
      const { error } = await sb.from("job_crew").insert({
        job_id: jobId,
        contact_id: crewContacts[i].id,
        is_lead: i === leadIdx,
      });
      if (error) throw error;
    }
  }
}

function mapLinks(rows: any[] | null | undefined) {
  const out = new Map<string, any[]>();
  for (const row of rows ?? []) {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    if (!contact) continue;
    const list = out.get(row.job_id) ?? [];
    list.push(contact);
    out.set(row.job_id, list);
  }
  return out;
}

function mapCrew(rows: any[] | null | undefined) {
  const out = new Map<string, any[]>();
  for (const row of rows ?? []) {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    if (!contact) continue;
    const list = out.get(row.job_id) ?? [];
    list.push({ ...contact, is_lead: row.is_lead === true });
    out.set(row.job_id, list);
  }
  return out;
}

function mapRows(rows: any[] | null | undefined, key = "job_id") {
  const out = new Map<string, any[]>();
  for (const row of rows ?? []) {
    const list = out.get(row[key]) ?? [];
    list.push(row);
    out.set(row[key], list);
  }
  return out;
}

async function hydrateJobs(sb: any, jobs: any[]) {
  if (!jobs.length) return [];
  const jobIds = jobs.map((job) => job.id);
  const stateIds = [...new Set(jobs.map((job) => job.current_state_id).filter(Boolean))];

  const [
    { data: states, error: statesErr },
    { data: customers, error: customersErr },
    { data: crew, error: crewErr },
    { data: purchaseOrders, error: poErr },
    { data: expenses, error: expensesErr },
    { data: logs, error: logsErr },
  ] = await Promise.all([
    stateIds.length
      ? sb.from("job_states").select("*").in("id", stateIds)
      : Promise.resolve({ data: [], error: null }),
    sb.from("job_customers").select("job_id, contact:contacts(id, name, email, phone, role)").in("job_id", jobIds),
    sb.from("job_crew").select("job_id, is_lead, contact:contacts(id, name, email, phone, role)").in("job_id", jobIds),
    sb.from("purchase_orders").select("*").in("job_id", jobIds).order("updated_at", { ascending: false }),
    sb.from("job_expenses").select("*").in("job_id", jobIds).order("created_at", { ascending: false }),
    sb.from("daily_logs").select("*").in("job_id", jobIds).order("log_date", { ascending: false }),
  ]);

  for (const err of [statesErr, customersErr, crewErr, poErr, expensesErr, logsErr]) {
    if (err) throw err;
  }

  const stateById = Object.fromEntries((states ?? []).map((state: any) => [state.id, state]));
  const customersByJob = mapLinks(customers);
  const crewByJob = mapCrew(crew);
  const posByJob = mapRows(purchaseOrders);
  const expensesByJob = mapRows(expenses);
  const logsByJob = mapRows(logs);

  return jobs.map((job) => {
    const jobLogs = logsByJob.get(job.id) ?? [];
    return {
      ...job,
      current_state: job.current_state_id ? stateById[job.current_state_id] ?? null : null,
      customers: customersByJob.get(job.id) ?? [],
      crew: crewByJob.get(job.id) ?? [],
      purchase_orders: posByJob.get(job.id) ?? [],
      expenses: expensesByJob.get(job.id) ?? [],
      last_log_date: jobLogs[0]?.log_date ?? null,
    };
  });
}

async function getJobDetail(sb: any, locationId: string, jobId: string) {
  const { data: job, error } = await sb
    .from("jobs")
    .select("*")
    .eq("location_id", locationId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;

  const [hydrated] = await hydrateJobs(sb, [job]);
  const states = await statesForSet(sb, job.state_set_id);
  return {
    job: hydrated,
    states,
    daily_logs: await getRows(sb, "daily_logs", jobId, "log_date"),
    purchase_orders: hydrated.purchase_orders,
    expenses: hydrated.expenses,
  };
}

async function getRows(sb: any, table: string, jobId: string, orderColumn: string) {
  const { data, error } = await sb
    .from(table)
    .select("*")
    .eq("job_id", jobId)
    .order(orderColumn, { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function updateExistingJob(sb: any, locationId: string, body: any) {
  const jobId = cleanText(body.id);
  if (!jobId) return { error: "id_required", status: 400 };

  const { data: existing, error: existingErr } = await sb
    .from("jobs")
    .select("id, state_set_id, active, inspection_date, inspection_appointment_id, inspection_slot, walkthrough_date, walkthrough_appointment_id, walkthrough_slot, current_state_id")
    .eq("location_id", locationId)
    .eq("id", jobId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (!existing) return { error: "not_found", status: 404 };

  const patch: Record<string, unknown> = {};
  if ("address" in body) {
    const address = cleanText(body.address);
    if (!address) return { error: "address_required", status: 400 };
    patch.address = address;
  }
  if ("current_state_id" in body) {
    patch.current_state_id = await ensureStateBelongsToSet(sb, cleanText(body.current_state_id), existing.state_set_id);
  }
  if ("state_progress_pct" in body) patch.state_progress_pct = Math.max(0, Math.min(100, numberValue(body.state_progress_pct)));
  if ("job_completion_pct" in body) patch.job_completion_pct = Math.max(0, Math.min(100, numberValue(body.job_completion_pct)));
  if ("total_hours" in body) patch.total_hours = Math.max(0, numberValue(body.total_hours));
  if ("original_estimate" in body) patch.original_estimate = nullableNumber(body.original_estimate);
  if ("invoice_number" in body) patch.invoice_number = cleanText(body.invoice_number);
  if ("start_date" in body) patch.start_date = cleanText(body.start_date);
  if ("inspection_date" in body) patch.inspection_date = cleanText(body.inspection_date);
  if ("walkthrough_date" in body) patch.walkthrough_date = cleanText(body.walkthrough_date);
  // Appointment time windows — only the two known slots are accepted; anything else is ignored
  // (never nulls a stored slot). The calendar sync below re-times the Uptiq event on a change.
  if (body.inspection_slot === "9am" || body.inspection_slot === "1pm") patch.inspection_slot = body.inspection_slot;
  if (body.walkthrough_slot === "9am" || body.walkthrough_slot === "1pm") patch.walkthrough_slot = body.walkthrough_slot;
  if ("scope_of_work" in body) patch.scope_of_work = cleanText(body.scope_of_work);
  if ("notes" in body) patch.notes = cleanText(body.notes);
  if ("active" in body) patch.active = body.active !== false;

  if (Object.keys(patch).length) {
    const { error } = await sb.from("jobs").update(patch).eq("id", jobId).eq("location_id", locationId);
    if (error) throw error;
  }
  // A manual state change (dropdown -> complete/paid) can finish a job without going through
  // the decision spine. Both helpers self-guard (billing state only) and are idempotent, so
  // this captures the completion-report snapshot AND schedules the customer review-request
  // tag for the UI-driven completion path too — matching the decision-spine behavior.
  if (patch.current_state_id) {
    await maybeBuildCompletionReport(sb, jobId, patch.current_state_id as string);
    await maybeEnqueueReviewRequest(sb, jobId, patch.current_state_id as string);
  }
  await replaceJobPeople(sb, locationId, jobId, body);

  // When the inspection date is set or moved, sync the Uptiq inspections-calendar appointment
  // (best-effort, same helper as the owner SMS date-form). Skipped on unrelated saves so an
  // unchanged date with an existing appointment doesn't re-hit Uptiq. The office form has no slot,
  // so the helper defaults to the morning (9am) window.
  let calendar: InspectionCalendarResult | undefined;
  const oldDate = existing.inspection_date ? String(existing.inspection_date).slice(0, 10) : null;
  const bodyDate = "inspection_date" in body ? (patch.inspection_date as string | null) : oldDate;
  const dateChanged = Boolean(bodyDate) && bodyDate !== oldDate;
  const stateChanged = Boolean(patch.current_state_id) && patch.current_state_id !== existing.current_state_id;
  const effectiveStateId = (patch.current_state_id as string | undefined) ?? existing.current_state_id ?? null;
  // Walkthrough date twin of the inspection tracking above.
  const oldWtDate = existing.walkthrough_date ? String(existing.walkthrough_date).slice(0, 10) : null;
  const bodyWtDate = "walkthrough_date" in body ? (patch.walkthrough_date as string | null) : oldWtDate;
  const wtDateChanged = Boolean(bodyWtDate) && bodyWtDate !== oldWtDate;

  // Re-sync the Uptiq appointment when the date OR the time window changed (or a date exists
  // with no appointment yet). The patch is already applied, so the helper reads the stored
  // date + slot — a date-only change keeps the chosen time, a slot-only change re-times the
  // same event. Slot-only saves never touch the ask notifications below (those stay
  // date/state-change-gated).
  const inspSlotChanged = "inspection_slot" in patch && patch.inspection_slot !== (existing.inspection_slot ?? null);
  const wtSlotChanged = "walkthrough_slot" in patch && patch.walkthrough_slot !== (existing.walkthrough_slot ?? null);
  if ("inspection_date" in body || inspSlotChanged) {
    const newDate = ("inspection_date" in body ? patch.inspection_date : oldDate) as string | null;
    if (newDate && (newDate !== oldDate || inspSlotChanged || !existing.inspection_appointment_id)) {
      calendar = await syncInspectionAppointment(sb, { jobId });
    }
  }
  if ("walkthrough_date" in body || wtSlotChanged) {
    const newDate = ("walkthrough_date" in body ? patch.walkthrough_date : oldWtDate) as string | null;
    if (newDate && (newDate !== oldWtDate || wtSlotChanged || !existing.walkthrough_appointment_id)) {
      await syncInspectionAppointment(sb, { jobId, kind: "walkthrough" });
    }
  }

  // Inspection notifications for an OFFICE job update. Two triggers, one lookup:
  //  • date (re)set to TODAY while in an inspection phase → the day-of PASS/FAIL ask is due NOW
  //    (the reminder cron's today-check may already be past). Change-gated so a no-op re-save
  //    stays quiet.
  //  • the update MOVED the job into an inspection phase WITHOUT scheduling it → a new inspection
  //    cycle just began: void any prior cycle's stale date and text the owner the date-picker
  //    link immediately — the office state dropdown must notify like the crew's request does.
  if ((dateChanged || stateChanged || wtDateChanged) && effectiveStateId) {
    const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
    const [{ data: state }, { data: jobRow }, { data: loc }, { data: cs }] = await Promise.all([
      sb.from("job_states").select("is_inspection").eq("id", effectiveStateId).maybeSingle(),
      sb.from("jobs").select("address").eq("id", jobId).maybeSingle(),
      sb.from("locations").select("timezone").eq("id", locationId).maybeSingle(),
      sb.from("company_settings").select("owner_contact_id, office_contact_id").eq("location_id", locationId).maybeSingle(),
    ]);
    const isInspection = state?.is_inspection === true;
    const tz = (typeof loc?.timezone === "string" && loc.timezone.trim()) || "America/Chicago";
    const { date: localToday } = localContext(tz, new Date());
    const ownerContactId = (cs?.owner_contact_id ?? "").trim();

    if (isInspection && ownerContactId && appBaseUrl) {
      if (dateChanged && bodyDate === localToday) {
        const asked = await queueInspectionResultAsk(sb, {
          locationId, jobId, address: jobRow?.address ?? null,
          inspectionDate: bodyDate, ownerContactId,
          officeContactId: cs?.office_contact_id ?? null, appBaseUrl, force: true,
        });
        if (asked) await triggerDrain();
      } else if (stateChanged && !dateChanged) {
        await sb.from("jobs").update({ inspection_date: null }).eq("id", jobId);
        const asked = await queueInspectionDateAsk(sb, {
          locationId, jobId, address: jobRow?.address ?? null,
          ownerContactId, appBaseUrl, localDate: localToday, force: true,
        });
        if (asked) await triggerDrain();
      }
    }

    // Walkthrough scheduling for an OFFICE job update — the walkthrough twin of the
    // inspection block above (2026-07-20 parity: entry asks for a DATE; the APPROVE /
    // PUNCH-LIST ask fires on the scheduled day):
    //  • the update MOVED the job into a walkthrough-capable state (no date in the same
    //    save) → a new cycle begins: void any stale date + text the owner the schedule
    //    link immediately (queueWalkthroughScheduleAsk self-gates, so any other state
    //    change is a silent no-op).
    //  • walkthrough_date (re)set to TODAY → the APPROVE / PUNCH-LIST ask is due NOW
    //    (covers both a date-only save and a state+today save in one; change-gated so a
    //    no-op re-save stays quiet; fresh uuid key per genuine change).
    if (appBaseUrl) {
      if (stateChanged && !wtDateChanged) {
        const asked = await queueWalkthroughScheduleAsk(sb, {
          id: jobId, location_id: locationId, state_set_id: existing.state_set_id,
          current_state_id: effectiveStateId, address: jobRow?.address ?? null,
        }, { appBaseUrl });
        if (asked) await triggerDrain();
      } else if (wtDateChanged && bodyWtDate === localToday && ownerContactId) {
        const wtCapable = await stateOffersWalkthroughApproved(sb, existing.state_set_id, effectiveStateId);
        if (wtCapable) {
          const asked = await enqueueWalkthroughResultAsk(sb, {
            id: jobId, location_id: locationId, state_set_id: existing.state_set_id,
            current_state_id: effectiveStateId, address: jobRow?.address ?? null,
          }, { appBaseUrl, cycleKey: crypto.randomUUID() });
          if (asked) await triggerDrain();
        }
      }
    }
  }

  // Archiving a job cancels its scheduled Uptiq inspection/walkthrough appointments
  // (best-effort) so the calendar doesn't keep dead slots. Only on the active true -> false
  // transition.
  if ("active" in body && patch.active === false && existing.active) {
    if (existing.inspection_appointment_id) await cancelInspectionAppointment(sb, { jobId });
    if (existing.walkthrough_appointment_id) await cancelInspectionAppointment(sb, { jobId, kind: "walkthrough" });
  }

  const detail = await getJobDetail(sb, locationId, jobId);
  return calendar ? { ...detail, calendar } : detail;
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
      const id = cleanText(url.searchParams.get("id"));
      if (id) {
        const detail = await getJobDetail(sb, locationId, id);
        if (!detail) return json({ error: "not_found" }, 404);
        return json(detail);
      }

      const includeArchived = url.searchParams.get("include_archived") === "true";
      const stateSetId = await defaultStateSet(sb, locationId);
      let query = sb
        .from("jobs")
        .select("*")
        .eq("location_id", locationId)
        .order("updated_at", { ascending: false });
      if (!includeArchived) query = query.eq("active", true);
      const { data: jobs, error } = await query;
      if (error) throw error;

      return json({
        jobs: await hydrateJobs(sb, jobs ?? []),
        states: await statesForSet(sb, stateSetId),
        default_state_set_id: stateSetId,
      });
    }

    if (!canWrite(claims.role)) return json({ error: "forbidden" }, 403);

    if (req.method === "POST") {
      const body = await req.json();
      if (cleanText(body.id)) {
        const updated = await updateExistingJob(sb, locationId, body);
        if (updated?.error) return json({ error: updated.error }, updated.status);
        return json(updated);
      }

      const stateSetId = await defaultStateSet(sb, locationId);
      if (!stateSetId) return json({ error: "missing_state_set" }, 400);
      const stateId = await ensureStateBelongsToSet(
        sb,
        cleanText(body.current_state_id) ?? await firstStateId(sb, stateSetId),
        stateSetId,
      );

      const address = cleanText(body.address);
      if (!address) return json({ error: "address_required" }, 400);

      const { data: job, error } = await sb
        .from("jobs")
        .insert({
          location_id: locationId,
          state_set_id: stateSetId,
          current_state_id: stateId,
          address,
          state_progress_pct: Math.max(0, Math.min(100, numberValue(body.state_progress_pct))),
          job_completion_pct: Math.max(0, Math.min(100, numberValue(body.job_completion_pct))),
          total_hours: Math.max(0, numberValue(body.total_hours)),
          original_estimate: nullableNumber(body.original_estimate),
          invoice_number: cleanText(body.invoice_number),
          start_date: cleanText(body.start_date),
          inspection_date: cleanText(body.inspection_date),
          scope_of_work: cleanText(body.scope_of_work),
          notes: cleanText(body.notes),
          active: body.active !== false,
        })
        .select("*")
        .single();
      if (error) throw error;

      await replaceJobPeople(sb, locationId, job.id, body);
      // A new job created with an inspection date lands on the Uptiq inspections calendar too.
      let calendar: InspectionCalendarResult | undefined;
      if (cleanText(body.inspection_date)) {
        calendar = await syncInspectionAppointment(sb, { jobId: job.id });
      }
      const detail = await getJobDetail(sb, locationId, job.id);
      return json(calendar ? { ...detail, calendar } : detail, 201);
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      if (cleanText(body.action) === "mark_paid") {
        const updatedJob = await markJobPaid(sb, {
          locationId,
          jobId: cleanText(body.id),
          paidSource: body.paid_source ?? "manual",
          actorAppUserId: cleanText(claims.sub),
          invoiceId: body.invoice_id,
          invoiceNumber: body.invoice_number,
          paymentEventId: body.payment_event_id,
          paymentNotes: body.payment_notes,
          eventSource: "admin",
        });
        return json(await getJobDetail(sb, locationId, updatedJob.id));
      }

      // Office "push through a result" — fire an inspection/walkthrough decision from the
      // app exactly as if the owner had tapped the SMS link. Runs the shared decision spine
      // (state advance + follow-on texts/emails + walkthrough ask + completion report +
      // review tag + audit); the signed-in manager is the actor. This is the notify-and-
      // advance counterpart to the raw current_state_id dropdown, which only slams the state.
      if (cleanText(body.action) === "fire_decision") {
        const jobId = cleanText(body.id);
        if (!jobId) return json({ error: "id_required" }, 400);
        const decisionAction = cleanText(body.decision_action);
        const decision = decisionAction ? resolveDecision(decisionAction) : null;
        if (!decision) return json({ error: "unknown_decision", decision_action: decisionAction }, 422);

        const { data: job, error: jErr } = await sb
          .from("jobs")
          .select("id, location_id, address, state_set_id, current_state_id")
          .eq("location_id", locationId)
          .eq("id", jobId)
          .maybeSingle();
        if (jErr) throw jErr;
        if (!job) return json({ error: "not_found" }, 404);

        // Gate the decision to the job's current state kind (defense in depth beyond the UI).
        const { data: state } = await sb
          .from("job_states").select("is_inspection, is_walkthrough, slug").eq("id", job.current_state_id).maybeSingle();
        if (!decisionAllowedForState(decision.action, state)) {
          return json({ error: "decision_not_allowed_for_state", decision_action: decision.action }, 409);
        }

        const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim() || undefined;
        const result = await applyDecision(sb, decision, job, {
          actorAppUserId: cleanText(claims.sub),
          appBaseUrl,
          cycleKey: crypto.randomUUID(),
          source: "app",
        });

        const detail = await getJobDetail(sb, locationId, jobId);
        if (!detail) return json({ error: "not_found" }, 404);
        return json({
          ...detail,
          decision: {
            changed: result.changed,
            to_state_id: result.toStateId,
            reason: result.reason,
            enqueued: result.enqueued,
            walkthrough_asked: result.walkthroughAsked,
            completion_report_built: result.completionReportBuilt,
            review_request_queued: result.reviewRequestQueued,
          },
        });
      }

      // DEBUG: hard-delete a job and everything under it. Every job_id child (daily_logs,
      // job_expenses, purchase_orders, job_crew, job_customers, action_tokens,
      // scheduled_notifications) is ON DELETE CASCADE, so deleting the job row clears them;
      // event_log links the job via its JSON payload (no FK), so it's swept explicitly. Only
      // works while this company's debug_mode is on (defense in depth beyond the debug-gated UI)
      // — this is a testing reset, not the normal "remove a job" path (that's Archive). dry_run
      // returns the child counts without deleting so the UI can preview.
      if (cleanText(body.action) === "delete_job") {
        // Debug/reset tool: dev_super, support_admin, or an Owner granted the jobs_clear tool.
        if (!(await canUseDebugTool(sb, claims, "jobs_clear"))) return json({ error: "forbidden" }, 403);
        const jobId = cleanText(body.id);
        if (!jobId) return json({ error: "id_required" }, 400);
        const dryRun = body.dry_run === true;

        const { data: cs } = await sb
          .from("company_settings").select("debug_mode").eq("location_id", locationId).maybeSingle();
        if (!cs?.debug_mode) return json({ error: "debug_disabled" }, 403);

        const { data: job } = await sb
          .from("jobs").select("id, address, inspection_appointment_id, walkthrough_appointment_id").eq("location_id", locationId).eq("id", jobId).maybeSingle();
        if (!job) return json({ error: "not_found" }, 404);

        const countOf = async (table: string) => {
          const { count } = await sb.from(table).select("*", { count: "exact", head: true }).eq("job_id", jobId);
          return count ?? 0;
        };
        const counts = {
          daily_logs: await countOf("daily_logs"),
          expenses: await countOf("job_expenses"),
          purchase_orders: await countOf("purchase_orders"),
          notifications: await countOf("scheduled_notifications"),
        };

        if (dryRun) {
          return json({ ok: true, dry_run: true, job: { id: job.id, address: job.address }, counts });
        }

        // A synced inspection appointment must be cancelled BEFORE the row goes away (the helper
        // reads the job) — otherwise the debug delete strands a dead event on the real Uptiq
        // calendar, which Archive already guards against. Best-effort (never throws); the outcome
        // is recorded in the audit row below because the helper's own event_log entry is swept.
        const calendar = job.inspection_appointment_id
          ? (await cancelInspectionAppointment(sb, { jobId })).action
          : null;
        const wtCalendar = job.walkthrough_appointment_id
          ? (await cancelInspectionAppointment(sb, { jobId, kind: "walkthrough" })).action
          : null;

        await sb.from("event_log").delete().eq("location_id", locationId).eq("payload->>job_id", jobId);
        const { error: delErr } = await sb.from("jobs").delete().eq("location_id", locationId).eq("id", jobId);
        if (delErr) throw delErr;

        await logEvent({
          source: "admin", kind: "job.debug_delete", location_id: locationId,
          payload: { job_id: jobId, address: job.address, counts, calendar, wt_calendar: wtCalendar, by: claims.email },
        });
        return json({ ok: true, dry_run: false, deleted: true, job: { id: job.id, address: job.address }, counts });
      }

      const updated = await updateExistingJob(sb, locationId, body);
      if (updated?.error) return json({ error: updated.error }, updated.status);
      return json(updated);
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, errorStatus(message));
  }
});
