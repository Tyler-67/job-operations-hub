import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchContacts, type ContactRow, type ContactsListResponse } from "@/lib/contacts";
import { pullCrew } from "@/lib/settings";
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
  // Crew pull writes app records, so it's owner_admin/support_admin (matches contacts-sync POST).
  const canPull = user?.role === "owner_admin" || user?.role === "support_admin";
  const confirm = useConfirm();

  const [data, setData] = useState<ContactsListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function handlePullCrew() {
    if (!canPull) return;
    if (!(await confirm({
      title: "Pull crew from Uptiq now?",
      body: "Imports every Uptiq contact tagged “crew” as a crew contact here (created or updated, matched by Uptiq id). Read-only in Uptiq.",
      confirmLabel: "Pull crew",
    }))) return;
    setPulling(true);
    setError(null);
    setNotice(null);
    try {
      const res = await pullCrew({ dryRun: false });
      setNotice(`Crew pull: imported ${res.imported ?? 0}, updated ${res.updated ?? 0}, skipped ${res.skipped ?? 0} (of ${res.found} tagged "${res.tag}").`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crew pull failed");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Contacts</h1>
          <p className="text-xs text-muted-foreground">People this company messages: customers, crew, owner, office, supply houses. Crew are pulled from the Uptiq &ldquo;crew&rdquo; tag.</p>
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
        {canPull && (
          <button type="button" onClick={handlePullCrew} disabled={pulling || loading} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${pulling ? "animate-spin" : ""}`} />
            {pulling ? "Pulling..." : "Pull crew from Uptiq"}
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
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No contacts{query || roleFilter !== "all" ? " match" : " yet"}.</td></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      )}
    </div>
  );
}
