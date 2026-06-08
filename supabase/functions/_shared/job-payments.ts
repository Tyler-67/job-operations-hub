/* eslint-disable @typescript-eslint/no-explicit-any */
const PAID_SOURCES = new Set(["quickbooks", "uptiq_invoice", "manual"]);

export function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function paidSource(value: unknown) {
  const source = cleanText(value) ?? "manual";
  if (!PAID_SOURCES.has(source)) throw new Error("invalid_paid_source");
  return source;
}

async function paidStateId(sb: any, stateSetId: string) {
  const { data, error } = await sb
    .from("job_states")
    .select("id")
    .eq("state_set_id", stateSetId)
    .eq("slug", "paid")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function markJobPaid(sb: any, opts: {
  locationId: string;
  jobId: string | null;
  paidSource?: unknown;
  actorAppUserId?: string | null;
  paidAt?: unknown;
  invoiceId?: unknown;
  invoiceNumber?: unknown;
  paymentEventId?: unknown;
  paymentNotes?: unknown;
  eventSource?: "admin" | "webhook";
}) {
  if (!opts.jobId) throw new Error("id_required");

  const { data: existing, error: existingErr } = await sb
    .from("jobs")
    .select("id, state_set_id, paid_by_app_user_id, invoice_id, invoice_number, payment_event_id, payment_notes")
    .eq("location_id", opts.locationId)
    .eq("id", opts.jobId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (!existing) throw new Error("not_found");

  const stateId = await paidStateId(sb, existing.state_set_id);
  if (!stateId) throw new Error("missing_paid_state");

  const source = paidSource(opts.paidSource);
  const patch = {
    current_state_id: stateId,
    job_completion_pct: 100,
    state_progress_pct: 100,
    active: false,
    paid_at: cleanText(opts.paidAt) ?? new Date().toISOString(),
    paid_source: source,
    paid_by_app_user_id: source === "manual" ? cleanText(opts.actorAppUserId) : existing.paid_by_app_user_id,
    invoice_id: opts.invoiceId === undefined ? existing.invoice_id : cleanText(opts.invoiceId),
    invoice_number: opts.invoiceNumber === undefined ? existing.invoice_number : cleanText(opts.invoiceNumber),
    payment_event_id: opts.paymentEventId === undefined ? existing.payment_event_id : cleanText(opts.paymentEventId),
    payment_notes: opts.paymentNotes === undefined ? existing.payment_notes : cleanText(opts.paymentNotes),
  };

  const { data: updated, error } = await sb
    .from("jobs")
    .update(patch)
    .eq("id", opts.jobId)
    .eq("location_id", opts.locationId)
    .select("*")
    .single();
  if (error) throw error;

  const { error: eventErr } = await sb.from("event_log").insert({
    source: opts.eventSource ?? (source === "manual" ? "admin" : "webhook"),
    kind: "job.paid",
    location_id: opts.locationId,
    actor_app_user_id: patch.paid_by_app_user_id,
    payload: {
      job_id: opts.jobId,
      paid_source: source,
      invoice_id: patch.invoice_id,
      invoice_number: patch.invoice_number,
      payment_event_id: patch.payment_event_id,
    },
    status: "ok",
  });
  if (eventErr) throw eventErr;

  return updated;
}
