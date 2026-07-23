import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Edit2, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import {
  archiveJobState,
  canManageJobStates,
  createJobState,
  createTransition,
  deleteTransition,
  fetchJobStates,
  reorderJobStates,
  slugFromLabel,
  updateJobState,
  type JobState,
  type JobStatesResponse,
} from "@/lib/job-states";
import { useSession } from "@/lib/session";
import { InlineSelect } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";

const TRIGGERS = [
  "manual",
  "inspection_requested",
  "pass",
  "fail",
  "progress_100_owner_yes",
  "walkthrough_approved",
  "walkthrough_punch_list",
  "walkthrough_reschedule",
  "paid",
];

interface StateForm {
  id?: string;
  label: string;
  slug: string;
  sort_order: number;
  color: string;
  is_terminal: boolean;
  is_inspection: boolean;
  is_walkthrough: boolean;
  is_billing: boolean;
  allow_check_ins: boolean;
  active: boolean;
}

interface TransitionForm {
  from_state_id: string;
  trigger: string;
  to_state_id: string;
}

function blankStateForm(sortOrder = 10): StateForm {
  return {
    label: "",
    slug: "",
    sort_order: sortOrder,
    color: "#64748b",
    is_terminal: false,
    is_inspection: false,
    is_walkthrough: false,
    is_billing: false,
    allow_check_ins: true,
    active: true,
  };
}

function stateToForm(state: JobState): StateForm {
  return {
    id: state.id,
    label: state.label,
    slug: state.slug,
    sort_order: state.sort_order,
    color: state.color,
    is_terminal: state.is_terminal,
    is_inspection: state.is_inspection,
    is_walkthrough: state.is_walkthrough,
    is_billing: state.is_billing,
    allow_check_ins: state.allow_check_ins,
    active: state.active,
  };
}

function nextSortOrder(states: JobState[]) {
  return (Math.max(0, ...states.map((state) => state.sort_order)) + 10);
}

