/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";
import { markJobPaid } from "../_shared/job-payments.ts";
import { maybeBuildCompletionReport } from "../_shared/completion-report.ts";
import { maybeEnqueueReviewRequest } from "../_shared/review-request.ts";
import { resolveDecision } from "../_shared/decisions.ts";
import { applyDecision } from "../_shared/apply-decision.ts";
import { syncInspectionAppointment, cancelInspectionAppointment, type InspectionCalendarResult } from "../_shared/inspection-calendar.ts";

const ADMIN_ROLES = new Set(["owner_admin", "office_manager", "support_admin"]);

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
    .select("id, state_set_id, active, inspection_date, inspection_appointment_id")
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
  if ("inspection_date" in body) {
    const newDate = patch.inspection_date as string | null;
    const oldDate = existing.inspection_date ? String(existing.inspection_date).slice(0, 10) : null;
    if (newDate && (newDate !== oldDate || !existing.inspection_appointment_id)) {
      calendar = await syncInspectionAppointment(sb, { jobId });
    }
  }

  // Archiving a job cancels its scheduled Uptiq inspection appointment (best-effort) so the
  // inspections calendar doesn't keep a dead slot. Only on the active true -> false transition.
  if ("active" in body && patch.active === false && existing.active && existing.inspection_appointment_id) {
    await cancelInspectionAppointment(sb, { jobId });
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
