import { Fragment, useEffect, useState } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { callEdge, listInstances, switchInstance, useSession, type AppInstance } from "@/lib/session";
import { roleLabel } from "@/lib/users";
import { InlineSelect } from "@/components/InlineSelect";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Gauge,
  BriefcaseBusiness,
  Contact,
  KeyRound,
  LayoutDashboard,
  ReceiptText,
  Search,
  Settings2,
  Users,
  Warehouse,
  Wifi,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DialogProvider } from "@/components/dialogs";

// Sidebar schema (2026-07-23, per Tyler): divider groups by TEMPO — daily work up top,
// money weekly, one-time setup last. Dividers only, no tabs. `adminOnly` gates per item so
// mixed groups (Reports for everyone, Expenses for managers) render correctly per role.
interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean }
const navGroups: { label: string | null; items: NavItem[] }[] = [
  {
    // Dashboard stands alone at the top — it's the index.
    label: null,
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Jobs",
    items: [
      { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
      { to: "/search", label: "Search", icon: Search },
      { to: "/admin/supply-houses", label: "Supply Houses", icon: Warehouse, adminOnly: true },
      { to: "/admin/users", label: "Users", icon: Users, adminOnly: true },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/admin/expenses", label: "Expenses & POs", icon: ReceiptText, adminOnly: true },
      { to: "/reports/completion", label: "Reports", icon: BarChart3 },
      { to: "/reports/weekly-preview", label: "Weekly Report", icon: CalendarDays },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/admin/settings", label: "Settings", icon: Settings2, adminOnly: true },
      { to: "/admin/contacts", label: "Contacts", icon: Contact, adminOnly: true },
      { to: "/admin/job-states", label: "Job States", icon: Wrench, adminOnly: true },
    ],
  },
];

export default function AppShell() {
  const { user, location, loading, error, needsLogin, signOut } = useSession();
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [instances, setInstances] = useState<AppInstance[] | null>(null);
  const [switching, setSwitching] = useState(false);

  // Instance switcher data: ANY account may belong to several instances (same email, a row
  // per instance; dev_super sees every instance). The endpoint returns only the caller's own
  // memberships, and the picker renders only when there's more than one — single-instance
  // users (almost everyone) keep the plain company-name label.
  useEffect(() => {
    if (!user) return;
    let active = true;
    listInstances().then((list) => { if (active) setInstances(list); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session...
      </div>
    );
  }

  if (needsLogin) return <Navigate to="/login" replace />;

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-sm text-destructive">
        Session failed: {error}
      </div>
    );
  }

  const isAdmin = user?.role === "dev_super" || user?.role === "owner_admin" || user?.role === "office_manager" || user?.role === "support_admin";

  function openPwModal() {
    setPw(""); setPw2(""); setPwMsg(null); setPwOpen(true);
  }

  async function changePassword() {
    if (pw.length < 8) { setPwMsg({ ok: false, text: "Password must be at least 8 characters." }); return; }
    if (pw !== pw2) { setPwMsg({ ok: false, text: "Passwords don't match." }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      await callEdge("change-password", { body: { password: pw } });
      setPwMsg({ ok: true, text: "Password updated." });
      setPw(""); setPw2("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Could not update password." });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <DialogProvider>
    <div className="grid h-screen grid-cols-[220px_1fr] grid-rows-[44px_1fr] bg-background">
      <header className="col-span-2 flex items-center justify-between border-b border-border bg-sidebar px-4 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">U</div>
          <div className="text-sm font-semibold tracking-tight">Uptiq</div>
          {instances && instances.length > 1 ? (
            <InlineSelect
              value={location?.id ?? ""}
              onChange={(next) => {
                if (!next || next === location?.id || switching) return;
                setSwitching(true);
                switchInstance(next).catch(() => setSwitching(false));
              }}
              options={instances.map((i) => ({ value: i.id, label: i.company_name ?? "(unnamed instance)" }))}
              disabled={switching}
              className="h-6 w-48 border-sidebar-accent bg-transparent text-xs text-sidebar-foreground/80"
            />
          ) : (
            <div className="text-xs text-sidebar-foreground/60">- {location?.company_name}</div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="hidden text-sidebar-foreground/60 md:inline">{user?.email}</span>
          <span className="pill bg-sidebar-accent text-sidebar-accent-foreground">{roleLabel(user?.role ?? "")}</span>
          <button onClick={openPwModal} className="inline-flex items-center gap-1 text-sidebar-foreground/70 hover:text-sidebar-foreground">
            <KeyRound className="h-3 w-3" /> Change password
          </button>
          <button onClick={signOut} className="text-sidebar-foreground/70 hover:text-sidebar-foreground">Sign out</button>
        </div>
      </header>
      <aside className="row-start-2 border-r border-border bg-sidebar text-sidebar-foreground">
        <nav className="flex h-full flex-col gap-px p-2">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => !item.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <Fragment key={group.label ?? "work"}>
                {group.label && (
                  <div className="mt-3 px-2 text-2xs uppercase tracking-wider text-sidebar-foreground/40">{group.label}</div>
                )}
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => cn(
                      "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </Fragment>
            );
          })}
          <div className="mt-auto">
            {user?.role === "dev_super" && (
              <NavLink
                to="/dev"
                className={({ isActive }) => cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-2xs",
                  isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Gauge className="h-3 w-3" />
                Developer
              </NavLink>
            )}
            <NavLink
              to="/docs"
              className={({ isActive }) => cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-2xs",
                isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <BookOpen className="h-3 w-3" />
              App guide
            </NavLink>
            <div className="flex items-center gap-1 p-2 text-2xs text-sidebar-foreground/40">
              <Wifi className="h-3 w-3" />
              v2 operations app
            </div>
          </div>
        </nav>
      </aside>
      <main className="row-start-2 col-start-2 overflow-auto">
        <Outlet />
      </main>

      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!pwBusy) setPwOpen(false); }}>
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-4 text-foreground" onClick={(event) => event.stopPropagation()}>
            <h2 className="mb-1 text-sm font-semibold">Change your password</h2>
            <p className="mb-3 text-xs text-muted-foreground">Signed in as {user?.email}. Minimum 8 characters.</p>
            <div className="space-y-2">
              <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(event) => setPw(event.target.value)} disabled={pwBusy} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
              <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={pw2} onChange={(event) => setPw2(event.target.value)} disabled={pwBusy} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
            </div>
            {pwMsg && <div className={cn("mt-2 text-xs", pwMsg.ok ? "text-success" : "text-destructive")}>{pwMsg.text}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={pwBusy} onClick={() => setPwOpen(false)} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-60">Close</button>
              <button type="button" disabled={pwBusy || !pw || !pw2} onClick={changePassword} className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{pwBusy ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DialogProvider>
  );
}
