import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, DollarSign, FileText, Plus, ReceiptText, Save, Search, Trash2, X } from "lucide-react";
import {
  canManageExpenses,
  createExpense,
  createPurchaseOrder,
  dateLabel,
  deleteExpense,
  fetchExpenses,
  money,
  updateExpense,
  valuePurchaseOrder,
  type ExpensesResponse,
  type JobExpenseWithDetails,
  type PurchaseOrderWithDetails,
  type PoStatus,
} from "@/lib/expenses";
import { fetchPhotoReadUrls, isPdfPath } from "@/lib/photos";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";

type Tab = "po_queue" | "expenses" | "purchase_orders";
type Panel = "expense" | "po" | "value_po";

interface ExpenseForm {
  id?: string;
  job_id: string;
  kind: "field_purchase" | "adjustment";
  amount: string;
  supply_house_id: string;
  vendor: string;
  description: string;
  receipt_url: string;
  parts_photo_url: string;
}

interface PoForm {
  job_id: string;
  supply_house_id: string;
  status: Exclude<PoStatus, "valued">;
  estimated_amount: string;
  description: string;
}

interface ValueForm {
  final_amount: string;
  description: string;
}

function blankExpense(jobId = ""): ExpenseForm {
  return {
    job_id: jobId,
    kind: "field_purchase",
    amount: "",
    supply_house_id: "",
    vendor: "",
    description: "",
    receipt_url: "",
    parts_photo_url: "",
  };
}

function blankPo(jobId = ""): PoForm {
  return {
    job_id: jobId,
    supply_house_id: "",
    status: "pending_value",
    estimated_amount: "",
    description: "",
  };
}

function amountInput(value: number | null | undefined) {
  return typeof value === "number" ? String(value) : "";
}

