import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Save, Search, UserPlus, X } from "lucide-react";
import {
  APP_ROLES,
  DEBUG_TOOL_OPTIONS,
  addUserEmail,
  assignableRoles,
  canManageUsers,
  canViewUsers,
  createUser,
  fetchUsers,
  generatePassword,
  removeUserEmail,
  roleLabel,
  setUserPassword,
  shortDateTime,
  updateUser,
  type AppRole,
  type AppUserWithEmails,
  type SaveUserPayload,
  type UsersResponse,
} from "@/lib/users";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { InlineMultiSelect } from "@/components/InlineMultiSelect";
import { SortableTh, shouldIgnoreRowClick, useTableSort, type SortAccessors } from "@/components/SortableTable";

const USER_SORT: SortAccessors<AppUserWithEmails> = {
  user: (row) => row.name || row.email,
  role: (row) => roleLabel(row.role),
  status: (row) => row.active,
  phone: (row) => row.phone,
  last_seen: (row) => row.last_seen_at,
  updated: (row) => row.updated_at,
};

interface UserForm {
  id?: string;
  email: string;
  name: string;
  phone: string;
  uptiq_contact_id: string;
  role: AppRole;
  active: boolean;
  password: string; // initial password for a NEW user (empty for edits — use the reset control)
  debug_tools: string[]; // debugger grants (per tool) — editable by dev_super only
}

function blankUserForm(role: AppRole = "viewer"): UserForm {
  return {
    email: "",
    name: "",
    phone: "",
    uptiq_contact_id: "",
    role,
    active: true,
    password: "",
    debug_tools: [],
  };
}

function userToForm(user: AppUserWithEmails): UserForm {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
    phone: user.phone ?? "",
    uptiq_contact_id: user.uptiq_contact_id ?? "",
    role: user.role,
    active: user.active,
    password: "",
    debug_tools: Array.isArray(user.debug_tools) ? user.debug_tools : [],
  };
}

function roleTone(role: string) {
  if (role === "dev_super") return "bg-primary/10 text-primary";
  if (role === "owner_admin") return "bg-success/10 text-success";
  if (role === "office_manager") return "bg-info/10 text-info";
  if (role === "support_admin") return "bg-warning/20 text-warning";
  if (role === "crew") return "bg-muted text-foreground";
  return "bg-muted text-muted-foreground";
}

