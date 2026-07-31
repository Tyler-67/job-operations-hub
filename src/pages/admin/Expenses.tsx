import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Save, Search, Trash2, X } from "lucide-react";
import {
  canManageExpenses,
  createExpense,
  createPurchaseOrder,
  dateLabel,
  deleteExpense,
  fetchExpenses,
  money,
  updateExpense,
  updatePurchaseOrder,
  type ExpensesResponse,
  type JobExpenseWithDetails,
  type PurchaseOrderWithDetails,
  type PoStatus,
} from "@/lib/expenses";
import { fetchPhotoReadUrls, isPdfPath } from "@/lib/photos";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";
import { SortableTh, shouldIgnoreRowClick, useTableSort, type SortAccessors } from "@/components/SortableTable";

const PO_SORT: SortAccessors<PurchaseOrderWithDetails> = {
  job: (po) => po.job?.address ?? null,
  status: (po) => po.status,
  supply: (po) => po.supply_house?.name ?? null,
  po: (po) => po.description ?? null,
  estimate: (po) => po.estimated_amount,
  final: (po) => po.final_amount,
  sent: (po) => po.sent_at,
};

const EXPENSE_SORT: SortAccessors<JobExpenseWithDetails> = {
  job: (expense) => expense.job?.address ?? null,
  kind: (expense) => expense.kind,
  vendor: (expense) => expense.vendor,
  description: (expense) => expense.description,
  amount: (expense) => expense.amount,
};

type Tab = "po_queue" | "expenses" | "purchase_orders";
type Panel = "expense" | "po" | "edit_po";

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

