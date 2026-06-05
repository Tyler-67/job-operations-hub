import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface JobState {
  id: string; slug: string; label: string; sort_order: number; color: string;
  is_terminal: boolean; is_inspection: boolean; is_walkthrough: boolean; is_billing: boolean; allow_check_ins: boolean; active: boolean;
}
interface Transition { id: string; from_state_id: string; to_state_id: string; trigger: string }

export default function AdminJobStates() {
  const [states, setStates] = useState<JobState[]>([]);
  const [trans, setTrans] = useState<Transition[]>([]);
  useEffect(() => { (async () => {
    const [{ data: s }, { data: t }] = await Promise.all([
      supabase.from("job_states").select("*").order("sort_order"),
      supabase.from("job_state_transitions").select("*"),
    ]);
    setStates((s as JobState[]) ?? []); setTrans((t as Transition[]) ?? []);
  })(); }, []);
  const byId = Object.fromEntries(states.map((s) => [s.id, s]));
  return (
    <div className="p-4 space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Job States</h2>
        <table className="w-full text-xs">
          <thead className="bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
            <tr>{["#", "Label", "Slug", "Flags", "Check-ins", "Active"].map((h) =>
              <th key={h} className="border-b border-border px-3 py-2 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s.id} className="ops-row">
                <td className="px-3 py-1.5 font-mono-num">{s.sort_order}</td>
                <td className="px-3 py-1.5"><span className="pill" style={{ backgroundColor: `${s.color}22`, color: s.color }}>{s.label}</span></td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{s.slug}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {[s.is_inspection && "inspection", s.is_walkthrough && "walkthrough", s.is_billing && "billing", s.is_terminal && "terminal"].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-1.5">{s.allow_check_ins ? "✓" : "—"}</td>
                <td className="px-3 py-1.5">{s.active ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-2xs text-muted-foreground">Phase 2: add/rename/reorder/delete with audit.</p>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Transitions</h2>
        <table className="w-full text-xs">
          <thead className="bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
            <tr>{["From", "Trigger", "To"].map((h) =>
              <th key={h} className="border-b border-border px-3 py-2 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {trans.map((t) => (
              <tr key={t.id} className="ops-row">
                <td className="px-3 py-1.5">{byId[t.from_state_id]?.label}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{t.trigger}</td>
                <td className="px-3 py-1.5">{byId[t.to_state_id]?.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
