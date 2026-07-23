// Developer console (dev_super only): the overhead operations that used to require direct
// SQL — instance lifecycle + ops metrics. The backend re-gates every call on the fresh role;
// the route guard here is just UX.
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/session";
import {
  canUseDevConsole, createInstance, deleteInstance, fetchDevOverview, updateInstance,
  type DevInstance, type DevOverview, type InstanceDraft,
} from "@/lib/dev-console";
import { InlineSelect } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";
import { Gauge, Plus, RefreshCw } from "lucide-react";

const CRON_LABELS: Record<string, { label: string; staleAfterMin: number }> = {
  drain: { label: "Delivery sweep", staleAfterMin: 30 },
  check_ins: { label: "Check-in send", staleAfterMin: 90 },
  inspection_reminders: { label: "Inspection reminders", staleAfterMin: 26 * 60 },
  weekly_report: { label: "Weekly report", staleAfterMin: 8 * 24 * 60 },
};

function relTime(iso: string | null): { text: string; ageMin: number | null } {
  if (!iso) return { text: "never", ageMin: null };
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return { text: "just now", ageMin: min };
  if (min < 60) return { text: `${min}m ago`, ageMin: min };
  if (min < 48 * 60) return { text: `${Math.floor(min / 60)}h ago`, ageMin: min };
  return { text: `${Math.floor(min / 1440)}d ago`, ageMin: min };
}

const EMPTY_DRAFT: InstanceDraft = {
  company_name: "", timezone: "America/Boise", uptiq_location_id: "",
  app_base_url: "", uptiq_sync_location_id: "",
};

