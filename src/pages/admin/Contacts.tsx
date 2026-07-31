import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Ban, ChevronDown, ChevronRight, GripVertical, Mail, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import {
  canManageContacts, createContact, deleteContact, fetchContacts, setContactActive, updateContact, fetchContactMessages,
  type ContactRow, type ContactsListResponse, type ContactMessage, type ContactInput,
} from "@/lib/contacts";
import { syncWithUptiq } from "@/lib/settings";
import { stripHtml } from "@/lib/format";
import { linkify } from "@/lib/linkify";
import { useSession } from "@/lib/session";
import { useConfirm } from "@/components/dialogs";
import { InlineSelect } from "@/components/InlineSelect";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = [
  { value: "customer", label: "Customer" }, { value: "crew", label: "Crew" },
  { value: "owner", label: "Owner" }, { value: "office", label: "Office" },
  { value: "supply_house", label: "Supply house" }, { value: "other", label: "Other" },
];

const ROLE_LABELS: Record<string, string> = {
  customer: "Customers", crew: "Crew", owner: "Owner", office: "Office", supply_house: "Supply houses", other: "Other",
};
// Default group order (the "tag" groups). Unknown roles sort to the end, then alphabetical.
// The user can drag the group heads to rearrange; the custom order persists per browser.
const ROLE_ORDER = ["owner", "office", "crew", "customer", "supply_house", "other"];
const GROUP_ORDER_KEY = "contacts.group_order";
const SORT_MODE_KEY = "contacts.sort_mode";

type SortMode = "name_asc" | "name_desc" | "recent";

function loadGroupOrder(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) ?? "null");
    if (Array.isArray(stored) && stored.every((entry) => typeof entry === "string")) return stored;
  } catch { /* fall through to the default */ }
  return ROLE_ORDER;
}

function loadSortMode(): SortMode {
  const stored = localStorage.getItem(SORT_MODE_KEY);
  return stored === "name_desc" || stored === "recent" ? stored : "name_asc";
}

