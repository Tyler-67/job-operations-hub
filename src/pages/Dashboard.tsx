import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";

interface JobRow {
  id: string; address: string; state_progress_pct: number; job_completion_pct: number;
  total_hours: number; total_expenses: number; original_estimate: number | null;
  inspection_date: string | null; latest_po: string | null; updated_at: string;
  current_state_id: string | null; scope_of_work: string | null; notes: string | null;
}
interface StateRow { id: string; slug: string; label: string; color: string; is_terminal: boolean }

export default function Dashboard() {
  const { location } = useSession();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [states, setStates] = useState<Record<string, StateRow>>({});
  const [includeTerminal, setIncludeTerminal] = useState(false);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!location) return;
    (async () => {
      const [{ data: js }, { data: ss }] = await Promise.all([
        supabase.from("jobs").select("*").eq("location_id", location.id).eq("active", true).order("updated_at", { ascending: false }),
        supabase.from("job_states").select("*"),
      ]);
      setJobs(js ?? []);
      setStates(Object.fromEntries((ss ?? []).map((s: any) => [s.id, s])));
    })();
  }, [location]);

  const filtered = useMemo(() => jobs.filter((j) => {
    const st = j.current_state_id ? states[j.current_state_id] : null;
    if (!includeTerminal && st?.is_terminal) return false;
    if (stateFilter !== "all" && j.current_state_id !== stateFilter) return false;
    if (search) {
      const hay = `${j.address} ${j.scope_of_work ?? ""} ${j.notes ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [jobs, states, includeTerminal, stateFilter, search]);

  const stateOptions = Object.values(states).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs">
        <div className="font-semibold text-foreground">Active Jobs</div>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{filtered.length} of {jobs.length}</span>
        <div className="flex-1" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by address, scope, notes…"
          className="h-7 w-64 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
          className="h-7 rounded-sm border border-input bg-background px-2 text-xs">
          <option value="all">All states</option>
          {stateOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={includeTerminal} onChange={(e) => setIncludeTerminal(e.target.checked)} />
          Include terminal
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Address", "State", "Progress", "Job %", "Hours", "Expenses", "Estimate", "Inspection", "Last PO", "Updated"].map((h) => (
                <th key={h} className="border-b border-border px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                No active jobs. Seed data: create a job in Admin → Job States or via Uptiq import (Phase 2).
              </td></tr>
            )}
            {filtered.map((j) => {
              const st = j.current_state_id ? states[j.current_state_id] : null;
              return (
                <tr key={j.id} className="ops-row">
                  <td className="px-3 py-1.5 font-medium text-foreground">{j.address}</td>
                  <td className="px-3 py-1.5">
                    {st && <span className="pill" style={{ backgroundColor: `${st.color}22`, color: st.color }}>{st.label}</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono-num">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-sm bg-secondary">
                        <div className="h-full rounded-sm bg-accent" style={{ width: `${j.state_progress_pct}%` }} />
                      </div>
                      <span className="text-muted-foreground">{j.state_progress_pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 font-mono-num">{j.job_completion_pct}%</td>
                  <td className="px-3 py-1.5 font-mono-num">{Number(j.total_hours).toFixed(1)}</td>
                  <td className="px-3 py-1.5 font-mono-num">${Number(j.total_expenses).toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono-num text-muted-foreground">
                    {j.original_estimate ? `$${Number(j.original_estimate).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {j.inspection_date ? new Date(j.inspection_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{j.latest_po ? j.latest_po.slice(0, 8) : "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{new Date(j.updated_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