export default function AdminJobStates() {
  const { user } = useSession();
  const canManage = canManageJobStates(user?.role);
  const confirm = useConfirm();
  const [data, setData] = useState<JobStatesResponse | null>(null);
  const [form, setForm] = useState<StateForm>(blankStateForm());
  const [transitionForm, setTransitionForm] = useState<TransitionForm>({ from_state_id: "", trigger: "manual", to_state_id: "" });
  const [archiveTarget, setArchiveTarget] = useState<JobState | null>(null);
  const [reassignStateId, setReassignStateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchJobStates(true)
      .then((next) => {
        if (!active) return;
        setData(next);
        setForm(blankStateForm(nextSortOrder(next.states)));
      })
      .catch((err) => { if (active) setError(err?.message ?? "Could not load job states"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const states = useMemo(() => [...(data?.states ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)), [data?.states]);
  const activeStates = states.filter((state) => state.active);
  const byId = useMemo(() => Object.fromEntries(states.map((state) => [state.id, state])), [states]);
  const activeJobCounts = data?.active_job_counts ?? {};
  const editing = Boolean(form.id);

  useEffect(() => {
    if (activeStates.length && (!transitionForm.from_state_id || !transitionForm.to_state_id)) {
      setTransitionForm((current) => ({
        ...current,
        from_state_id: current.from_state_id || activeStates[0].id,
        to_state_id: current.to_state_id || activeStates[1]?.id || activeStates[0].id,
      }));
    }
  }, [activeStates, transitionForm.from_state_id, transitionForm.to_state_id]);

  function resetForm(nextData = data) {
    setArchiveTarget(null);
    setReassignStateId("");
    setForm(blankStateForm(nextSortOrder(nextData?.states ?? [])));
  }

  function updateForm(patch: Partial<StateForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleLabelChange(label: string) {
    setForm((current) => ({
      ...current,
      label,
      slug: current.id ? current.slug : slugFromLabel(label),
    }));
  }

  async function saveState() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        label: form.label.trim(),
        slug: form.slug.trim(),
        sort_order: Number(form.sort_order) || 0,
      };
      const next = editing ? await updateJobState(payload) : await createJobState(payload);
      setData(next);
      resetForm(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save state");
    } finally {
      setSaving(false);
    }
  }

  async function moveState(state: JobState, direction: -1 | 1) {
    if (!canManage || !state.active) return;
    const ordered = states.filter((item) => item.active);
    const index = ordered.findIndex((item) => item.id === state.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const nextOrder = [...ordered];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    setSaving(true);
    setError(null);
    try {
      const next = await reorderJobStates(nextOrder.map((item, itemIndex) => ({ id: item.id, sort_order: (itemIndex + 1) * 10 })));
      setData(next);
      resetForm(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder states");
    } finally {
      setSaving(false);
    }
  }

  async function archiveState(state: JobState, reassignTo?: string | null) {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await archiveJobState(state.id, reassignTo);
      setData(next);
      resetForm(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive state");
    } finally {
      setSaving(false);
    }
  }

  async function restoreState(state: JobState) {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateJobState({ ...state, active: true });
      setData(next);
      resetForm(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore state");
    } finally {
      setSaving(false);
    }
  }

  async function saveTransition() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await createTransition(transitionForm);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save transition");
    } finally {
      setSaving(false);
    }
  }

  async function removeTransition(id: string) {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await deleteTransition(id);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove transition");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Job States</h1>
          <p className="text-xs text-muted-foreground">Company workflow stages and transition rules.</p>
        </div>
        <div className="flex-1" />
        {canManage && (
          <button
            type="button"
            onClick={() => resetForm()}
            className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New State
          </button>
        )}
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading job states...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
          <main className="overflow-auto">
            <section className="border-b border-border">
              <table className="ops-grid w-full table-fixed border-collapse text-xs">
                <thead className="sticky top-0 bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-16 border-b border-border px-3 py-2 text-left font-medium">Order</th>
                    <th className="w-[32%] border-b border-border px-3 py-2 text-left font-medium">State</th>
                    <th className="border-b border-border px-3 py-2 text-left font-medium">Workflow flags</th>
                    <th className="w-24 border-b border-border px-3 py-2 text-left font-medium">Check-ins</th>
                    <th className="w-24 border-b border-border px-3 py-2 text-left font-medium">Active jobs</th>
                    <th className="w-40 border-b border-border px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((state) => {
                    const activeJobs = activeJobCounts[state.id] ?? 0;
                    return (
                      <tr
                        key={state.id}
                        onClick={() => { if (canManage && !saving) { setArchiveTarget(null); setForm(stateToForm(state)); } }}
                        className={`ops-row ${canManage ? "cursor-pointer" : ""} ${state.active ? "" : "opacity-55"} ${form.id === state.id ? "bg-muted/60" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono-num">{state.sort_order}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: state.color }} />
                            <span className="pill" style={{ backgroundColor: `${state.color}22`, color: state.color }}>{state.label}</span>
                            {!state.active && <span className="pill bg-muted text-muted-foreground">archived</span>}
                          </div>
                          <div className="mt-1 font-mono text-2xs text-muted-foreground">{state.slug}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {[state.is_inspection && "inspection", state.is_walkthrough && "walkthrough", state.is_billing && "billing", state.is_terminal && "terminal"].filter(Boolean).join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2">{state.allow_check_ins ? "Yes" : "No"}</td>
                        <td className="px-3 py-2 font-mono-num">{activeJobs}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button type="button" title="Move up" disabled={!canManage || !state.active || saving} onClick={(event) => { event.stopPropagation(); moveState(state, -1); }} className="icon-btn">
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" title="Move down" disabled={!canManage || !state.active || saving} onClick={(event) => { event.stopPropagation(); moveState(state, 1); }} className="icon-btn">
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" title="Edit" disabled={!canManage || saving} onClick={(event) => { event.stopPropagation(); setArchiveTarget(null); setForm(stateToForm(state)); }} className="icon-btn">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            {state.active ? (
                              <button
                                type="button"
                                title="Archive"
                                disabled={!canManage || saving}
                                onClick={async (event) => {
                                  event.stopPropagation();
                                  if (activeJobs > 0) {
                                    setForm(stateToForm(state));
                                    setArchiveTarget(state);
                                    setReassignStateId(activeStates.find((item) => item.id !== state.id)?.id ?? "");
                                  } else if (await confirm({ title: `Archive ${state.label}?`, confirmLabel: "Archive", destructive: true })) {
                                    void archiveState(state);
                                  }
                                }}
                                className="icon-btn"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button type="button" title="Restore" disabled={!canManage || saving} onClick={(event) => { event.stopPropagation(); restoreState(state); }} className="icon-btn">
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
            </section>

            <section>
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transitions</h2>
              </div>
              <table className="ops-grid w-full table-fixed border-collapse text-xs">
                <thead className="bg-muted text-2xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="border-b border-border px-3 py-2 text-left font-medium">From</th>
                    <th className="border-b border-border px-3 py-2 text-left font-medium">Trigger</th>
                    <th className="border-b border-border px-3 py-2 text-left font-medium">To</th>
                    <th className="w-16 border-b border-border px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.transitions.map((transition) => (
                    <tr key={transition.id} className="ops-row">
                      <td className="px-3 py-2">{byId[transition.from_state_id]?.label ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{transition.trigger}</td>
                      <td className="px-3 py-2">{byId[transition.to_state_id]?.label ?? "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" title="Remove transition" disabled={!canManage || saving} onClick={() => removeTransition(transition.id)} className="icon-btn">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {canManage && activeStates.length > 1 && (
                    <tr className="bg-card">
                      <td className="border-t border-border px-3 py-2">
                        <InlineSelect
                          value={transitionForm.from_state_id}
                          onChange={(value) => setTransitionForm((current) => ({ ...current, from_state_id: value }))}
                          className="h-8 w-full"
                          options={activeStates.map((state) => ({ value: state.id, label: state.label }))}
                        />
                      </td>
                      <td className="border-t border-border px-3 py-2">
                        <InlineSelect
                          value={transitionForm.trigger}
                          onChange={(value) => setTransitionForm((current) => ({ ...current, trigger: value }))}
                          className="h-8 w-full font-mono"
                          options={TRIGGERS.map((trigger) => ({ value: trigger, label: trigger }))}
                        />
                      </td>
                      <td className="border-t border-border px-3 py-2">
                        <InlineSelect
                          value={transitionForm.to_state_id}
                          onChange={(value) => setTransitionForm((current) => ({ ...current, to_state_id: value }))}
                          className="h-8 w-full"
                          options={activeStates.map((state) => ({ value: state.id, label: state.label }))}
                        />
                      </td>
                      <td className="border-t border-border px-3 py-2 text-right">
                        <button type="button" title="Add transition" disabled={saving || transitionForm.from_state_id === transitionForm.to_state_id} onClick={saveTransition} className="icon-btn">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </main>

          <aside className="overflow-auto border-l border-border bg-card">
            {archiveTarget ? (
              <div className="space-y-4 p-4">
                <div>
                  <h2 className="text-sm font-semibold">Archive State</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{activeJobCounts[archiveTarget.id] ?? 0} active jobs need a new state.</p>
                </div>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Move jobs to</span>
                  <InlineSelect
                    value={reassignStateId}
                    onChange={setReassignStateId}
                    className="w-full"
                    options={activeStates.filter((state) => state.id !== archiveTarget.id).map((state) => ({ value: state.id, label: state.label }))}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={saving || !reassignStateId} onClick={() => archiveState(archiveTarget, reassignStateId)} className="inline-flex h-8 items-center gap-1 rounded-sm bg-destructive px-3 text-xs font-medium text-destructive-foreground hover:opacity-90">
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                  <button type="button" disabled={saving} onClick={() => resetForm()} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{editing ? "Edit State" : "New State"}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {editing ? <>Editing <span className="font-medium text-foreground">{form.label || "state"}</span> — changes update this state in place.</> : "Add a stage to this company's default state set."}
                    </p>
                  </div>
                  {editing && (
                    <button type="button" disabled={saving} onClick={() => resetForm()} className="shrink-0 rounded-sm border border-border px-2 py-1 text-2xs hover:bg-muted">+ New</button>
                  )}
                </div>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Label</span>
                  <input value={form.label} onChange={(event) => handleLabelChange(event.target.value)} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">API value</span>
                  <input value={form.slug} onChange={(event) => updateForm({ slug: slugFromLabel(event.target.value) })} disabled={!canManage || saving || editing} className="h-9 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs disabled:opacity-65" />
                </label>

                <div className="grid grid-cols-[1fr_92px] gap-2">
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">Color</span>
                    <input value={form.color} onChange={(event) => updateForm({ color: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs" />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">Swatch</span>
                    <input type="color" value={form.color} onChange={(event) => updateForm({ color: event.target.value })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background p-1" />
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Sort order</span>
                  <input type="number" value={form.sort_order} onChange={(event) => updateForm({ sort_order: Number(event.target.value) })} disabled={!canManage || saving} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs" />
                </label>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Toggle label="Inspection" checked={form.is_inspection} disabled={!canManage || saving} onChange={(checked) => updateForm({ is_inspection: checked })} />
                  <Toggle label="Walkthrough" checked={form.is_walkthrough} disabled={!canManage || saving} onChange={(checked) => updateForm({ is_walkthrough: checked })} />
                  <Toggle label="Billing" checked={form.is_billing} disabled={!canManage || saving} onChange={(checked) => updateForm({ is_billing: checked })} />
                  <Toggle label="Terminal" checked={form.is_terminal} disabled={!canManage || saving} onChange={(checked) => updateForm({ is_terminal: checked })} />
                  <Toggle label="Check-ins" checked={form.allow_check_ins} disabled={!canManage || saving} onChange={(checked) => updateForm({ allow_check_ins: checked })} />
                  <Toggle label="Active" checked={form.active} disabled={!canManage || saving} onChange={(checked) => updateForm({ active: checked })} />
                </div>

                <div className="flex gap-2 border-t border-border pt-4">
                  <button type="button" disabled={!canManage || saving || !form.label.trim() || !form.slug.trim()} onClick={saveState} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
                    <Save className="h-3.5 w-3.5" />
                    Save
                  </button>
                  <button type="button" disabled={saving} onClick={() => resetForm()} className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>

                {!canManage && (
                  <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                    View-only role.
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-background px-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
