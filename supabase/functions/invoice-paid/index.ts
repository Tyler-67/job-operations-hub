/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /invoice-paid - Uptiq invoice-paid webhook intake.
// Requires x-cron-secret and only marks a job paid after resolving the Uptiq location.
import { json, preflight, serviceClient } from "../_shared/util.ts";
import { cleanText, markJobPaid } from "../_shared/job-payments.ts";

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function getPath(input: unknown, path: string[]) {
  let current = input;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function duplicateError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
  return message.toLowerCase().includes("duplicate");
}

function webhookSecretGuard(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const got = req.headers.get("x-cron-secret") ?? urlSecret;
  if (!expected || got !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

function locationExternalId(body: Record<string, unknown>) {
  return firstText(
    body.locationId,
    body.location_id,
    body.altId,
    body.alt_id,
    getPath(body, ["location", "id"]),
    getPath(body, ["invoice", "locationId"]),
  );
}

function invoiceId(body: Record<string, unknown>) {
  return firstText(
    body.invoiceId,
    body.invoice_id,
    body.invoiceID,
    body._id,
    getPath(body, ["invoice", "id"]),
    getPath(body, ["invoice", "_id"]),
  );
}

function invoiceNumber(body: Record<string, unknown>) {
  return firstText(
    body.invoiceNumber,
    body.invoice_number,
    body.invoiceNo,
    getPath(body, ["invoice", "number"]),
    getPath(body, ["invoice", "invoiceNumber"]),
  );
}

function eventId(body: Record<string, unknown>, invoiceIdValue: string | null, invoiceNumberValue: string | null) {
  return firstText(
    body.eventId,
    body.event_id,
    body.webhookId,
    body.webhook_id,
    body.id,
    getPath(body, ["event", "id"]),
    invoiceIdValue,
    invoiceNumberValue,
  );
}

function isPaidInvoice(body: Record<string, unknown>) {
  const status = firstText(
    body.status,
    body.paymentStatus,
    body.invoiceStatus,
    getPath(body, ["invoice", "status"]),
  );
  if (!status) return true;

  const normalized = status.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized.includes("partial")) return false;
  return ["paid", "success", "succeeded", "paymentreceived"].includes(normalized) || normalized.endsWith("paid");
}

function paidSource(body: Record<string, unknown>) {
  const hint = firstText(
    body.source,
    body.provider,
    body.integration,
    getPath(body, ["payment", "source"]),
    getPath(body, ["invoice", "source"]),
  )?.toLowerCase() ?? "";
  return hint.includes("quickbook") ? "quickbooks" : "uptiq_invoice";
}

async function resolveLocation(sb: any, externalId: string | null) {
  if (!externalId) return null;
  const { data, error } = await sb
    .from("locations")
    .select("id, uptiq_location_id")
    .eq("uptiq_location_id", externalId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function findInvoiceJob(sb: any, locationId: string, invoiceIdValue: string | null, invoiceNumberValue: string | null) {
  for (const [column, value] of [["invoice_id", invoiceIdValue], ["invoice_number", invoiceNumberValue]] as const) {
    if (!value) continue;
    const { data, error } = await sb
      .from("jobs")
      .select("id")
      .eq("location_id", locationId)
      .eq(column, value)
      .limit(2);
    if (error) throw error;
    if ((data ?? []).length > 1) throw new Error("ambiguous_invoice_match");
    if ((data ?? []).length === 1) return data![0];
  }
  return null;
}

async function updateEvent(sb: any, dedupeKey: string, patch: Record<string, unknown>) {
  await sb.from("event_log").update(patch).eq("dedupe_key", dedupeKey);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const guard = webhookSecretGuard(req);
  if (guard) return guard;

  const sb = serviceClient();
  let dedupeKey: string | null = null;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const externalLocationId = locationExternalId(body);
    const loc = await resolveLocation(sb, externalLocationId);
    if (!loc) {
      return json({ error: "unknown_location" }, 400);
    }

    const invoiceIdValue = invoiceId(body);
    const invoiceNumberValue = invoiceNumber(body);
    const eventIdValue = eventId(body, invoiceIdValue, invoiceNumberValue);
    if (!eventIdValue) return json({ error: "event_id_required" }, 400);

    dedupeKey = `invoice_paid:${loc.id}:${eventIdValue}`;
    const { error: eventErr } = await sb.from("event_log").insert({
      source: "webhook",
      kind: "invoice_paid",
      dedupe_key: dedupeKey,
      location_id: loc.id,
      payload: body,
      status: "received",
    });
    if (eventErr) {
      if (duplicateError(eventErr)) return json({ ok: true, duplicate: true });
      throw eventErr;
    }

    if (!isPaidInvoice(body)) {
      await updateEvent(sb, dedupeKey, { status: "ignored", result: { reason: "invoice_not_paid" } });
      return json({ ok: true, ignored: true, reason: "invoice_not_paid" });
    }

    const job = await findInvoiceJob(sb, loc.id, invoiceIdValue, invoiceNumberValue);
    if (!job) {
      await updateEvent(sb, dedupeKey, {
        status: "unmatched",
        result: { invoice_id: invoiceIdValue, invoice_number: invoiceNumberValue },
      });
      return json({ ok: true, matched: false });
    }

    const updated = await markJobPaid(sb, {
      locationId: loc.id,
      jobId: job.id,
      paidSource: paidSource(body),
      invoiceId: invoiceIdValue,
      invoiceNumber: invoiceNumberValue,
      paymentEventId: eventIdValue,
      paymentNotes: "Invoice paid webhook",
      eventSource: "webhook",
    });

    await updateEvent(sb, dedupeKey, {
      status: "processed",
      result: { job_id: updated.id, invoice_id: invoiceIdValue, invoice_number: invoiceNumberValue },
    });
    return json({ ok: true, matched: true, job_id: updated.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (dedupeKey) await updateEvent(sb, dedupeKey, { status: "error", error: message });
    const status = message === "ambiguous_invoice_match"
      ? 409
      : ["id_required", "invalid_paid_source", "missing_paid_state"].includes(message)
        ? 400
        : 500;
    return json({ error: message }, status);
  }
});