function compareContacts(a: ContactRow, b: ContactRow, mode: SortMode) {
  // Deactivated contacts sink to the bottom of their group in every mode (matches the
  // server's active-first ordering the ungrouped list always had).
  if (a.active !== b.active) return a.active ? -1 : 1;
  const byName = (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  if (mode === "name_desc") return -byName;
  if (mode === "recent") {
    // Most recently messaged first; never-messaged sink to the bottom, then by name.
    if (a.last_message_at !== b.last_message_at) {
      if (!a.last_message_at) return 1;
      if (!b.last_message_at) return -1;
      return a.last_message_at < b.last_message_at ? 1 : -1;
    }
  }
  return byName;
}

function roleLabel(role: string | null | undefined) {
  const r = (role ?? "other").toString();
  return ROLE_LABELS[r] ?? r;
}
function msgTime(m: ContactMessage) {
  const t = m.sent_at ?? m.created_at;
  try { return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return t; }
}
function roleBreakdown(byRole: Record<string, number> | undefined) {
  if (!byRole) return "";
  return Object.entries(byRole).sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${n} ${role === "unrecognized" ? "unrecognized" : roleLabel(role).toLowerCase()}`).join(", ");
}

export default function AdminContacts() {
  const { user } = useSession();
  // Managing contacts (crew pull, delete, deactivate) writes app records → owner_admin/support_admin.
  const canManage = canManageContacts(user?.role);
  const confirm = useConfirm();

  const [data, setData] = useState<ContactsListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [groupOrder, setGroupOrder] = useState<string[]>(loadGroupOrder);
  const dragRole = useRef<string | null>(null);
  // The group currently dragged over — drives the drop-target highlight.
  const [dragOverRole, setDragOverRole] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [messages, setMessages] = useState<ContactMessage[] | null>(null);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  // Per-contact message history already fetched this session — switching back to a contact
  // shows their thread instantly (and refreshes in the background) instead of flashing the
  // previous contact's messages while the new ones load.
  const msgCache = useRef(new Map<string, ContactMessage[]>());

  // Swap the displayed thread DURING render when the selection changes (adjust-state-in-render
  // pattern): a frame pairing contact B's header with contact A's messages can never commit —
  // an effect-based reset runs after paint and could flash the old thread for a frame.
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(null);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    const cached = selectedId ? msgCache.current.get(selectedId) ?? null : null;
    setMessages(cached);
    setMsgError(null);
    setMsgLoading(Boolean(selectedId) && !cached);
  }

  // Native add/edit form (Uptiq-independent). null = closed; id=null = create.
  const [form, setForm] = useState<{ id: string | null; name: string; role: string; email: string; phone: string } | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchContacts()
      .then((next) => { setData(next); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load contacts"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const contacts = useMemo(() => data?.contacts ?? [], [data?.contacts]);
  const selected = useMemo(() => contacts.find((c) => c.id === selectedId) ?? null, [contacts, selectedId]);

  // Fetch the selected contact's system-sent message history (the render-phase block above
  // already swapped the display to the cached thread / loading state). The fresh result
  // replaces the cache; a failed background refresh keeps the cached thread and only
  // surfaces the error when there was nothing to show.
  useEffect(() => {
    if (!selectedId) return;
    const hadCache = msgCache.current.has(selectedId);
    let active = true;
    fetchContactMessages(selectedId)
      .then((res) => {
        msgCache.current.set(selectedId, res.messages);
        if (active) setMessages(res.messages);
      })
      .catch((err) => {
        if (active && !hadCache) setMsgError(err instanceof Error ? err.message : "Could not load messages");
      })
      .finally(() => { if (active) setMsgLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  // Group filtered contacts by role (the "tag"), in the user's (drag-arranged) group order,
  // each group sorted by the selected mode.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byRole = new Map<string, ContactRow[]>();
    for (const c of contacts) {
      if (needle && ![c.name, c.email, c.phone, c.role].join(" ").toLowerCase().includes(needle)) continue;
      const r = (c.role ?? "other").toString();
      if (!byRole.has(r)) byRole.set(r, []);
      byRole.get(r)!.push(c);
    }
    for (const list of byRole.values()) list.sort((a, b) => compareContacts(a, b, sortMode));
    return [...byRole.entries()].sort((a, b) => {
      const ia = groupOrder.indexOf(a[0]); const ib = groupOrder.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [contacts, query, sortMode, groupOrder]);

  const channelMessages = useMemo(
    () => (messages ?? []).filter((m) => m.channel === channel),
    [messages, channel],
  );

  function toggleGroup(role: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  function changeSortMode(mode: string) {
    const next: SortMode = mode === "name_desc" || mode === "recent" ? mode : "name_asc";
    setSortMode(next);
    localStorage.setItem(SORT_MODE_KEY, next);
  }

  // Drag a group head onto another to move it there (different people talk to different
  // sets of contacts, so the folder order is theirs to arrange). Persists per browser.
  function dropGroup(targetRole: string) {
    const sourceRole = dragRole.current;
    dragRole.current = null;
    setDragOverRole(null);
    if (!sourceRole || sourceRole === targetRole) return;
    // Reposition within the FULL known order (stored order, then defaults, then any extra
    // on-screen roles) — never the filtered on-screen list, or groups hidden by the search
    // (or currently empty) would be dropped from the persisted order and sink to the end.
    const full = [...new Set([...groupOrder, ...ROLE_ORDER, ...groups.map(([role]) => role)])];
    const from = full.indexOf(sourceRole);
    const to = full.indexOf(targetRole);
    if (from === -1 || to === -1) return;
    full.splice(to, 0, ...full.splice(from, 1));
    setGroupOrder(full);
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(full));
  }

  // The ONE sync command (contacts-sync mode:"sync"): tag pull, then link. Preview (dry run) first.
  async function handleSync() {
    if (!canManage) return;
    setPulling(true); setError(null); setNotice(null);
    try {
      const preview = await syncWithUptiq({ dryRun: true });
      const breakdown = roleBreakdown(preview.pull.by_role);
      const unlinked = (preview.link.parties ?? []).filter((p) => !p.has_existing_id).length;
      const ok = await confirm({
        title: "Sync contacts with Uptiq?",
        body: `Step 1 imports ${preview.pull.would_import ?? 0} of ${preview.pull.scanned ?? 0} Uptiq contacts by tag${breakdown ? ` (${breakdown})` : ""}; supply houses also land in the Supply Houses list. Step 2 links ${unlinked} app record${unlinked === 1 ? "" : "s"} still missing a Uptiq id.\n\nRead-only in Uptiq; additive — never removes anyone. Untagged/unrecognized contacts are skipped.`,
        confirmLabel: "Sync",
      });
      if (!ok) return;
      const res = await syncWithUptiq({ dryRun: false });
      const sh = (res.pull.supply_imported ?? 0) + (res.pull.supply_updated ?? 0) + (res.pull.supply_linked ?? 0);
      const linked = res.link.linked ?? 0;
      const notFound = res.link.not_found ?? 0;
      setNotice(
        `Imported ${res.pull.contacts_imported ?? 0}, updated ${res.pull.contacts_updated ?? 0} contacts` +
        `${sh ? `; ${sh} supply house${sh === 1 ? "" : "s"} linked` : ""}` +
        `${res.pull.skipped ? `; ${res.pull.skipped} skipped` : ""}` +
        `${linked ? `; linked ${linked} more by lookup` : ""}` +
        `${notFound ? `; ${notFound} not found in Uptiq` : ""}.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uptiq contact sync failed");
    } finally {
      setPulling(false);
    }
  }

  async function handleToggleActive(c: ContactRow) {
    if (!canManage) return;
    setBusyId(c.id); setError(null); setNotice(null);
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
      confirmLabel: "Delete", destructive: true,
    }))) return;
    setBusyId(c.id); setError(null); setNotice(null);
    try {
      await deleteContact(c.id);
      setNotice(`Deleted ${c.name ?? "contact"}.`);
      if (selectedId === c.id) setSelectedId(null);
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

  function openCreate() { setFormErr(null); setForm({ id: null, name: "", role: "customer", email: "", phone: "" }); }
  function openEdit(c: ContactRow) { setFormErr(null); setForm({ id: c.id, name: c.name ?? "", role: (c.role ?? "other").toString(), email: c.email ?? "", phone: c.phone ?? "" }); }
  async function saveContact() {
    if (!form || !form.name.trim()) { setFormErr("Name is required."); return; }
    setFormBusy(true); setFormErr(null);
    const input: ContactInput = { name: form.name.trim(), role: form.role, email: form.email.trim() || null, phone: form.phone.trim() || null };
    try {
      const res = form.id ? await updateContact(form.id, input) : await createContact(input);
      setForm(null);
      setNotice(form.id ? "Contact updated." : "Contact added.");
      load();
      if (res?.contact?.id) setSelectedId(res.contact.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Could not save contact";
      setFormErr(m === "invalid_email" ? "That email doesn't look valid." : m === "name_required" ? "Name is required." : m);
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Contacts</h1>
          <p className="text-xs text-muted-foreground">Grouped by tag. Select a contact to see the texts &amp; emails the system has sent them.</p>
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts..."
          className="h-8 w-56 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        {canManage && (
          <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add contact
          </button>
        )}
        {canManage && (
          <button type="button" onClick={handleSync} disabled={pulling || loading} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <RefreshCw className={cn("h-3.5 w-3.5", pulling && "animate-spin")} />
            {pulling ? "Syncing..." : "Sync with Uptiq"}
          </button>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}

      <div className="flex min-h-0 flex-1">
        {/* Left: contacts grouped by tag (collapsible, drag the heads to rearrange) */}
        <aside className="w-72 shrink-0 overflow-auto border-r border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
            <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            <InlineSelect
              value={sortMode}
              onChange={changeSortMode}
              className="h-7 flex-1"
              options={[
                { value: "name_asc", label: "Name A → Z" },
                { value: "name_desc", label: "Name Z → A" },
                { value: "recent", label: "Latest interaction" },
              ]}
            />
          </div>
          {loading && <div className="p-4 text-xs text-muted-foreground">Loading contacts...</div>}
          {!loading && groups.length === 0 && <div className="p-4 text-xs text-muted-foreground">No contacts{query ? " match" : " yet"}.</div>}
          {!loading && groups.map(([role, list]) => {
            const isCollapsed = collapsed.has(role);
            const isDropTarget = dragOverRole === role && dragRole.current !== null && dragRole.current !== role;
            return (
              // The WHOLE group is the drop target (not just the thin head), so a drag
              // released anywhere over a folder still lands; the target highlights.
              <div
                key={role}
                onDragOver={(event) => {
                  if (!dragRole.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverRole(role);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDragOverRole((current) => (current === role ? null : current));
                  }
                }}
                onDrop={(event) => { event.preventDefault(); dropGroup(role); }}
                className={cn(isDropTarget && "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent/60")}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    dragRole.current = role;
                    // Firefox won't start a drag without data attached.
                    event.dataTransfer.setData("text/plain", role);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { dragRole.current = null; setDragOverRole(null); }}
                  onClick={() => toggleGroup(role)}
                  className="flex w-full items-center gap-1 border-y border-border bg-muted/50 px-3 py-1.5 text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {roleLabel(role)} <span className="text-muted-foreground/60">({list.length})</span>
                  <GripVertical className="ml-auto h-3 w-3 cursor-grab text-muted-foreground/50" />
                </button>
                {!isCollapsed && list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "flex w-full flex-col items-start border-b border-border/40 px-3 py-2 text-left hover:bg-muted/50",
                      selectedId === c.id && "bg-sidebar-accent hover:bg-sidebar-accent",
                    )}
                  >
                    <span className={cn("text-xs font-medium", !c.active && "text-muted-foreground line-through")}>{c.name ?? "(unnamed)"}</span>
                    <span className="w-full truncate text-2xs text-muted-foreground">{c.email ?? c.phone ?? "no contact info"}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </aside>

        {/* Right: per-contact messaging panel */}
        <section className="flex min-h-0 flex-1 flex-col">
          {!selected && (
            <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
              Select a contact to view the texts &amp; emails the system has sent them.
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{selected.name ?? "(unnamed)"}</div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {roleLabel(selected.role)} · {selected.email ?? "no email"} · {selected.phone ?? "no phone"}
                  </div>
                </div>
                <div className="flex-1" />
                <div className="flex overflow-hidden rounded-sm border border-border text-xs">
                  <button type="button" onClick={() => setChannel("sms")} className={cn("inline-flex items-center gap-1 px-3 py-1", channel === "sms" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    <MessageSquare className="h-3.5 w-3.5" /> Text
                  </button>
                  <button type="button" onClick={() => setChannel("email")} className={cn("inline-flex items-center gap-1 px-3 py-1", channel === "email" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    <Mail className="h-3.5 w-3.5" /> Email
                  </button>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <button type="button" title="Edit" onClick={() => openEdit(selected)} className="icon-btn">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title={selected.active ? "Deactivate" : "Reactivate"} disabled={busyId === selected.id} onClick={() => handleToggleActive(selected)} className="icon-btn">
                      {selected.active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" title="Delete" disabled={busyId === selected.id} onClick={() => handleDelete(selected)} className="icon-btn">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
                {msgLoading && <div className="text-xs text-muted-foreground">Loading messages...</div>}
                {msgError && <div className="text-xs text-destructive">{msgError}</div>}
                {!msgLoading && !msgError && channelMessages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No {channel === "sms" ? "texts" : "emails"} sent to this contact yet.
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {channelMessages.map((m) => (
                    <div key={m.id} className="max-w-[85%] self-end rounded-lg rounded-br-sm border border-border bg-card px-3 py-2">
                      {channel === "email" && m.subject && <div className="mb-1 text-2xs font-semibold text-foreground">{m.subject}</div>}
                      {/* SMS bodies are plain text; email bodies are simple HTML → flatten first.
                          Either way, bare URLs render as clickable links. */}
                      <div className="whitespace-pre-wrap break-words text-xs text-foreground">
                        {linkify(channel === "email" ? stripHtml(m.body) : m.body)}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                        <span>{msgTime(m)}</span>
                        <span className={cn("pill", m.status === "sent" ? "bg-success/10 text-success" : m.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{m.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Composer — visual only for now (no send wired up yet). */}
              <div className="border-t border-border p-3">
                <div className="flex items-center gap-2 opacity-60">
                  <input
                    disabled
                    placeholder={channel === "sms" ? "Text this contact..." : "Email this contact..."}
                    className="h-9 flex-1 rounded-sm border border-input bg-background px-3 text-xs"
                  />
                  <button type="button" disabled className="inline-flex h-9 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground">
                    <Send className="h-3.5 w-3.5" /> Send
                  </button>
                </div>
                <p className="mt-1 text-2xs text-muted-foreground">Sending from here isn&rsquo;t wired up yet — this shows what the system has sent.</p>
              </div>
            </>
          )}
        </section>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!formBusy) setForm(null); }}>
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-4 text-foreground" onClick={(event) => event.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">{form.id ? "Edit contact" : "Add contact"}</h2>
            <div className="space-y-2">
              <label className="block">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">Name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={formBusy} className="mt-0.5 h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>
              <label className="block">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">Tag / role</span>
                <InlineSelect value={form.role} onChange={(v) => setForm({ ...form, role: v })} disabled={formBusy} className="mt-0.5 h-9 w-full" options={ROLE_OPTIONS} />
              </label>
              <label className="block">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">Email</span>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={formBusy} className="mt-0.5 h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>
              <label className="block">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">Phone</span>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={formBusy} type="tel" className="mt-0.5 h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>
            </div>
            {formErr && <div className="mt-2 text-xs text-destructive">{formErr}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={formBusy} onClick={() => setForm(null)} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-60">Cancel</button>
              <button type="button" disabled={formBusy || !form.name.trim()} onClick={saveContact} className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{formBusy ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
