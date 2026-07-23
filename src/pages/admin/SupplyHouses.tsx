import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Warehouse, X } from "lucide-react";
import {
  canManageSupplyHouses,
  createSupplyHouse,
  fetchSupplyHouses,
  updateSupplyHouse,
  type SupplyHouseRow,
  type SupplyHousesResponse,
} from "@/lib/supply-houses";
import { useSession } from "@/lib/session";

interface SupplyHouseForm {
  id?: string;
  name: string;
  rep_name: string;
  address: string;
  phone: string;
  email: string;
  account_number: string;
  uptiq_contact_id: string;
  notes: string;
  active: boolean;
}

function blankForm(): SupplyHouseForm {
  return {
    name: "",
    rep_name: "",
    address: "",
    phone: "",
    email: "",
    account_number: "",
    uptiq_contact_id: "",
    notes: "",
    active: true,
  };
}

function toForm(row: SupplyHouseRow): SupplyHouseForm {
  return {
    id: row.id,
    name: row.name,
    rep_name: row.rep_name ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    account_number: row.account_number ?? "",
    uptiq_contact_id: row.uptiq_contact_id ?? "",
    notes: row.notes ?? "",
    active: row.active,
  };
}

const inputClass = "h-9 w-full rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";

export default function AdminSupplyHouses() {
  const { user } = useSession();
  const canManage = canManageSupplyHouses(user?.role);

  const [data, setData] = useState<SupplyHousesResponse | null>(null);
  const [form, setForm] = useState<SupplyHouseForm>(blankForm());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editing = Boolean(form.id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSupplyHouses()
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load supply houses"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const houses = useMemo(() => data?.supply_houses ?? [], [data?.supply_houses]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return houses;
    return houses.filter((house) => [house.name, house.rep_name, house.email, house.phone, house.address, house.account_number]
      .join(" ").toLowerCase().includes(needle));
  }, [houses, query]);

  function update<K extends keyof SupplyHouseForm>(key: K, value: SupplyHouseForm[K]) {
    setNotice(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm(blankForm());
    setNotice(null);
  }

  async function save() {
    if (!canManage || !form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        id: form.id,
        name: form.name.trim(),
        rep_name: form.rep_name.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim(),
        account_number: form.account_number.trim() || null,
        uptiq_contact_id: form.uptiq_contact_id.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      const next = editing ? await updateSupplyHouse(payload) : await createSupplyHouse(payload);
      setData(next);
      resetForm();
      setNotice("Supply house saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supply house");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Supply Houses</h1>
          <p className="text-xs text-muted-foreground">Vendors your crews order parts from. Used on purchase orders and expenses.</p>
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, rep, account..."
          className="h-8 w-56 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {canManage && (
          <button type="button" onClick={resetForm} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}
      {!canManage && (
        <div className="border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">View-only role.</div>
      )}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading supply houses...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="overflow-auto">
            <table className="ops-grid w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-[24%] border-b border-border px-3 py-2 text-left font-medium">Name</th>
                  <th className="w-[18%] border-b border-border px-3 py-2 text-left font-medium">Rep</th>
                  <th className="w-[18%] border-b border-border px-3 py-2 text-left font-medium">Phone</th>
                  <th className="border-b border-border px-3 py-2 text-left font-medium">Email</th>
                  <th className="w-24 border-b border-border px-3 py-2 text-left font-medium">Account</th>
                  <th className="w-20 border-b border-border px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No supply houses yet. Add one to get started.</td></tr>
                )}
                {filtered.map((house) => (
                  <tr
                    key={house.id}
                    className={`ops-row ${canManage ? "cursor-pointer" : ""} ${form.id === house.id ? "bg-muted/50" : ""}`}
                    onClick={() => canManage && setForm(toForm(house))}
                  >
                    <td className="px-3 py-2 font-medium">{house.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{house.rep_name ?? "-"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{house.phone ?? "-"}</td>
                    <td className="px-3 py-2 text-muted-foreground"><div className="truncate">{house.email ?? "-"}</div></td>
                    <td className="px-3 py-2 text-muted-foreground">{house.account_number ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`pill ${house.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {house.active ? "active" : "inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </main>

          {canManage && (
            <aside className="overflow-auto border-l border-border bg-card">
              <div className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{editing ? "Edit Supply House" : "New Supply House"}</h2>
                </div>

                <Field label="Name" required>
                  <input value={form.name} onChange={(event) => update("name", event.target.value)} disabled={saving} className={inputClass} />
                </Field>
                <Field label="Rep name">
                  <input value={form.rep_name} onChange={(event) => update("rep_name", event.target.value)} disabled={saving} className={inputClass} />
                </Field>
                <Field label="Address">
                  <input value={form.address} onChange={(event) => update("address", event.target.value)} disabled={saving} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Phone">
                    <input value={form.phone} onChange={(event) => update("phone", event.target.value)} disabled={saving} className={inputClass} />
                  </Field>
                  <Field label="Account number">
                    <input value={form.account_number} onChange={(event) => update("account_number", event.target.value)} disabled={saving} className={inputClass} />
                  </Field>
                </div>
                <Field label="Email" required>
                  <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} disabled={saving} className={inputClass} />
                </Field>
                <Field label="Uptiq contact ID (for parts-order emails)">
                  <input value={form.uptiq_contact_id} onChange={(event) => update("uptiq_contact_id", event.target.value)} disabled={saving} className={inputClass} />
                </Field>
                <Field label="Notes">
                  <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} disabled={saving} className="min-h-20 w-full resize-none rounded-sm border border-input bg-background px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
                </Field>
                <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-background px-2 text-xs">
                  <input type="checkbox" checked={form.active} disabled={saving} onChange={(event) => update("active", event.target.checked)} />
                  <span>Active</span>
                </label>

                <div className="flex gap-2 border-t border-border pt-4">
                  <button type="button" disabled={saving || !form.name.trim() || !form.email.trim()} onClick={save} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
                    <Save className="h-3.5 w-3.5" />
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" disabled={saving} onClick={resetForm} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}{required ? <span className="text-destructive"> *</span> : null}</span>
      {children}
    </label>
  );
}
