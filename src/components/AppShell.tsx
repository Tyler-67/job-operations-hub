import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useSession } from "@/lib/session";
import {
  BarChart3,
  BriefcaseBusiness,
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

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { to: "/search", label: "Search", icon: Search },
  { to: "/reports/completion", label: "Reports", icon: BarChart3 },
];

const adminNav = [
  { to: "/admin/settings", label: "Settings", icon: Settings2 },
  { to: "/admin/job-states", label: "Job States", icon: Wrench },
  { to: "/admin/supply-houses", label: "Supply Houses", icon: Warehouse },
  { to: "/admin/expenses", label: "Expenses", icon: ReceiptText },
  { to: "/admin/users", label: "Users", icon: Users },
];

export default function AppShell() {
  const { user, location, loading, error, needsLogin, signOut } = useSession();

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

  const isAdmin = user?.role === "owner_admin" || user?.role === "office_manager" || user?.role === "support_admin";

  return (
    <div className="grid h-screen grid-cols-[220px_1fr] grid-rows-[44px_1fr] bg-background">
      <header className="col-span-2 flex items-center justify-between border-b border-border bg-sidebar px-4 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">U</div>
          <div className="text-sm font-semibold tracking-tight">Uptiq</div>
          <div className="text-xs text-sidebar-foreground/60">- {location?.company_name}</div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="hidden text-sidebar-foreground/60 md:inline">{user?.email}</span>
          <span className="pill bg-sidebar-accent text-sidebar-accent-foreground">{user?.role}</span>
          <button onClick={signOut} className="text-sidebar-foreground/70 hover:text-sidebar-foreground">Sign out</button>
        </div>
      </header>
      <aside className="row-start-2 border-r border-border bg-sidebar text-sidebar-foreground">
        <nav className="flex h-full flex-col gap-px p-2">
          {nav.map(({ to, label, icon: Icon }) => (
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
          {isAdmin && (
            <>
              <div className="mt-3 px-2 text-2xs uppercase tracking-wider text-sidebar-foreground/40">Admin</div>
              {adminNav.map(({ to, label, icon: Icon }) => (
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
            </>
          )}
          <div className="mt-auto flex items-center gap-1 p-2 text-2xs text-sidebar-foreground/40">
            <Wifi className="h-3 w-3" />
            v2 operations app
          </div>
        </nav>
      </aside>
      <main className="row-start-2 col-start-2 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
