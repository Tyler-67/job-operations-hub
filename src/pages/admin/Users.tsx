import { useEffect, useMemo, useState } from "react";
import { Edit2, RotateCcw, Save, Search, ShieldCheck, UserCheck, UserPlus, UserX, Users, X } from "lucide-react";
import {
  assignableRoles,
  canManageUsers,
  canViewUsers,
  createUser,
  fetchUsers,
  roleLabel,
  shortDateTime,
  updateUser,
  type AppRole,
  type AppUserRow,
  type SaveUserPayload,
  type UsersResponse,
} from "@/lib/users";
import { useSession } from "@/lib/session";

interface UserForm {
  id?: string;
  email: string;
  name: string;
  phone: string;
  role: AppRole;
  active: boolean;
}

function blankUserForm(role: AppRole = "viewer"): UserForm {
  return {
    email: "",
    name: "",
    phone: "",
    role,
    active: true,
  };
}

function userToForm(user: AppUserRow): UserForm {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
    phone: user.phone ?? "",
    role: user.role,
    active: user.active,
  };
}

function roleTone(role: string) {
  if (role === "owner_admin") return "bg-success/10 text-success";
  if (role === "office_manager") return "bg-info/10 text-info";
  if (role === "support_admin") return "bg-warning/20 text-warning";
  if (role === "crew") return "bg-muted text-foreground";
  return "bg-muted text-muted-foreground";
}

function Metric({ icon: Icon, label, value, tone = "default" }: {
  icon: typeof Users;
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

  const editing = Boolean(form.id);
  const editingSelf = form.id === user?.id;
  const supportLocked = form.role === "support_admin" && user?.role !== "support_admin";
  const saveDisabled = !canManage || saving || !form.email.trim() || supportLocked;

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
        role: form.role,
        active: form.active,
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

  async function setUserActive(row: AppUserRow, active: boolean) {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateUser({
        id: row.id,
        email: row.email,
        name: row.name,
        phone: row.phone,
        role: row.role,
        active,
      });
      setData(next);
      if (form.id === row.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user");
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
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-8 rounded-sm border border-input bg-background px-2 text-xs">
          <option value="all">All roles</option>
          {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          {user?.role !== "support_admin" && <option value="support_admin">support admin</option>}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-8 rounded-sm border border-input bg-background px-2 text-xs">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All status</option>
        </select>
        {canManage && (
          <button type="button" onClick={resetForm} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <UserPlus className="h-3.5 w-3.5" />
            New User
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-5">
        <Metric icon={Users} label="Total users" value={data?.metrics.total_user_count ?? 0} />
        <Metric icon={UserCheck} label="Active users" value={data?.metrics.active_user_count ?? 0} tone="success" />
        <Metric icon={UserX} label="Inactive users" value={data?.metrics.inactive_user_count ?? 0} tone={(data?.metrics.inactive_user_count ?? 0) ? "warning" : "default"} />
        <Metric icon={ShieldCheck} label="Owner admins" value={data?.metrics.owner_admin_count ?? 0} />
        <Metric icon={Users} label="Office managers" value={data?.metrics.office_manager_count ?? 0} />
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading users...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
          <main className="overflow-auto">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-[28%] border-b border-border px-3 py-2 text-left font-medium">User</th>
                  <th className="w-40 border-b border-border px-3 py-2 text-left font-medium">Role</th>
                  <th className="w-24 border-b border-border px-3 py-2 text-left font-medium">Status</th>
                  <th className="border-b border-border px-3 py-2 text-left font-medium">Phone</th>
                  <th className="w-40 border-b border-border px-3 py-2 text-left font-medium">Last seen</th>
                  <th className="w-40 border-b border-border px-3 py-2 text-left font-medium">Updated</th>
                  <th className="w-24 border-b border-border px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">No users match the current filters.</td>
                  </tr>
                )}
                {filtered.map((row) => {
                  const rowSelf = row.id === user?.id;
                  const rowSupportLocked = row.role === "support_admin" && user?.role !== "support_admin";
                  return (
                    <tr key={row.id} className={`ops-row ${row.active ? "" : "opacity-60"}`}>
                      <td className="px-3 py-2">
                        <div className="truncate font-medium">{row.name || row.email}</div>
                        <div className="mt-0.5 truncate text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`pill ${roleTone(row.role)}`}>{roleLabel(row.role)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`pill ${row.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {row.active ? "active" : "inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.phone ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDateTime(row.last_seen_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shortDateTime(row.updated_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" title="Edit user" disabled={!canManage || saving || rowSupportLocked} onClick={() => setForm(userToForm(row))} className="icon-btn">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {row.active ? (
                            <button type="button" title="Deactivate user" disabled={!canManage || saving || rowSelf || rowSupportLocked} onClick={() => setUserActive(row, false)} className="icon-btn">
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button type="button" title="Reactivate user" disabled={!canManage || saving || rowSupportLocked} onClick={() => setUserActive(row, true)} className="icon-btn">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
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
                <p className="mt-1 text-xs text-muted-foreground">{canManage ? "Set company access and status." : "View-only role."}</p>
              </div>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Email</span>
                <input type="email" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} disabled={!canManage || saving || editingSelf} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Phone</span>
                <input value={form.phone} onChange={(event) => updateForm({ phone: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              </label>

              <div className="grid grid-cols-[1fr_120px] gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Role</span>
                  <select value={form.role} onChange={(event) => updateForm({ role: event.target.value as AppRole })} disabled={!canManage || saving || editingSelf || supportLocked} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65">
                    {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    {supportLocked && <option value="support_admin">support admin</option>}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Status</span>
                  <select value={form.active ? "active" : "inactive"} onChange={(event) => updateForm({ active: event.target.value === "active" })} disabled={!canManage || saving || editingSelf || supportLocked} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

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