function parseAmount(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function poStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function expenseKindLabel(kind: string) {
  return kind === "field_purchase" ? "field purchase" : kind;
}

function Metric({ icon: Icon, label, value, tone = "default" }: {
  icon: typeof ReceiptText;
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass = {
    default: "text-foreground",
    warning: "text-warning",
    success: "text-success",
  }[tone];

  return (
    <div className="flex min-h-20 items-center gap-3 border-b border-r border-border bg-card px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted">
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </div>
      <div>
        <div className={`font-mono-num text-lg font-semibold leading-none ${toneClass}`}>{value}</div>
        <div className="mt-1 text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-sm px-3 text-xs font-medium ${active ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

export default function AdminExpenses() {
  const { user } = useSession();
  const canManage = canManageExpenses(user?.role);
  const confirm = useConfirm();
  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [tab, setTab] = useState<Tab>("po_queue");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [panel, setPanel] = useState<Panel>("expense");
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(blankExpense());
  const [poForm, setPoForm] = useState<PoForm>(blankPo());
  const [valueTarget, setValueTarget] = useState<PurchaseOrderWithDetails | null>(null);
  const [valueForm, setValueForm] = useState<ValueForm>({ final_amount: "", description: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextIncludeArchived: boolean) => {
    setLoading(true);
    try {
      const next = await fetchExpenses(nextIncludeArchived);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load expenses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(includeArchived);
  }, [includeArchived, load]);

  const jobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);
  const supplyHouses = useMemo(() => data?.supply_houses ?? [], [data?.supply_houses]);
  const purchaseOrders = useMemo(() => data?.purchase_orders ?? [], [data?.purchase_orders]);
  const expenses = useMemo(() => data?.expenses ?? [], [data?.expenses]);
  const pendingQueue = useMemo(() => purchaseOrders.filter((po) => po.status === "pending_value"), [purchaseOrders]);

  // Signed read URLs for the uploaded receipt/parts photos (private bucket → paths need signing).
  const [photoUrls, setPhotoUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const paths = expenses.flatMap((e) => [e.receipt_url, e.parts_photo_url]);
    if (!paths.some(Boolean)) { setPhotoUrls({}); return; }
    let active = true;
    fetchPhotoReadUrls(paths)
      .then((urls) => { if (active) setPhotoUrls(urls); })
      .catch(() => { /* thumbnails just won't render; the row still shows the expense */ });
    return () => { active = false; };
  }, [expenses]);

  useEffect(() => {
    const firstJobId = jobs[0]?.id ?? "";
    if (!firstJobId) return;
    setExpenseForm((current) => current.job_id ? current : { ...current, job_id: firstJobId });
    setPoForm((current) => current.job_id ? current : { ...current, job_id: firstJobId });
  }, [jobs]);

  const filteredPurchaseOrders = useMemo(() => {
    const rows = tab === "po_queue" ? pendingQueue : purchaseOrders;
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((po) => [
      po.job?.address,
      po.supply_house?.name,
      po.description,
      po.status,
      po.estimated_amount,
      po.final_amount,
    ].join(" ").toLowerCase().includes(needle));
  }, [pendingQueue, purchaseOrders, query, tab]);

  const filteredExpenses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return expenses;
    return expenses.filter((expense) => [
      expense.job?.address,
      expense.kind,
      expense.vendor,
      expense.description,
      expense.amount,
    ].join(" ").toLowerCase().includes(needle));
  }, [expenses, query]);

  function resetExpenseForm(nextData = data) {
    setPanel("expense");
    setValueTarget(null);
    setExpenseForm(blankExpense(nextData?.jobs[0]?.id ?? ""));
  }

  function resetPoForm(nextData = data) {
    setPanel("po");
    setValueTarget(null);
    setPoForm(blankPo(nextData?.jobs[0]?.id ?? ""));
  }

  function editExpense(expense: JobExpenseWithDetails) {
    if (expense.purchase_order_id) return;
    setPanel("expense");
    setValueTarget(null);
    setExpenseForm({
      id: expense.id,
      job_id: expense.job_id,
      kind: expense.kind === "adjustment" ? "adjustment" : "field_purchase",
      amount: amountInput(expense.amount),
      supply_house_id: expense.supply_house_id ?? "",
      vendor: expense.vendor ?? "",
      description: expense.description ?? "",
      receipt_url: expense.receipt_url ?? "",
      parts_photo_url: expense.parts_photo_url ?? "",
    });
  }

  function startValuePo(po: PurchaseOrderWithDetails) {
    setPanel("value_po");
    setValueTarget(po);
    setValueForm({
      final_amount: amountInput(po.final_amount ?? po.estimated_amount),
      description: po.description ?? "",
    });
  }

  async function saveExpense() {
    if (!canManage) return;
    const amount = parseAmount(expenseForm.amount);
    if (amount === null) {
      setError("amount_required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...expenseForm,
        amount,
        supply_house_id: expenseForm.supply_house_id || null,
        vendor: expenseForm.vendor.trim() || null,
        description: expenseForm.description.trim() || null,
        receipt_url: expenseForm.receipt_url.trim() || null,
        parts_photo_url: expenseForm.parts_photo_url.trim() || null,
      };
      const next = expenseForm.id ? await updateExpense(payload) : await createExpense(payload);
      const refreshed = includeArchived ? await fetchExpenses(true) : next;
      setData(refreshed);
      resetExpenseForm(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save expense");
    } finally {
      setSaving(false);
    }
  }

  async function removeExpense(expense: JobExpenseWithDetails) {
    if (!canManage || expense.purchase_order_id) return;
    if (!(await confirm({ title: "Delete this expense?", confirmLabel: "Delete", destructive: true }))) return;
    setSaving(true);
    setError(null);
    try {
      const next = await deleteExpense(expense.id);
      const refreshed = includeArchived ? await fetchExpenses(true) : next;
      setData(refreshed);
      resetExpenseForm(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete expense");
    } finally {
      setSaving(false);
    }
  }

  async function savePo() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await createPurchaseOrder({
        job_id: poForm.job_id,
        supply_house_id: poForm.supply_house_id || null,
        status: poForm.status,
        estimated_amount: parseAmount(poForm.estimated_amount),
        description: poForm.description.trim() || null,
      });
      const refreshed = includeArchived ? await fetchExpenses(true) : next;
      setData(refreshed);
      resetPoForm(refreshed);
      setTab("po_queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create PO");
    } finally {
      setSaving(false);
    }
  }

  async function savePoValue() {
    if (!canManage || !valueTarget) return;
    const amount = parseAmount(valueForm.final_amount);
    if (amount === null) {
      setError("amount_required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await valuePurchaseOrder(valueTarget.id, amount, valueForm.description.trim() || null);
      setData(includeArchived ? await fetchExpenses(true) : next);
      setValueTarget(null);
      setValueForm({ final_amount: "", description: "" });
      setPanel("expense");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not value PO");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Expenses & PO Values</h1>
          <p className="text-xs text-muted-foreground">Office cost queue, field purchases, and PO invoice values.</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search job, vendor, PO..."
            className="h-8 w-64 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <label className="flex h-8 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
          Archived
        </label>
        {canManage && (
          <>
            <button type="button" onClick={() => resetExpenseForm()} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-3.5 w-3.5" />
              Expense
            </button>
            <button type="button" onClick={() => resetPoForm()} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Plus className="h-3.5 w-3.5" />
              PO
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-5">
        <Metric icon={ReceiptText} label="Pending PO values" value={data?.metrics.pending_po_count ?? 0} tone={(data?.metrics.pending_po_count ?? 0) ? "warning" : "success"} />
        <Metric icon={DollarSign} label="Total job costs" value={money(data?.metrics.total_expenses)} />
        <Metric icon={ReceiptText} label="Field purchases" value={money(data?.metrics.total_field_purchase_expenses)} />
        <Metric icon={ClipboardList} label="PO expenses" value={money(data?.metrics.total_po_expenses)} />
        <Metric icon={FileText} label="Active jobs" value={data?.metrics.active_job_count ?? 0} />
      </div>

      <div className="flex gap-2 border-b border-border bg-card px-4 py-2">
        <TabButton active={tab === "po_queue"} onClick={() => setTab("po_queue")}>PO Queue</TabButton>
        <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")}>Expenses</TabButton>
        <TabButton active={tab === "purchase_orders"} onClick={() => setTab("purchase_orders")}>All POs</TabButton>
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading expenses...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
          <main className="overflow-auto">
            {tab === "expenses" ? (
              <ExpensesTable rows={filteredExpenses} canManage={canManage} saving={saving} photoUrls={photoUrls} onEdit={editExpense} onDelete={removeExpense} />
            ) : (
              <PurchaseOrdersTable rows={filteredPurchaseOrders} canManage={canManage} saving={saving} onValue={startValuePo} showStatus={tab === "purchase_orders"} />
            )}
          </main>

          <aside className="overflow-auto border-l border-border bg-card">
            {panel === "po" ? (
              <PoPanel
                canManage={canManage}
                jobs={jobs}
                supplyHouses={supplyHouses}
                form={poForm}
                saving={saving}
                onChange={(patch) => setPoForm((current) => ({ ...current, ...patch }))}
                onSave={savePo}
                onCancel={() => resetPoForm()}
              />
            ) : panel === "value_po" && valueTarget ? (
              <ValuePoPanel
                canManage={canManage}
                po={valueTarget}
                form={valueForm}
                saving={saving}
                onChange={(patch) => setValueForm((current) => ({ ...current, ...patch }))}
                onSave={savePoValue}
                onCancel={() => { setValueTarget(null); setPanel("expense"); }}
              />
            ) : (
              <ExpensePanel
                canManage={canManage}
                jobs={jobs}
                supplyHouses={supplyHouses}
                form={expenseForm}
                saving={saving}
                onChange={(patch) => setExpenseForm((current) => ({ ...current, ...patch }))}
                onSave={saveExpense}
                onCancel={() => resetExpenseForm()}
              />
            )}
          </aside>
        </div>
      )}

      {!canManage && (
        <div className="border-t border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          View-only role.
        </div>
      )}
    </div>
  );
}

function PurchaseOrdersTable({ rows, canManage, saving, onValue, showStatus }: {
  rows: PurchaseOrderWithDetails[];
  canManage: boolean;
  saving: boolean;
  onValue: (po: PurchaseOrderWithDetails) => void;
  showStatus: boolean;
}) {
  return (
    <table className="ops-grid w-full table-fixed border-collapse text-xs">
      <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="w-[25%] border-b border-border px-3 py-2 text-left font-medium">Job</th>
          {showStatus && <th className="w-28 border-b border-border px-3 py-2 text-left font-medium">Status</th>}
          <th className="w-[18%] border-b border-border px-3 py-2 text-left font-medium">Supply house</th>
          <th className="border-b border-border px-3 py-2 text-left font-medium">PO</th>
          <th className="w-24 border-b border-border px-3 py-2 text-right font-medium">Estimate</th>
          <th className="w-24 border-b border-border px-3 py-2 text-right font-medium">Final</th>
          <th className="w-24 border-b border-border px-3 py-2 text-left font-medium">Sent</th>
          <th className="w-20 border-b border-border px-3 py-2 text-right font-medium">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={showStatus ? 8 : 7} className="p-8 text-center text-muted-foreground">No purchase orders match the current filters.</td>
          </tr>
        )}
        {rows.map((po) => (
          <tr key={po.id} className="ops-row">
            <td className="px-3 py-2">
              <div className="truncate font-medium">{po.job?.address ?? "-"}</div>
              {!po.job?.active && <div className="mt-0.5 text-2xs text-muted-foreground">archived</div>}
            </td>
            {showStatus && (
              <td className="px-3 py-2">
                <span className={`pill ${po.status === "pending_value" ? "bg-warning/20 text-warning" : po.status === "valued" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {poStatusLabel(po.status)}
                </span>
              </td>
            )}
            <td className="px-3 py-2 text-muted-foreground">{po.supply_house?.name ?? "-"}</td>
            <td className="px-3 py-2">
              <div className="truncate">{po.description ?? "-"}</div>
              <div className="mt-0.5 font-mono text-2xs text-muted-foreground">{po.id.slice(0, 8)}</div>
            </td>
            <td className="px-3 py-2 text-right font-mono-num">{money(po.estimated_amount)}</td>
            <td className="px-3 py-2 text-right font-mono-num">{money(po.final_amount)}</td>
            <td className="px-3 py-2 text-muted-foreground">{dateLabel(po.sent_at)}</td>
            <td className="px-3 py-2 text-right">
              <button type="button" title="Set final value" disabled={!canManage || saving || po.status === "cancelled"} onClick={() => onValue(po)} className="icon-btn ml-auto">
                <DollarSign className="h-3.5 w-3.5" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PhotoThumb({ path, urls, label }: { path: string | null | undefined; urls: Record<string, string | null>; label: string }) {
  if (!path) return null;
  const url = urls[path];
  if (!url) return <span className="text-2xs text-muted-foreground" title={path}>{label}…</span>;
  if (isPdfPath(path)) {
    return <a href={url} target="_blank" rel="noreferrer" className="text-2xs text-accent hover:underline">{label} (PDF)</a>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`${label} — open full size`}>
      <img src={url} alt={label} className="h-10 w-10 rounded-sm border border-border object-cover" loading="lazy" />
    </a>
  );
}

function ExpensesTable({ rows, canManage, saving, photoUrls, onEdit, onDelete }: {
  rows: JobExpenseWithDetails[];
  canManage: boolean;
  saving: boolean;
  photoUrls: Record<string, string | null>;
  onEdit: (expense: JobExpenseWithDetails) => void;
  onDelete: (expense: JobExpenseWithDetails) => void;
}) {
  return (
    <table className="ops-grid w-full table-fixed border-collapse text-xs">
      <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="w-[25%] border-b border-border px-3 py-2 text-left font-medium">Job</th>
          <th className="w-32 border-b border-border px-3 py-2 text-left font-medium">Kind</th>
          <th className="w-[18%] border-b border-border px-3 py-2 text-left font-medium">Vendor</th>
          <th className="border-b border-border px-3 py-2 text-left font-medium">Description</th>
          <th className="w-24 border-b border-border px-3 py-2 text-right font-medium">Amount</th>
          <th className="w-28 border-b border-border px-3 py-2 text-left font-medium">Photos</th>
          <th className="w-20 border-b border-border px-3 py-2 text-right font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="p-8 text-center text-muted-foreground">No expenses match the current filters.</td>
          </tr>
        )}
        {rows.map((expense) => (
          <tr key={expense.id} className="ops-row">
            <td className="px-3 py-2">
              <div className="truncate font-medium">{expense.job?.address ?? "-"}</div>
              {!expense.job?.active && <div className="mt-0.5 text-2xs text-muted-foreground">archived</div>}
            </td>
            <td className="px-3 py-2">
              <span className={`pill ${expense.kind === "po" ? "bg-success/10 text-success" : expense.kind === "adjustment" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"}`}>
                {expenseKindLabel(expense.kind)}
              </span>
            </td>
            <td className="px-3 py-2 text-muted-foreground">{expense.vendor ?? "-"}</td>
            <td className="px-3 py-2">
              <div className="truncate">{expense.description ?? "-"}</div>
            </td>
            <td className="px-3 py-2 text-right font-mono-num">{money(expense.amount)}</td>
            <td className="px-3 py-2">
              {(expense.receipt_url || expense.parts_photo_url) ? (
                <div className="flex items-center gap-1.5">
                  <PhotoThumb path={expense.receipt_url} urls={photoUrls} label="Receipt" />
                  <PhotoThumb path={expense.parts_photo_url} urls={photoUrls} label="Parts" />
                </div>
              ) : <span className="text-muted-foreground">-</span>}
            </td>
            <td className="px-3 py-2">
              <div className="flex justify-end gap-1">
                <button type="button" title="Edit expense" disabled={!canManage || saving || Boolean(expense.purchase_order_id)} onClick={() => onEdit(expense)} className="icon-btn">
                  <FileText className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="Delete expense" disabled={!canManage || saving || Boolean(expense.purchase_order_id)} onClick={() => onDelete(expense)} className="icon-btn">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpensePanel({ canManage, jobs, supplyHouses, form, saving, onChange, onSave, onCancel }: {
  canManage: boolean;
  jobs: ExpensesResponse["jobs"];
  supplyHouses: ExpensesResponse["supply_houses"];
  form: ExpenseForm;
  saving: boolean;
  onChange: (patch: Partial<ExpenseForm>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">{form.id ? "Edit Expense" : "New Expense"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Field purchases and cost adjustments.</p>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Job</span>
        <InlineSelect
          value={form.job_id}
          onChange={(value) => onChange({ job_id: value })}
          disabled={!canManage || saving || Boolean(form.id)}
          className="w-full"
          options={jobs.map((job) => ({ value: job.id, label: job.address }))}
        />
      </label>

      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Kind</span>
          <InlineSelect
            value={form.kind}
            onChange={(value) => onChange({ kind: value as ExpenseForm["kind"] })}
            disabled={!canManage || saving}
            className="w-full"
            options={[
              { value: "field_purchase", label: "Field purchase" },
              { value: "adjustment", label: "Adjustment" },
            ]}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Amount</span>
          <input type="number" step="0.01" value={form.amount} onChange={(event) => onChange({ amount: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
        </label>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Supply house</span>
        <InlineSelect
          value={form.supply_house_id}
          onChange={(value) => onChange({ supply_house_id: value })}
          disabled={!canManage || saving}
          className="w-full"
          options={[{ value: "", label: "None (free-text vendor)" }, ...supplyHouses.map((supply) => ({ value: supply.id, label: supply.name }))]}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Vendor {form.supply_house_id ? "(using supply house)" : "(free text)"}</span>
        <input value={form.vendor} onChange={(event) => onChange({ vendor: event.target.value })} disabled={!canManage || saving || Boolean(form.supply_house_id)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Description</span>
        <textarea value={form.description} onChange={(event) => onChange({ description: event.target.value })} disabled={!canManage || saving} className="min-h-20 w-full resize-none rounded-sm border border-input bg-background px-2 py-2 text-xs" />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Receipt URL</span>
        <input value={form.receipt_url} onChange={(event) => onChange({ receipt_url: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Parts photo URL</span>
        <input value={form.parts_photo_url} onChange={(event) => onChange({ parts_photo_url: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
      </label>

      <div className="flex gap-2 border-t border-border pt-4">
        <button type="button" disabled={!canManage || saving || !form.job_id || !form.amount.trim()} onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}

function PoPanel({ canManage, jobs, supplyHouses, form, saving, onChange, onSave, onCancel }: {
  canManage: boolean;
  jobs: ExpensesResponse["jobs"];
  supplyHouses: ExpensesResponse["supply_houses"];
  form: PoForm;
  saving: boolean;
  onChange: (patch: Partial<PoForm>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">New PO</h2>
        <p className="mt-1 text-xs text-muted-foreground">Supply house orders waiting for invoice value.</p>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Job</span>
        <InlineSelect
          value={form.job_id}
          onChange={(value) => onChange({ job_id: value })}
          disabled={!canManage || saving}
          className="w-full"
          options={jobs.map((job) => ({ value: job.id, label: job.address }))}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Supply house</span>
        <InlineSelect
          value={form.supply_house_id}
          onChange={(value) => onChange({ supply_house_id: value })}
          disabled={!canManage || saving}
          className="w-full"
          options={[{ value: "", label: "None" }, ...supplyHouses.map((supply) => ({ value: supply.id, label: supply.name }))]}
        />
      </label>

      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Status</span>
          <InlineSelect
            value={form.status}
            onChange={(value) => onChange({ status: value as PoForm["status"] })}
            disabled={!canManage || saving}
            className="w-full"
            options={[
              { value: "pending_value", label: "Pending value" },
              { value: "sent", label: "Sent" },
              { value: "draft", label: "Draft" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Estimate</span>
          <input type="number" step="0.01" value={form.estimated_amount} onChange={(event) => onChange({ estimated_amount: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
        </label>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Description</span>
        <textarea value={form.description} onChange={(event) => onChange({ description: event.target.value })} disabled={!canManage || saving} className="min-h-24 w-full resize-none rounded-sm border border-input bg-background px-2 py-2 text-xs" />
      </label>

      <div className="flex gap-2 border-t border-border pt-4">
        <button type="button" disabled={!canManage || saving || !form.job_id} onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}

function ValuePoPanel({ canManage, po, form, saving, onChange, onSave, onCancel }: {
  canManage: boolean;
  po: PurchaseOrderWithDetails;
  form: ValueForm;
  saving: boolean;
  onChange: (patch: Partial<ValueForm>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">PO Value</h2>
        <p className="mt-1 text-xs text-muted-foreground">{po.job?.address ?? "-"} · {po.supply_house?.name ?? "No supply house"}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-sm border border-border bg-background px-3 py-2">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">Estimate</div>
          <div className="mt-1 font-mono-num font-semibold">{money(po.estimated_amount)}</div>
        </div>
        <div className="rounded-sm border border-border bg-background px-3 py-2">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground">Current final</div>
          <div className="mt-1 font-mono-num font-semibold">{money(po.final_amount)}</div>
        </div>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Final amount</span>
        <input type="number" step="0.01" value={form.final_amount} onChange={(event) => onChange({ final_amount: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Description</span>
        <textarea value={form.description} onChange={(event) => onChange({ description: event.target.value })} disabled={!canManage || saving} className="min-h-24 w-full resize-none rounded-sm border border-input bg-background px-2 py-2 text-xs" />
      </label>

      <div className="flex gap-2 border-t border-border pt-4">
        <button type="button" disabled={!canManage || saving || !form.final_amount.trim()} onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}
