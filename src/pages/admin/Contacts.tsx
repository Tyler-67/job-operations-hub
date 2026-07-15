import { useEffect, useMemo, useState } from "react";
import { Ban, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { canManageContacts, deleteContact, fetchContacts, setContactActive, type ContactRow, type ContactsListResponse } from "@/lib/contacts";
import { pullContacts } from "@/lib/settings";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";

const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  crew: "Crew",
  owner: "Owner",
  office: "Office",
  supply_house: "Supply house",
  other: "Other",
};

function roleLabel(role: string | null | undefined) {
  const r = (role ?? "other").toString();
  return ROLE_LABELS[r] ?? r;
}

export default function AdminContacts() {
  const { user } = useSession();
  // Managing contacts (crew pull, delete, deactivate) writes app records → owner_admin/support_admin.
  const canManage = canManageContacts(user?.role);
  const confirm = useConfirm();

  const [data, setData] = useState<ContactsListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchContacts()
      .then((next) => { setData(next); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load contacts"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const contacts = useMemo(() => data?.contacts ?? [], [data?.contacts]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (roleFilter !== "all" && (c.role ?? "other") !== roleFilter) return false;
      if (!needle) return true;
      return [c.name, c.email, c.phone, c.uptiq_contact_id, c.role].join(" ").toLowerCase().includes(needle);
    });
  }, [contacts, query, roleFilter]);

  const roles = useMemo(() => Object.keys(data?.role_counts ?? {}).sort(), [data?.role_counts]);

  // "5 crew, 12 customer, 3 supply house, 2 unrecognized" — the tag->role preview for the confirm.
  function roleBreakdown(byRole: Record<string, number> | undefined) {
    if (!byRole) return "";
    return Object.entries(byRole)
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${n} ${role === "unrecognized" ? "unrecognized" : roleLabel(role).toLowerCase()}`)
      .join(", ");
  }

  async function handlePull() {
    if (!canManage) return;
    setPulling(true);
    setError(null);
    setNotice(null);
    try {
      // Preview first (read-only) so the confirm shows the tag->role breakdown before writing.
      const preview = await pullContacts({ dryRun: true });
      const breakdown = roleBreakdown(preview.by_role);
      const ok = await confirm({
        title: "Pull contacts from Uptiq?",
        body: `Found ${preview.scanned ?? 0} Uptiq contacts — will import ${preview.would_import ?? 0} by tag${breakdown ? `:\n${breakdown}` : ""}.\n\nRead-only in Uptiq; untagged/unrecognized contacts are skipped. Supply houses are also linked into the Supply Houses list.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      const res = await pullContacts({ dryRun: false });
      const sh = (res.supply_imported ?? 0) + (res.supply_updated ?? 0) + (res.supply_linked ?? 0);
      setNotice(
        `Imported ${res.contacts_imported ?? 0}, updated ${res.contacts_updated ?? 0} contacts` +
        `${sh ? `; ${sh} supply house${sh === 1 ? "" : "s"} linked` : ""}` +
        `${res.skipped ? `; ${res.skipped} skipped` : ""}.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contact pull failed");
    } finally {
      setPulling(false);
    }
  }

  async function handleToggleActive(c: ContactRow) {
    if (!canManage) return;
    setBusyId(c.id);
    setError(null);
    setNotice(null);
    try {
      await setContactActive(c.id, !c.active);
      setNotice(`${c.active ? "Deactivated" : "Reactivated"} ${c.name ?? "contact"}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update contact");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: ContactRow) {
    if (!canManage) return;
    if (!(await confirm({
      title: `Delete ${c.name ?? "this contact"}?`,
      body: "Permanently removes this contact. If it has check-in, expense, or message history it can't be deleted — deactivate it instead.",
      confirmLabel: "Delete",
      destructive: true,
    }))) return;
    setBusyId(c.id);
    setError(null);
    setNotice(null);
    try {
      await deleteContact(c.id);
      setNotice(`Deleted ${c.name ?? "contact"}.`);
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === "has_history"
        ? `${c.name ?? "This contact"} has activity history (check-ins, expenses, or messages) and can't be deleted — use Deactivate instead.`
        : (message || "Could not delete contact"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Contacts</h1>
          <p className="text-xs text-muted-foreground">People this company messages: customers, crew, owner, office, supply houses. Pulled from Uptiq by tag; supply houses also link into the Supply Houses list.</p>
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, email, phone, id..."
          className="h-8 w-56 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <InlineSelect
          value={roleFilter}
          onChange={setRoleFilter}
          className="h-8 w-44"
          options={[{ value: "all", label: "All roles" }, ...roles.map((r) => ({ value: r, label: `${roleLabel(r)} (${data?.role_counts[r]})` }))]}
        />
        {canManage && (
          <button type="button" onClick={handlePull} disabled={pulling || loading} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${pulling ? "animate-spin" : ""}`} />
            {pulling ? "Pulling..." : "Pull from Uptiq"}
          </button>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading contacts...</div>}

      {!loading && (
        <main className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-xs">
            <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-[22%] border-b border-border px-3 py-2 text-left font-medium">Name</th>
                <th className="w-[12%] border-b border-border px-3 py-2 text-left font-medium">Role</th>
                <th className="w-[16%] border-b border-border px-3 py-2 text-left font-medium">Phone</th>
                <th className="border-b border-border px-3 py-2 text-left font-medium">Email</th>
                <th className="w-[22%] border-b border-border px-3 py-2 text-left font-medium">Uptiq contact ID</th>
                <th className="w-20 border-b border-border px-3 py-2 text-left font-medium">Status</th>
                {canManage && <th className="w-24 border-b border-border px-3 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canManage ? 7 : 6} className="p-8 text-center text-muted-foreground">No contacts{query || roleFilter !== "all" ? " match" : " yet"}.</td></tr>
              )}
              {filtered.map((c: ContactRow) => (
                <tr key={c.id} className="ops-row">
                  <td className="px-3 py-2 font-medium">{c.name ?? "(unnamed)"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{roleLabel(c.role)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.phone ?? "-"}</td>
                  <td className="px-3 py-2 text-muted-foreground"><div className="truncate">{c.email ?? "-"}</div></td>
                  <td className="px-3 py-2 font-mono text-2xs text-muted-foreground"><div className="truncate">{c.uptiq_contact_id ?? "-"}</div></td>
                  <td className="px-3 py-2">
                    <span className={`pill ${c.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {c.active ? "active" : "inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" title={c.active ? "Deactivate" : "Reactivate"} disabled={busyId === c.id} onClick={() => handleToggleActive(c)} className="icon-btn">
                          {c.active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" title="Delete" disabled={busyId === c.id} onClick={() => handleDelete(c)} className="icon-btn">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      )}
    </div>
  );
}