export default function DevConsole() {
  const { user, location } = useSession();
  const confirm = useConfirm();
  const [data, setData] = useState<DevOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; instance: DevInstance } | null>(null);
  const [draft, setDraft] = useState<InstanceDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const allowed = canUseDevConsole(user?.role);

  useEffect(() => {
    if (!allowed) return;
    fetchDevOverview().then(setData).catch((e) => setError(e instanceof Error ? e.message : "load_failed"));
  }, [allowed]);

  const cloneOptions = useMemo(
    () => (data?.instances ?? []).map((i) => ({ value: i.id, label: i.company_name })),
    [data],
  );

  if (!allowed) return <Navigate to="/dashboard" replace />;

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT, clone_states_from: location?.id });
    setFormError(null);
    setDialog({ mode: "create" });
  }

  function openEdit(instance: DevInstance) {
    setDraft({
      company_name: instance.company_name,
      timezone: instance.timezone,
      uptiq_location_id: instance.uptiq_location_id,
      app_base_url: instance.app_base_url ?? "",
      uptiq_sync_location_id: instance.uptiq_sync_location_id ?? "",
    });
    setFormError(null);
    setDialog({ mode: "edit", instance });
  }

  async function submitDialog() {
    if (!dialog) return;
    setBusy(true); setFormError(null);
    try {
      const next = dialog.mode === "create"
        ? await createInstance(draft)
        : await updateInstance(dialog.instance.id, draft);
      setData(next);
      setDialog(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeInstance(instance: DevInstance) {
    const ok = await confirm({
      title: `Delete "${instance.company_name}"?`,
      body: "Only possible while the instance has no users, jobs, or contacts. This removes its settings and state machine permanently.",
      confirmLabel: "Delete instance",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      setData(await deleteInstance(instance.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof InstanceDraft, placeholder: string, hint?: string, disabled = false) => (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      <input
        value={(draft[key] as string) ?? ""}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        placeholder={placeholder}
        disabled={disabled || busy}
        maxLength={120}
        className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />
      {hint && <span className="mt-0.5 block text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4" /> Developer console</h1>
          <p className="text-xs text-muted-foreground">Instances, ops metrics, and the overhead functions with no other UI. Dev accounts only.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setError(null); fetchDevOverview().then(setData).catch((e) => setError(e instanceof Error ? e.message : "load_failed")); }}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-border bg-card px-2 text-xs hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            onClick={openCreate}
            className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New instance
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="mb-4 rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Cron heartbeats (last tick)</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CRON_LABELS).map(([key, meta]) => {
            const { text, ageMin } = relTime(data?.crons?.[key] ?? null);
            const stale = ageMin === null || ageMin > meta.staleAfterMin;
            return (
              <span key={key} className={`pill ${stale ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                {meta.label}: {text}
              </span>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Instance</th>
              <th className="px-3 py-2">Binding (GHL)</th>
              <th className="px-3 py-2">Sync target</th>
              <th className="px-3 py-2">App URL</th>
              <th className="px-3 py-2 text-right">Users</th>
              <th className="px-3 py-2 text-right">Jobs</th>
              <th className="px-3 py-2 text-right">Contacts</th>
              <th className="px-3 py-2 text-right">Queue / failed</th>
              <th className="px-3 py-2 text-right">Sent 24h</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.instances ?? []).map((inst) => {
              const empty = inst.metrics.users_active === 0 && inst.metrics.jobs_total === 0 && inst.metrics.contacts === 0;
              const current = inst.id === location?.id;
              return (
                <tr key={inst.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {inst.company_name}
                    {current && <span className="pill ml-2 bg-sidebar-accent text-sidebar-accent-foreground">current</span>}
                    <div className="text-2xs font-normal text-muted-foreground">{inst.timezone}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-2xs">{inst.uptiq_location_id}</td>
                  <td className="px-3 py-2 font-mono text-2xs">{inst.uptiq_sync_location_id ?? "—"}</td>
                  <td className="px-3 py-2 text-2xs">{inst.app_base_url ?? "(default)"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inst.metrics.users_active}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inst.metrics.jobs_active}/{inst.metrics.jobs_total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inst.metrics.contacts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {inst.metrics.notif_pending}
                    {inst.metrics.notif_failed > 0 && <span className="text-destructive"> / {inst.metrics.notif_failed}</span>}
                    {inst.metrics.notif_failed === 0 && " / 0"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{inst.metrics.sent_24h}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(inst)} className="mr-2 text-primary hover:underline">Edit</button>
                    <button
                      onClick={() => removeInstance(inst)}
                      disabled={!empty || current || busy}
                      title={current ? "Switch away from this instance first" : empty ? "Delete this empty instance" : "Only empty instances can be deleted"}
                      className="text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!data && !error && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-2xs text-muted-foreground">
        New instances start empty. Enter one via the header picker (dev accounts see every instance), then use
        Settings → Sync with Uptiq if it should pull real contacts. Delete only works on empty instances.
      </p>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) setDialog(null); }}>
          <div className="w-full max-w-md rounded-md border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">{dialog.mode === "create" ? "New instance" : `Edit "${dialog.instance.company_name}"`}</h2>
            <div className="space-y-3">
              {field("Company name", "company_name", "Daily Burn QA")}
              {field("Timezone", "timezone", "America/Boise", "IANA zone — drives every send time.")}
              {field("Uptiq binding id", "uptiq_location_id", "DEV-INTERNAL-2",
                "The UNIQUE GHL location id for iframe/webhook binding. Real id for a real company; any distinct slug for a sandbox.")}
              {field("App base URL", "app_base_url", "https://job-operations-hub-dev.vercel.app",
                "Where this instance's SMS links open. Blank = the production app.")}
              {field("Uptiq sync target", "uptiq_sync_location_id", "JrBcbFAsvPtRlR0UfaLj",
                "GHL location its contact pull + calendar sync address. Blank = the binding id.")}
              {dialog.mode === "create" && (
                <label className="block text-xs">
                  <span className="mb-1 block font-medium">Clone job states from</span>
                  <InlineSelect
                    value={draft.clone_states_from ?? ""}
                    onChange={(v) => setDraft((d) => ({ ...d, clone_states_from: v }))}
                    options={cloneOptions}
                    className="w-full"
                  />
                </label>
              )}
            </div>
            {formError && <div className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{formError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDialog(null)} disabled={busy} className="h-8 rounded-sm border border-border px-3 text-xs hover:bg-muted">Cancel</button>
              <button onClick={submitDialog} disabled={busy} className="h-8 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {busy ? "Saving…" : dialog.mode === "create" ? "Create instance" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
