import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Archive, DollarSign, RotateCcw, Save } from "lucide-react";
import {
  canManageJobs,
  createJob,
  currency,
  fetchJob,
  fetchJobs,
  markJobPaid,
  shortDate,
  updateJob,
  type JobDetailResponse,
  type JobState,
} from "@/lib/jobs";
import { fetchContacts, type ContactRow } from "@/lib/contacts";
import { useSession } from "@/lib/session";

interface FormState {
  address: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  crew_names: string;
  crew_lead: string;
  current_state_id: string;
  state_progress_pct: string;
  job_completion_pct: string;
  total_hours: string;
  original_estimate: string;
  invoice_number: string;
  start_date: string;
  inspection_date: string;
  scope_of_work: string;
  notes: string;
  active: boolean;
}

const emptyForm: FormState = {
  address: "",
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  crew_names: "",
  crew_lead: "",
  current_state_id: "",
  state_progress_pct: "0",
  job_completion_pct: "0",
  total_hours: "0",
  original_estimate: "",
  invoice_number: "",
  start_date: "",
  inspection_date: "",
  scope_of_work: "",
  notes: "",
  active: true,
};

function dateInput(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function splitCrew(value: string) {
  return value.split(",").map((name) => name.trim()).filter(Boolean);
}

function numberInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function percent(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function nonNegative(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function inputClass(disabled: boolean) {
  return [
    "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring",
    disabled ? "cursor-not-allowed opacity-70" : "",
  ].join(" ");
}

function textAreaClass(disabled: boolean) {
  return [
    "min-h-20 w-full rounded-sm border border-input bg-background px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-ring",
    disabled ? "cursor-not-allowed opacity-70" : "",
  ].join(" ");
}

function paymentSourceLabel(source: string | null | undefined) {
  if (source === "quickbooks") return "QuickBooks";
  if (source === "uptiq_invoice") return "Uptiq invoice";
  if (source === "manual") return "Manual";
  return "-";
}

export default function JobDetail() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { user } = useSession();
  const canManage = canManageJobs(user?.role);

  const [detail, setDetail] = useState<JobDetailResponse | null>(null);
  const [states, setStates] = useState<JobState[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [crewContacts, setCrewContacts] = useState<ContactRow[]>([]);

  // Crew dropdown options come from the contacts table (role=crew, active) — the crew synced
  // from the Uptiq "crew" tag. Only editors need it; the read is admin-gated.
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    fetchContacts()
      .then((res) => { if (active) setCrewContacts(res.contacts.filter((c) => c.role === "crew" && c.active)); })
      .catch(() => { /* leave the dropdown empty on failure — the text field still works */ });
    return () => { active = false; };
  }, [canManage]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const load = isNew
      ? fetchJobs().then((data) => ({ data, detail: null }))
      : fetchJob(id as string).then((data) => ({ data: null, detail: data }));

    load
      .then(({ data, detail: loadedDetail }) => {
        if (!active) return;
        const nextStates = loadedDetail?.states ?? data?.states ?? [];
        setStates(nextStates);
        setDetail(loadedDetail);
        setNotice(null);
        if (isNew) {
          setForm({ ...emptyForm, current_state_id: nextStates[0]?.id ?? "" });
        } else if (loadedDetail) {
          const job = loadedDetail.job;
          setForm({
            address: job.address,
            customer_name: job.customers[0]?.name ?? "",
            customer_email: job.customers[0]?.email ?? "",
            customer_phone: job.customers[0]?.phone ?? "",
            crew_names: job.crew.map((contact) => contact.name).join(", "),
            crew_lead: job.crew.find((contact) => contact.is_lead)?.name ?? "",
            current_state_id: job.current_state_id ?? "",
            state_progress_pct: String(job.state_progress_pct),
            job_completion_pct: String(job.job_completion_pct),
            total_hours: String(job.total_hours),
            original_estimate: numberInput(job.original_estimate),
            invoice_number: job.invoice_number ?? "",
            start_date: dateInput(job.start_date),
            inspection_date: dateInput(job.inspection_date),
            scope_of_work: job.scope_of_work ?? "",
            notes: job.notes ?? "",
            active: job.active,
          });
        }
      })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load job"); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [id, isNew]);

  const currentState = useMemo(
    () => states.find((state) => state.id === form.current_state_id) ?? null,
    [form.current_state_id, states],
  );

  const crewOptions = useMemo(() => splitCrew(form.crew_names), [form.crew_names]);

  // Crew contacts not already on the job (case-insensitive by name), for the "add crew" dropdown.
  const availableCrew = useMemo(() => {
    const chosen = new Set(crewOptions.map((name) => name.toLowerCase()));
    return crewContacts.filter((contact) => contact.name && !chosen.has(contact.name.toLowerCase()));
  }, [crewContacts, crewOptions]);

  function addCrew(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const current = splitCrew(form.crew_names);
    if (current.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return;
    update("crew_names", [...current, clean].join(", "));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setNotice(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        address: form.address,
        current_state_id: form.current_state_id || null,
        state_progress_pct: percent(form.state_progress_pct),
        job_completion_pct: percent(form.job_completion_pct),
        total_hours: nonNegative(form.total_hours),
        original_estimate: form.original_estimate ? nonNegative(form.original_estimate) : null,
        invoice_number: form.invoice_number || null,
        start_date: form.start_date || null,
        inspection_date: form.inspection_date || null,
        scope_of_work: form.scope_of_work || null,
        notes: form.notes || null,
        active: form.active,
        customer: {
          name: form.customer_name || null,
          email: form.customer_email || null,
          phone: form.customer_phone || null,
        },
        crew_names: splitCrew(form.crew_names),
        crew_lead_name: form.crew_lead,
      };
      const saved = isNew ? await createJob(payload) : await updateJob(id as string, payload);
      setDetail(saved);
      setStates(saved.states);
      setForm((current) => ({ ...current, ...{
        state_progress_pct: String(saved.job.state_progress_pct),
        job_completion_pct: String(saved.job.job_completion_pct),
        total_hours: String(saved.job.total_hours),
        original_estimate: numberInput(saved.job.original_estimate),
        invoice_number: saved.job.invoice_number ?? "",
      } }));
      setNotice("Job saved.");
      if (isNew) navigate(`/jobs/${saved.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save job");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (!canManage || isNew || !id) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateJob(id, { id, active: !archived, address: form.address });
      setDetail(saved);
      update("active", !archived);
      setNotice(archived ? "Job archived." : "Job restored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update job status");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid() {
    if (!canManage || isNew || !id) return;
    const invoiceNumber = window.prompt("Invoice number (optional)", form.invoice_number);
    if (invoiceNumber === null) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await markJobPaid(id, {
        invoice_number: invoiceNumber.trim() || null,
        payment_notes: "Marked paid manually from job detail.",
      });
      setDetail(saved);
      setStates(saved.states);
      setForm((current) => ({
        ...current,
        current_state_id: saved.job.current_state_id ?? "",
        state_progress_pct: String(saved.job.state_progress_pct),
        job_completion_pct: String(saved.job.job_completion_pct),
        invoice_number: saved.job.invoice_number ?? current.invoice_number,
        active: saved.job.active,
      }));
      setNotice("Job marked paid.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark job paid");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-xs text-muted-foreground">Loading job...</div>;

  const readOnly = !canManage;
  const job = detail?.job;
  const isPaid = currentState?.slug === "paid" || Boolean(job?.paid_at);
  const canMarkPaid = !readOnly && !isNew && job && !isPaid && currentState?.slug === "complete";

  return (
    <form onSubmit={save} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Link to="/jobs" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border hover:bg-muted" aria-label="Back to jobs">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-sm font-semibold">{isNew ? "New Job" : form.address || "Job"}</h1>
          <p className="text-xs text-muted-foreground">
            {isNew ? "Create the job record the office and field teams will work from." : "Update the job state, schedule, crew, scope, and office context."}
          </p>
        </div>
        <div className="flex-1" />
        {!isNew && job && (
          <span className="pill" style={{ backgroundColor: `${currentState?.color ?? "#64748b"}22`, color: currentState?.color ?? "#64748b" }}>
            {currentState?.label ?? "No state"}
          </span>
        )}
        {!readOnly && !isNew && form.active && (
          <button type="button" onClick={() => setArchived(true)} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        )}
        {canMarkPaid && (
          <button type="button" onClick={handleMarkPaid} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-sm border border-success/40 px-3 text-xs text-success hover:bg-success/10">
            <DollarSign className="h-3.5 w-3.5" />
            Mark Paid
          </button>
        )}
        {!readOnly && !isNew && !form.active && (
          <button type="button" onClick={() => setArchived(false)} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
            <RotateCcw className="h-3.5 w-3.5" />
            Restore
          </button>
        )}
        {!readOnly && (
          <button type="submit" disabled={saving || !form.address.trim() || !form.current_state_id} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}
      {readOnly && (
        <div className="border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          View-only role. Owner admins and office managers can edit job records.
        </div>
      )}
      {!form.active && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          This job is archived. Restore it before sending crew check-ins or managing active work.
        </div>
      )}
      {!readOnly && !loading && states.length === 0 && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          No job states are configured for this company yet, so a job can&#39;t be saved. Set them up in{" "}
          <Link to="/admin/job-states" className="font-medium underline">Admin → Job States</Link>{" "}
          first.
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(520px,1fr)_360px]">
        <div className="overflow-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job address">
              <input required disabled={readOnly} value={form.address} onChange={(event) => update("address", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Current state">
              <select disabled={readOnly} value={form.current_state_id} onChange={(event) => update("current_state_id", event.target.value)} className={inputClass(readOnly)}>
                {states.length === 0 && <option value="">No states configured</option>}
                {states.map((state) => <option key={state.id} value={state.id}>{state.sort_order}. {state.label}</option>)}
              </select>
            </Field>

            <Field label="Customer name">
              <input disabled={readOnly} value={form.customer_name} onChange={(event) => update("customer_name", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Crew">
              <div className="space-y-1.5">
                {!readOnly && (
                  <select
                    disabled={saving}
                    value=""
                    onChange={(event) => addCrew(event.target.value)}
                    className={inputClass(readOnly)}
                  >
                    <option value="">{availableCrew.length ? "+ Add crew from contacts…" : "No more crew contacts"}</option>
                    {availableCrew.map((contact) => (
                      <option key={contact.id} value={contact.name ?? ""}>{contact.name ?? "(unnamed)"}</option>
                    ))}
                  </select>
                )}
                <input disabled={readOnly} value={form.crew_names} onChange={(event) => update("crew_names", event.target.value)} placeholder="Comma-separated crew names" className={inputClass(readOnly)} />
              </div>
            </Field>
            <Field label="Crew lead (gets the daily check-in text)">
              <select disabled={readOnly} value={form.crew_lead} onChange={(event) => update("crew_lead", event.target.value)} className={inputClass(readOnly)}>
                <option value="">Auto (first crew member)</option>
                {crewOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>

            <Field label="Customer email">
              <input disabled={readOnly} type="email" value={form.customer_email} onChange={(event) => update("customer_email", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Customer phone">
              <input disabled={readOnly} value={form.customer_phone} onChange={(event) => update("customer_phone", event.target.value)} className={inputClass(readOnly)} />
            </Field>

            <Field label="Start date">
              <input disabled={readOnly} type="date" value={form.start_date} onChange={(event) => update("start_date", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Inspection date">
              <input disabled={readOnly} type="date" value={form.inspection_date} onChange={(event) => update("inspection_date", event.target.value)} className={inputClass(readOnly)} />
            </Field>

            <Field label="State progress %">
              <input disabled={readOnly} type="number" min="0" max="100" value={form.state_progress_pct} onChange={(event) => update("state_progress_pct", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Job completion %">
              <input disabled={readOnly} type="number" min="0" max="100" value={form.job_completion_pct} onChange={(event) => update("job_completion_pct", event.target.value)} className={inputClass(readOnly)} />
            </Field>

            <Field label="Hours">
              <input disabled={readOnly} type="number" min="0" step="0.25" value={form.total_hours} onChange={(event) => update("total_hours", event.target.value)} className={inputClass(readOnly)} />
            </Field>
            <Field label="Estimate">
              <input disabled={readOnly} type="number" min="0" step="1" value={form.original_estimate} onChange={(event) => update("original_estimate", event.target.value)} className={inputClass(readOnly)} />
            </Field>

            <Field label="Invoice number">
              <input disabled={readOnly} value={form.invoice_number} onChange={(event) => update("invoice_number", event.target.value)} className={inputClass(readOnly)} />
            </Field>

            <div className="col-span-2">
              <Field label="Scope of work">
                <textarea disabled={readOnly} value={form.scope_of_work} onChange={(event) => update("scope_of_work", event.target.value)} className={textAreaClass(readOnly)} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Office notes">
                <textarea disabled={readOnly} value={form.notes} onChange={(event) => update("notes", event.target.value)} className={textAreaClass(readOnly)} />
              </Field>
            </div>
          </div>
        </div>

        <aside className="overflow-auto border-l border-border bg-card">
          {job?.paid_at && (
            <div className="border-b border-border p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment</h2>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Paid date</span>
                  <span className="font-medium">{shortDate(job.paid_at)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium">{paymentSourceLabel(job.paid_source)}</span>
                </div>
                {job.invoice_number && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="font-medium">{job.invoice_number}</span>
                  </div>
                )}
                {job.payment_notes && <div className="text-muted-foreground">{job.payment_notes}</div>}
              </div>
            </div>
          )}

          <div className="border-b border-border p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Job totals</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-sm border border-border p-2">
                <div className="font-mono-num text-sm font-semibold">{currency(job?.total_expenses ?? 0)}</div>
                <div className="text-muted-foreground">Expenses</div>
              </div>
              <div className="rounded-sm border border-border p-2">
                <div className="font-mono-num text-sm font-semibold">{currency(job?.original_estimate ?? Number(form.original_estimate || 0))}</div>
                <div className="text-muted-foreground">Estimate</div>
              </div>
              <div className="rounded-sm border border-border p-2">
                <div className="font-mono-num text-sm font-semibold">{job?.total_hours ?? form.total_hours}</div>
                <div className="text-muted-foreground">Hours</div>
              </div>
              <div className="rounded-sm border border-border p-2">
                <div className="font-mono-num text-sm font-semibold">{detail?.purchase_orders.filter((po) => po.status === "pending_value").length ?? 0}</div>
                <div className="text-muted-foreground">PO values due</div>
              </div>
            </div>
          </div>

          <div className="border-b border-border p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent logs</h2>
            <div className="mt-2 divide-y divide-border text-xs">
              {(detail?.daily_logs ?? []).slice(0, 5).map((log) => (
                <div key={log.id} className="py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{shortDate(log.log_date)}</span>
                    <span className="font-mono-num text-muted-foreground">{log.hours_worked ?? 0}h</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{log.issues || log.parts_list || "Daily check-in submitted"}</div>
                </div>
              ))}
              {(detail?.daily_logs ?? []).length === 0 && <div className="py-3 text-muted-foreground">No daily logs yet.</div>}
            </div>
          </div>

          <div className="border-b border-border p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Purchase orders</h2>
            <div className="mt-2 divide-y divide-border text-xs">
              {(detail?.purchase_orders ?? []).slice(0, 5).map((po) => (
                <div key={po.id} className="flex justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{po.description ?? "Purchase order"}</div>
                    <div className="text-muted-foreground">{po.status.replace(/_/g, " ")}</div>
                  </div>
                  <div className="font-mono-num">{currency(po.final_amount ?? po.estimated_amount ?? 0)}</div>
                </div>
              ))}
              {(detail?.purchase_orders ?? []).length === 0 && <div className="py-3 text-muted-foreground">No purchase orders.</div>}
            </div>
          </div>

          <div className="p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expenses</h2>
            <div className="mt-2 divide-y divide-border text-xs">
              {(detail?.expenses ?? []).slice(0, 5).map((expense) => (
                <div key={expense.id} className="flex justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{expense.vendor ?? expense.kind}</div>
                    <div className="text-muted-foreground">{expense.description ?? expense.kind}</div>
                  </div>
                  <div className="font-mono-num">{currency(expense.amount)}</div>
                </div>
              ))}
              {(detail?.expenses ?? []).length === 0 && <div className="py-3 text-muted-foreground">No expenses recorded.</div>}
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}