interface PoEditForm {
  estimated_amount: string;
  final_amount: string;
  sent: boolean;
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

// Display labels for the enum-backed cells. These fill their cell now rather than sitting
// in a `.pill` (which uppercased via CSS), so the text carries its own capitalization.
function poStatusLabel(status: string) {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const EXPENSE_KIND_LABELS: Record<string, string> = {
  field_purchase: "Field purchase",
  adjustment: "Adjustment",
  po: "PO",
};

function expenseKindLabel(kind: string) {
  return EXPENSE_KIND_LABELS[kind] ?? kind;
}

// The one "+ Add" button (replaces the separate Expense / PO plus boxes): a primary
// button opening a two-item menu. Styled like the old expense "+".
function AddMenu({ onExpense, onPo }: { onExpense: () => void; onPo: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
        <Plus className="h-3.5 w-3.5" />
        Add
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-sm border border-border bg-card shadow-md">
          <button type="button" onClick={() => { setOpen(false); onExpense(); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-muted">New expense</button>
          <button type="button" onClick={() => { setOpen(false); onPo(); }} className="block w-full border-t border-border px-3 py-2 text-left text-xs hover:bg-muted">New purchase order</button>
        </div>
      )}
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
  const [editTarget, setEditTarget] = useState<PurchaseOrderWithDetails | null>(null);
  const [editForm, setEditForm] = useState<PoEditForm>({ estimated_amount: "", final_amount: "", sent: false, description: "" });
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
    setEditTarget(null);
    setExpenseForm(blankExpense(nextData?.jobs[0]?.id ?? ""));
  }

  function resetPoForm(nextData = data) {
    setPanel("po");
    setEditTarget(null);
    setPoForm(blankPo(nextData?.jobs[0]?.id ?? ""));
  }

  function editExpense(expense: JobExpenseWithDetails) {
    if (expense.purchase_order_id) return;
    setPanel("expense");
    setEditTarget(null);
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

  // Row click: a PO-sourced expense opens its PO's edit pane (the expense itself isn't
  // editable — its value IS the PO), everything else opens the expense form. View-only
  // roles open the panes too — every field is disabled for them, but this is how they
  // see an expense's details and photos.
  function openExpense(expense: JobExpenseWithDetails) {
    if (expense.purchase_order_id) {
      const po = purchaseOrders.find((candidate) => candidate.id === expense.purchase_order_id);
      if (po) startEditPo(po);
      return;
    }
    editExpense(expense);
  }

  function startEditPo(po: PurchaseOrderWithDetails) {
    setPanel("edit_po");
    setEditTarget(po);
    setEditForm({
      estimated_amount: amountInput(po.estimated_amount),
      final_amount: amountInput(po.final_amount),
      sent: Boolean(po.sent_at),
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

  async function removeExpense(id: string) {
    const expense = expenses.find((candidate) => candidate.id === id);
    if (!canManage || !expense || expense.purchase_order_id) return;
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

  async function savePoEdit() {
    if (!canManage || !editTarget) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updatePurchaseOrder({
        id: editTarget.id,
        estimated_amount: parseAmount(editForm.estimated_amount),
        final_amount: parseAmount(editForm.final_amount),
        sent: editForm.sent,
        description: editForm.description.trim() || null,
      });
      setData(includeArchived ? await fetchExpenses(true) : next);
      setEditTarget(null);
      setEditForm({ estimated_amount: "", final_amount: "", sent: false, description: "" });
      setPanel("expense");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update PO");
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
        {canManage && <AddMenu onExpense={() => resetExpenseForm()} onPo={() => resetPoForm()} />}
      </div>

      {/* The old metric-tile bar is gone: pending-PO count lives on its tab, the money
          totals live in the table heads, and job/PO status reads off the filled cells. */}
      <div className="flex gap-2 border-b border-border bg-card px-4 py-2">
        <TabButton active={tab === "po_queue"} onClick={() => setTab("po_queue")}>{`PO Queue (${pendingQueue.length})`}</TabButton>
        <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")}>{`Expenses (${expenses.length})`}</TabButton>
        <TabButton active={tab === "purchase_orders"} onClick={() => setTab("purchase_orders")}>{`All POs (${purchaseOrders.length})`}</TabButton>
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading expenses...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
          <main className="overflow-auto">
            {tab === "expenses" ? (
              <ExpensesTable
                rows={filteredExpenses}
                activeJobCount={data?.metrics.active_job_count ?? 0}
                selectedId={panel === "expense" ? expenseForm.id ?? null : null}
                onOpen={openExpense}
              />
            ) : (
              <PurchaseOrdersTable
                rows={filteredPurchaseOrders}
                activeJobCount={data?.metrics.active_job_count ?? 0}
                selectedId={panel === "edit_po" ? editTarget?.id ?? null : null}
                onEdit={startEditPo}
                showStatus={tab === "purchase_orders"}
              />
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
            ) : panel === "edit_po" && editTarget ? (
              <EditPoPanel
                canManage={canManage}
                po={editTarget}
                form={editForm}
                saving={saving}
                onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                onSave={savePoEdit}
                onCancel={() => { setEditTarget(null); setPanel("expense"); }}
              />
            ) : (
              <ExpensePanel
                canManage={canManage}
                jobs={jobs}
                supplyHouses={supplyHouses}
                form={expenseForm}
                saving={saving}
                photoUrls={photoUrls}
                onChange={(patch) => setExpenseForm((current) => ({ ...current, ...patch }))}
                onSave={saveExpense}
                onDelete={() => { if (expenseForm.id) void removeExpense(expenseForm.id); }}
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

function PurchaseOrdersTable({ rows, activeJobCount, selectedId, onEdit, showStatus }: {
  rows: PurchaseOrderWithDetails[];
  activeJobCount: number;
  selectedId: string | null;
  onEdit: (po: PurchaseOrderWithDetails) => void;
  showStatus: boolean;
}) {
  const { sorted, sort, toggleSort } = useTableSort(rows, PO_SORT);
  const estimateTotal = rows.reduce((sum, po) => sum + (po.estimated_amount ?? 0), 0);
  const finalTotal = rows.reduce((sum, po) => sum + (po.final_amount ?? 0), 0);
  return (
    <table className="ops-grid w-full table-fixed border-collapse text-xs">
      <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
        <tr>
          {/* Percentage widths only — fixed pixel columns over-constrain the fixed-layout
              table at narrower viewports and squeeze the auto (PO) column to nothing. */}
          <SortableTh label={`Job (${activeJobCount} active)`} sortKey="job" sort={sort} onSort={toggleSort} className="w-[22%]" />
          {showStatus && <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="w-[11%]" />}
          <SortableTh label="Supply house" sortKey="supply" sort={sort} onSort={toggleSort} className="w-[14%]" />
          <SortableTh label="PO" sortKey="po" sort={sort} onSort={toggleSort} />
          <SortableTh label={`Estimate (${money(estimateTotal)})`} sortKey="estimate" sort={sort} onSort={toggleSort} align="right" className="w-[14%]" />
          <SortableTh label={`Final (${money(finalTotal)})`} sortKey="final" sort={sort} onSort={toggleSort} align="right" className="w-[14%]" />
          <SortableTh label="Sent" sortKey="sent" sort={sort} onSort={toggleSort} className="w-[10%]" />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && (
          <tr>
            <td colSpan={showStatus ? 7 : 6} className="p-8 text-center text-muted-foreground">No purchase orders match the current filters.</td>
          </tr>
        )}
        {sorted.map((po) => (
          <tr
            key={po.id}
            tabIndex={0}
            className={`ops-row cursor-pointer ${selectedId === po.id ? "bg-muted/50" : ""}`}
            onClick={(event) => { if (!shouldIgnoreRowClick(event)) onEdit(po); }}
            onKeyDown={(event) => { if (event.key === "Enter") onEdit(po); }}
          >
            {/* Archived jobs read off the cell itself (muted fill + inline suffix) — one line,
                so every row keeps the same height. */}
            <td className={`px-3 py-2 ${po.job?.active ? "" : "bg-muted/60"}`}>
              <div className="truncate font-medium">
                {po.job?.address ?? "-"}
                {!po.job?.active && <span className="ml-1 font-normal text-2xs text-muted-foreground">Archived</span>}
              </div>
            </td>
            {showStatus && (
              <td className={`px-3 py-2 font-medium ${po.status === "pending_value" ? "bg-warning/20 text-warning" : po.status === "valued" ? "bg-success/10 text-success" : "text-muted-foreground"}`}>
                {poStatusLabel(po.status)}
              </td>
            )}
            <td className="truncate px-3 py-2 text-muted-foreground">{po.supply_house?.name ?? "-"}</td>
            {/* Description only — the PO id lives in the edit pane, not the row. */}
            <td className="px-3 py-2">
              <div className="truncate">{po.description ?? "-"}</div>
            </td>
            <td className="px-3 py-2 text-right font-mono-num">{money(po.estimated_amount)}</td>
            <td className="px-3 py-2 text-right font-mono-num">{money(po.final_amount)}</td>
            <td className="px-3 py-2 text-muted-foreground">{dateLabel(po.sent_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpensesTable({ rows, activeJobCount, selectedId, onOpen }: {
  rows: JobExpenseWithDetails[];
  activeJobCount: number;
  selectedId: string | null;
  onOpen: (expense: JobExpenseWithDetails) => void;
}) {
  const { sorted, sort, toggleSort } = useTableSort(rows, EXPENSE_SORT);
  const amountTotal = rows.reduce((sum, expense) => sum + (expense.amount ?? 0), 0);
  return (
    <table className="ops-grid w-full table-fixed border-collapse text-xs">
      <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <SortableTh label={`Job (${activeJobCount} active)`} sortKey="job" sort={sort} onSort={toggleSort} className="w-[24%]" />
          <SortableTh label="Kind" sortKey="kind" sort={sort} onSort={toggleSort} className="w-[12%]" />
          <SortableTh label="Vendor" sortKey="vendor" sort={sort} onSort={toggleSort} className="w-[15%]" />
          <SortableTh label="Description" sortKey="description" sort={sort} onSort={toggleSort} />
          <SortableTh label={`Amount (${money(amountTotal)})`} sortKey="amount" sort={sort} onSort={toggleSort} align="right" className="w-[16%]" />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && (
          <tr>
            <td colSpan={5} className="p-8 text-center text-muted-foreground">No expenses match the current filters.</td>
          </tr>
        )}
        {sorted.map((expense) => (
          <tr
            key={expense.id}
            tabIndex={0}
            className={`ops-row cursor-pointer ${selectedId === expense.id ? "bg-muted/50" : ""}`}
            onClick={(event) => { if (!shouldIgnoreRowClick(event)) onOpen(expense); }}
            onKeyDown={(event) => { if (event.key === "Enter") onOpen(expense); }}
          >
            <td className={`px-3 py-2 ${expense.job?.active ? "" : "bg-muted/60"}`}>
              <div className="truncate font-medium">
                {expense.job?.address ?? "-"}
                {!expense.job?.active && <span className="ml-1 font-normal text-2xs text-muted-foreground">Archived</span>}
              </div>
            </td>
            {/* Kind fills its whole cell, matching the state cells on the job tables. */}
            <td className={`px-3 py-2 font-medium ${expense.kind === "po" ? "bg-success/10 text-success" : expense.kind === "adjustment" ? "bg-info/10 text-info" : "text-muted-foreground"}`}>
              {expenseKindLabel(expense.kind)}
            </td>
            <td className="truncate px-3 py-2 text-muted-foreground">{expense.vendor ?? "-"}</td>
            <td className="px-3 py-2">
              <div className="truncate">{expense.description ?? "-"}</div>
            </td>
            <td className="px-3 py-2 text-right font-mono-num">{money(expense.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpensePanel({ canManage, jobs, supplyHouses, form, saving, photoUrls, onChange, onSave, onDelete, onCancel }: {
  canManage: boolean;
  jobs: ExpensesResponse["jobs"];
  supplyHouses: ExpensesResponse["supply_houses"];
  form: ExpenseForm;
  saving: boolean;
  photoUrls: Record<string, string | null>;
  onChange: (patch: Partial<ExpenseForm>) => void;
  onSave: () => void;
  onDelete: () => void;
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

      {/* Photos live behind an expander in the form — the table row stays clean, and no
          raw storage URL is ever shown. The paths stay in form state so saves keep them. */}
      {(form.receipt_url || form.parts_photo_url) && (
        <PanelPhotos receipt={form.receipt_url || null} parts={form.parts_photo_url || null} urls={photoUrls} />
      )}

      <div className="flex gap-2 border-t border-border pt-4">
        <button type="button" disabled={!canManage || saving || !form.job_id || !form.amount.trim()} onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
        {form.id && (
          <button type="button" disabled={!canManage || saving} onClick={onDelete} className="ml-auto inline-flex h-8 items-center gap-1 rounded-sm border border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Collapsed by default: the expense's receipt / parts photos, revealed on demand inside
// the form pane. Images open full size in a new tab; PDF receipts render as a link.
function PanelPhotos({ receipt, parts, urls }: { receipt: string | null; parts: string | null; urls: Record<string, string | null> }) {
  const [open, setOpen] = useState(false);
  const count = (receipt ? 1 : 0) + (parts ? 1 : 0);
  return (
    <div className="rounded-sm border border-border">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between px-2 py-2 text-xs hover:bg-muted">
        <span className="text-muted-foreground">Photos ({count})</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-2">
          {receipt && <PanelPhoto path={receipt} urls={urls} label="Receipt" />}
          {parts && <PanelPhoto path={parts} urls={urls} label="Parts" />}
        </div>
      )}
    </div>
  );
}

function PanelPhoto({ path, urls, label }: { path: string; urls: Record<string, string | null>; label: string }) {
  const url = urls[path];
  return (
    <div>
      <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {!url ? (
        <div className="text-2xs text-muted-foreground">Loading…</div>
      ) : isPdfPath(path) ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open PDF</a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title={`${label} — open full size`}>
          <img src={url} alt={label} className="max-h-56 w-full rounded-sm border border-border bg-muted/30 object-contain" loading="lazy" />
        </a>
      )}
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

function EditPoPanel({ canManage, po, form, saving, onChange, onSave, onCancel }: {
  canManage: boolean;
  po: PurchaseOrderWithDetails;
  form: PoEditForm;
  saving: boolean;
  onChange: (patch: Partial<PoEditForm>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Edit PO</h2>
        <p className="mt-1 text-xs text-muted-foreground">{po.job?.address ?? "-"} · {po.supply_house?.name ?? "No supply house"}</p>
        {/* The PO's identity lives here (read-only) instead of cluttering the table rows. */}
        <p className="mt-1 font-mono text-2xs text-muted-foreground">PO id: {po.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Estimate</span>
          <input type="number" step="0.01" value={form.estimated_amount} onChange={(event) => onChange({ estimated_amount: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Final amount</span>
          <input type="number" step="0.01" value={form.final_amount} onChange={(event) => onChange({ final_amount: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={form.sent} onChange={(event) => onChange({ sent: event.target.checked })} disabled={!canManage || saving} />
        <span className="text-muted-foreground">Sent to supply house</span>
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Description</span>
        <textarea value={form.description} onChange={(event) => onChange({ description: event.target.value })} disabled={!canManage || saving} className="min-h-24 w-full resize-none rounded-sm border border-input bg-background px-2 py-2 text-xs" />
      </label>

      <p className="text-2xs text-muted-foreground">A final amount records against the job cost and marks the PO valued; clearing it re-opens the PO to pending.</p>

      <div className="flex gap-2 border-t border-border pt-4">
        <button type="button" disabled={!canManage || saving} onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
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