export default function AdminUsers() {
  const { user } = useSession();
  const canView = canViewUsers(user?.role);
  const canManage = canManageUsers(user?.role);
  const roleOptions = assignableRoles(user?.role);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [form, setForm] = useState<UserForm>(blankUserForm(roleOptions[0] ?? "viewer"));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchUsers()
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load users"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const usersList = useMemo(() => data?.users ?? [], [data?.users]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return usersList.filter((row) => {
      if (status === "active" && !row.active) return false;
      if (status === "inactive" && row.active) return false;
      if (roleFilter !== "all" && row.role !== roleFilter) return false;
      if (needle) {
        const haystack = [row.email, row.name, row.phone, row.role].join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [query, roleFilter, status, usersList]);

  const { sorted, sort, toggleSort } = useTableSort(filtered, USER_SORT);

  const editing = Boolean(form.id);
  const editingRow = useMemo(() => usersList.find((row) => row.id === form.id), [usersList, form.id]);
  const aliasEmails = useMemo(() => editingRow?.emails ?? [], [editingRow]);
  const editingSelf = form.id === user?.id;
  // A form locked to a tier above the actor: owner can't touch support_admin/dev_super rows;
  // support_admin can't touch dev_super rows (mirrors the server's canManageRole).
  const tierLocked = (form.role === "support_admin" && !["support_admin", "dev_super"].includes(user?.role ?? ""))
    || (form.role === "dev_super" && user?.role !== "dev_super");
  // An app-wide super surfaced from another instance opens READ-ONLY — it's managed on its
  // home instance (this fn couldn't save it anyway). Every locked row still OPENS, so
  // clicking always shows the details; the lock only freezes the fields.
  const editingAppWide = Boolean(editingRow?.app_wide);
  const formLocked = tierLocked || editingAppWide;
  const saveDisabled = !canManage || saving || !form.email.trim() || formLocked;

  function resetForm() {
    setForm(blankUserForm(roleOptions.includes("viewer") ? "viewer" : roleOptions[0] ?? "viewer"));
  }

  function updateForm(patch: Partial<UserForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function saveUser() {
    if (saveDisabled) return;
    setSaving(true);
    setError(null);
    try {
      const payload: SaveUserPayload = {
        id: form.id,
        email: form.email.trim(),
        name: form.name.trim() || null,
        phone: form.phone.trim() || null,
        uptiq_contact_id: form.uptiq_contact_id.trim() || null,
        role: form.role,
        active: form.active,
        password: form.password.trim() || null, // applied on create; edits use the reset control
        ...(user?.role === "dev_super" ? { debug_tools: form.debug_tools } : {}),
      };
      const next = editing ? await updateUser(payload) : await createUser(payload);
      setData(next);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save user");
    } finally {
      setSaving(false);
    }
  }

  async function addEmail() {
    if (!canManage || saving || !form.id || !newEmail.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await addUserEmail(form.id, newEmail.trim());
      setData(next);
      setNewEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add email");
    } finally {
      setSaving(false);
    }
  }

  async function removeEmail(emailId: string) {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await removeUserEmail(emailId);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove email");
    } finally {
      setSaving(false);
    }
  }

  async function setPassword() {
    if (!canManage || saving || !form.id || !newPassword.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await setUserPassword(form.id, newPassword.trim());
      setData(next);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Users are available to admin roles.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Users & Roles</h1>
          <p className="text-xs text-muted-foreground">Company users and access levels.</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search users..."
            className="h-8 w-64 rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <InlineSelect
          value={roleFilter}
          onChange={setRoleFilter}
          className="h-8 w-40"
          options={[
            { value: "all", label: "All roles" },
            // dev_super accounts are invisible below dev_super (the server filters the rows;
            // don't advertise the tier in the filter either).
            ...APP_ROLES.filter((role) => role !== "dev_super" || user?.role === "dev_super")
              .map((role) => ({ value: role, label: roleLabel(role) })),
          ]}
        />
        <InlineSelect
          value={status}
          onChange={setStatus}
          className="h-8 w-32"
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "all", label: "All status" },
          ]}
        />
        {canManage && (
          <button type="button" onClick={resetForm} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <UserPlus className="h-3.5 w-3.5" />
            New User
          </button>
        )}
      </div>

      {/* The old metric-tile bar is gone: the counts live in the table heads. */}
      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading users...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
          <main className="overflow-auto">
            <table className="ops-grid w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  {/* The old metric bar's numbers live here: active/total on User, the
                      admin-tier counts on Role. Percentage widths only (px + % over-constrains
                      the fixed-layout table at narrow widths and crushes a column). */}
                  <SortableTh label={`User (${data?.metrics.active_user_count ?? 0}/${data?.metrics.total_user_count ?? 0})`} sortKey="user" sort={sort} onSort={toggleSort} className="w-[26%]" />
                  <SortableTh label={`Role (${data?.metrics.owner_admin_count ?? 0} owner, ${data?.metrics.office_manager_count ?? 0} office)`} sortKey="role" sort={sort} onSort={toggleSort} className="w-[24%]" />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="w-[9%]" />
                  <SortableTh label="Phone" sortKey="phone" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Last seen" sortKey="last_seen" sort={sort} onSort={toggleSort} className="w-[15%]" />
                  <SortableTh label="Updated" sortKey="updated" sort={sort} onSort={toggleSort} className="w-[15%]" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">No users match the current filters.</td>
                  </tr>
                )}
                {sorted.map((row) => {
                  const rowAppWide = Boolean(row.app_wide);
                  return (
                    // Every row opens the form on click — locked rows (app-wide supers,
                    // tiers above the actor) open READ-ONLY rather than not opening at all.
                    <tr
                      key={row.id}
                      tabIndex={0}
                      title={rowAppWide ? "App-wide superuser — manage on their home instance" : undefined}
                      className={`ops-row cursor-pointer ${row.active ? "" : "opacity-60"} ${form.id === row.id ? "bg-muted/50" : ""}`}
                      onClick={(event) => { if (!shouldIgnoreRowClick(event)) setForm(userToForm(row)); }}
                      onKeyDown={(event) => { if (event.key === "Enter") setForm(userToForm(row)); }}
                    >
                      <td className="px-3 py-2">
                        <div className="truncate font-medium">{row.name || row.email}</div>
                        <div className="mt-0.5 truncate text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`pill ${roleTone(row.role)}`}>{roleLabel(row.role)}</span>
                        {rowAppWide && (
                          <span className="pill ml-1 bg-muted text-muted-foreground" title="App-wide superuser — manage on their home instance">app-wide</span>
                        )}
                        {(row.debug_tools?.length ?? 0) > 0 && row.role !== "dev_super" && (
                          <span className="pill ml-1 bg-warning/20 text-warning" title={`Debug tools granted: ${(row.debug_tools ?? []).join(", ")}`}>
                            debugger ×{row.debug_tools?.length}
                          </span>
                        )}
                      </td>
                      {/* Status fills its whole cell, matching the state cells on the job tables. */}
                      <td className={`px-3 py-2 font-medium ${row.active ? "bg-success/10 text-success" : "bg-muted/60 text-muted-foreground"}`}>
                        {row.active ? "active" : "inactive"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.phone ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDateTime(row.last_seen_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDateTime(row.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </main>

          <aside className="overflow-auto border-l border-border bg-card">
            <div className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold">{editing ? "Edit User" : "New User"}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {editingAppWide
                    ? "App-wide superuser — read-only here; manage them on their home instance."
                    : canManage ? "Set company access and status." : "View-only role."}
                </p>
              </div>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Email</span>
                <input type="email" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} disabled={!canManage || saving || editingSelf || formLocked} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
                <span className="mt-1 block text-2xs text-muted-foreground">Signs in at /login with this email + the password below.</span>
              </label>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} disabled={!canManage || saving || formLocked} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Phone</span>
                <input value={form.phone} onChange={(event) => updateForm({ phone: event.target.value })} disabled={!canManage || saving || formLocked} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Uptiq contact ID <span className="text-muted-foreground/70">(optional — for messaging, e.g. crew)</span></span>
                <input value={form.uptiq_contact_id} onChange={(event) => updateForm({ uptiq_contact_id: event.target.value })} disabled={!canManage || saving || formLocked} placeholder="Uptiq contact id" className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>

              <div className="grid grid-cols-[1fr_120px] gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Role</span>
                  <InlineSelect
                    value={form.role}
                    onChange={(value) => updateForm({ role: value as AppRole })}
                    disabled={!canManage || saving || formLocked}
                    className="w-full"
                    options={[
                      ...roleOptions.map((role) => ({ value: role, label: roleLabel(role) })),
                      ...(tierLocked ? [{ value: form.role, label: roleLabel(form.role) }] : []),
                    ]}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Status</span>
                  <InlineSelect
                    value={form.active ? "active" : "inactive"}
                    onChange={(value) => updateForm({ active: value === "active" })}
                    disabled={!canManage || saving || editingSelf || formLocked}
                    className="w-full"
                    options={[
                      { value: "active", label: "Active" },
                      { value: "inactive", label: "Inactive" },
                    ]}
                  />
                </label>
              </div>

              {user?.role === "dev_super" && form.role !== "dev_super" && (
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Debug tools (dev-super grant)</span>
                  <InlineMultiSelect
                    values={form.debug_tools}
                    onChange={(values) => updateForm({ debug_tools: values })}
                    disabled={saving || formLocked}
                    className="w-full"
                    placeholder="None — normal role"
                    options={DEBUG_TOOL_OPTIONS.map((tool) => ({ value: tool.key, label: tool.label }))}
                  />
                </label>
              )}

              {canManage && !editingAppWide && (
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium"><KeyRound className="h-3.5 w-3.5" /> Login password</div>
                  {!editing ? (
                    <>
                      <p className="text-2xs text-muted-foreground">Optional initial password (or Generate). You can view and reset it after the user is created.</p>
                      <div className="flex gap-1">
                        <input value={form.password} onChange={(event) => updateForm({ password: event.target.value })} placeholder="leave blank to set later" disabled={saving} className="h-8 flex-1 rounded-sm border border-input bg-background px-2 text-xs" />
                        <button type="button" disabled={saving} onClick={() => updateForm({ password: generatePassword() })} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted">Generate</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-background px-2 py-1.5">
                        <span className="truncate font-mono text-xs">{editingRow?.login_password || "— not set —"}</span>
                        {editingRow?.login_password && (
                          <button type="button" title="Copy password" onClick={() => navigator.clipboard?.writeText(editingRow.login_password ?? "")} className="icon-btn"><Copy className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="new password" disabled={saving} className="h-8 flex-1 rounded-sm border border-input bg-background px-2 text-xs" />
                        <button type="button" disabled={saving} onClick={() => setNewPassword(generatePassword())} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted">Generate</button>
                        <button type="button" disabled={saving || !newPassword.trim()} onClick={setPassword} className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-65">Set</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {editing && canManage && !editingAppWide && (
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="text-xs font-medium">Additional login emails</div>
                  <p className="text-2xs text-muted-foreground">
                    Extra addresses this person can sign in with at /login. The primary email above is always usable.
                  </p>
                  <ul className="space-y-1">
                    {aliasEmails.map((mail) => (
                      <li key={mail.id} className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs">
                        <span className="truncate">{mail.email}</span>
                        <button type="button" title="Remove email" disabled={saving} onClick={() => removeEmail(mail.id)} className="icon-btn">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                    {aliasEmails.length === 0 && <li className="text-2xs text-muted-foreground">No additional emails.</li>}
                  </ul>
                  <div className="flex gap-1">
                    <input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="add-email@company.com" disabled={saving} className="h-8 flex-1 rounded-sm border border-input bg-background px-2 text-xs" />
                    <button type="button" disabled={saving || !newEmail.trim()} onClick={addEmail} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-65">
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 border-t border-border pt-4">
                <button type="button" disabled={saveDisabled} onClick={saveUser} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
                  <Save className="h-3.5 w-3.5" />
                  Save
                </button>
                <button type="button" disabled={saving} onClick={resetForm} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>

              {!canManage && (
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  Owner admins manage access levels.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
