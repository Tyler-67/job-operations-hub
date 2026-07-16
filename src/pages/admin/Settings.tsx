import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CalendarClock, Clock3, DollarSign, Palette, Save, Settings2, ShieldCheck, Truck, Users } from "lucide-react";
import {
  COMMON_TIMEZONES,
  WEEKDAYS,
  WEEKLY_REPORT_DAYS,
  canManageSettings,
  fetchSettings,
  moneyLabel,
  pullContacts,
  runCrons,
  saveSettings,
  syncContacts,
  timeForInput,
  type ContactsSyncResult,
  type ContactsPullResult,
  type CronKey,
  type RunCronsResult,
  type CompanySettings,
  type SettingsLocation,
  type SettingsResponse,
} from "@/lib/settings";
import { useSession } from "@/lib/session";
import { InlineSelect, type SelectOption } from "@/components/InlineSelect";
import { InlineMultiSelect } from "@/components/InlineMultiSelect";
import { useConfirm } from "@/components/dialogs";
import { fetchContacts, deleteContactConversation, sendTest, type ContactRow, type ConversationDeleteResult, type SendTestResult } from "@/lib/contacts";
import { fetchJobs, deleteJob, type JobSummary, type JobDeleteResult } from "@/lib/jobs";

// Result of clearing ONE selected contact's conversation — the backend targets one contact
// per call, so a multi-select run produces one of these per contact (with the error, if any).
type ConvRun = { contactId: string; name: string; result: ConversationDeleteResult | null; error: string | null };

// Result of clearing ONE selected job — the backend deletes one job per call, so a multi-select
// run produces one of these per job (with the error, if any).
type JobClearRun = { jobId: string; address: string; result: JobDeleteResult | null; error: string | null };

// The crons the debug kit can fire, in display order. Drain runs last (it's the sender).
const CRON_TARGETS: { key: CronKey; label: string; note: string }[] = [
  { key: "check-ins", label: "Send check-ins", note: "texts each active job's crew their check-in link" },
  { key: "inspection-reminders", label: "Inspection reminders", note: "owner date-ask + PASS/FAIL result links" },
  { key: "weekly-report", label: "Weekly report", note: "owner/office weekly digest email" },
  { key: "drain", label: "Drain queue", note: "sends anything still pending (auto-runs after the above)" },
];

// The run_crons result reports the underlying edge-function name; map it back to a friendly label.
const CRON_LABEL_BY_FN: Record<string, string> = {
  "cron-send-check-ins": "Send check-ins",
  "cron-inspection-reminders": "Inspection reminders",
  "cron-weekly-report": "Weekly report",
  "cron-drain-notifications": "Drain queue",
};

interface SettingsForm {
  company_name: string;
  timezone: string;
  uptiq_company_id: string;
  owner_contact_id: string;
  office_contact_id: string;
  check_in_send_time: string;
  check_in_weekdays: number[];
  inspection_reminder_time: string;
  weekly_report_day: number;
  weekly_report_time: string;
  review_request_delay_days: string;
  default_supply_house_contact_id: string;
  parts_cost_ceiling: string;
  supply_house_pickup_time: string;
  inspections_calendar_id: string;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_font: string;
  brand_logo_url: string;
  debug_mode: boolean;
}

function blankForm(): SettingsForm {
  return {
    company_name: "",
    timezone: "America/Boise",
    uptiq_company_id: "",
    owner_contact_id: "",
    office_contact_id: "",
    check_in_send_time: "15:00",
    check_in_weekdays: [1, 2, 3, 4, 5],
    inspection_reminder_time: "08:00",
    weekly_report_day: 5,
    weekly_report_time: "15:00",
    review_request_delay_days: "4",
    default_supply_house_contact_id: "",
    parts_cost_ceiling: "500",
    supply_house_pickup_time: "7AM",
    inspections_calendar_id: "",
    brand_primary_color: "#0f172a",
    brand_secondary_color: "#0ea5e9",
    brand_font: "Inter",
    brand_logo_url: "",
    debug_mode: false,
  };
}

function toForm(location: SettingsLocation, settings: CompanySettings): SettingsForm {
  return {
    company_name: location.company_name,
    timezone: location.timezone,
    uptiq_company_id: location.uptiq_company_id ?? "",
    owner_contact_id: settings.owner_contact_id ?? "",
    office_contact_id: settings.office_contact_id ?? "",
    check_in_send_time: timeForInput(settings.check_in_send_time),
    check_in_weekdays: settings.check_in_weekdays ?? [1, 2, 3, 4, 5],
    inspection_reminder_time: timeForInput(settings.inspection_reminder_time),
    weekly_report_day: settings.weekly_report_day,
    weekly_report_time: timeForInput(settings.weekly_report_time),
    review_request_delay_days: String(settings.review_request_delay_days ?? 4),
    default_supply_house_contact_id: settings.default_supply_house_contact_id ?? "",
    parts_cost_ceiling: String(settings.parts_cost_ceiling ?? 500),
    supply_house_pickup_time: settings.supply_house_pickup_time ?? "",
    inspections_calendar_id: settings.inspections_calendar_id ?? "",
    brand_primary_color: settings.brand_primary_color ?? "#0f172a",
    brand_secondary_color: settings.brand_secondary_color ?? "#0ea5e9",
    brand_font: settings.brand_font ?? "Inter",
    brand_logo_url: settings.brand_logo_url ?? "",
    debug_mode: settings.debug_mode ?? false,
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function Metric({ icon: Icon, label, value, tone = "default" }: {
  icon: typeof Settings2;
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

export default function AdminSettings() {
  const { user } = useSession();
  const canManage = canManageSettings(user?.role);
  // contacts-sync is gated to owner_admin/support_admin (narrower than settings' canManage).
  const canSyncContacts = user?.role === "owner_admin" || user?.role === "support_admin";
  const confirm = useConfirm();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>(blankForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cronSelected, setCronSelected] = useState<CronKey[]>(["check-ins", "inspection-reminders", "weekly-report"]);
  const [cronBusy, setCronBusy] = useState(false);
  const [cronResult, setCronResult] = useState<RunCronsResult | null>(null);
  const [contactsBusy, setContactsBusy] = useState<"preview" | "sync" | null>(null);
  const [contactsResult, setContactsResult] = useState<ContactsSyncResult | null>(null);
  const [pullBusy, setPullBusy] = useState<"preview" | "pull" | null>(null);
  const [pullResult, setPullResult] = useState<ContactsPullResult | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [testContactId, setTestContactId] = useState("");
  const [testChannel, setTestChannel] = useState<"sms" | "email">("sms");
  const [testMessage, setTestMessage] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<SendTestResult | null>(null);
  const [convContactIds, setConvContactIds] = useState<string[]>([]);
  const [convBusy, setConvBusy] = useState<"preview" | "delete" | null>(null);
  // One entry per selected contact (the backend clears one conversation at a time).
  const [convRuns, setConvRuns] = useState<ConvRun[] | null>(null);
  const [clearableJobs, setClearableJobs] = useState<JobSummary[]>([]);
  const [jobClearIds, setJobClearIds] = useState<string[]>([]);
  const [jobClearBusy, setJobClearBusy] = useState<"preview" | "delete" | null>(null);
  // One entry per selected job (the backend deletes one job at a time).
  const [jobClearRuns, setJobClearRuns] = useState<JobClearRun[] | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSettings()
      .then((next) => {
        if (!active) return;
        setData(next);
        setForm(toForm(next.location, next.settings));
        setError(null);
        setNotice(null);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load settings"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Uptiq-linked contacts: feed the Owner/Office role pickers (any settings editor) and the
  // Conversations debug tool. Only linked contacts are useful — both consumers key off the
  // Uptiq contact id.
  useEffect(() => {
    if (!canManage) return;
    fetchContacts()
      .then((res) => setContacts(res.contacts.filter((c) => c.uptiq_contact_id)))
      .catch(() => { /* leave the pickers empty on failure */ });
  }, [canManage]);

  // All jobs (incl. archived) for the Jobs debug tool's picker.
  useEffect(() => {
    if (!canSyncContacts) return;
    fetchJobs(true)
      .then((res) => setClearableJobs(res.jobs))
      .catch(() => { /* leave the picker empty on failure */ });
  }, [canSyncContacts]);

  const supplyHouses = useMemo(() => data?.supply_houses ?? [], [data?.supply_houses]);
  const weekdayLabel = WEEKDAYS.filter((day) => form.check_in_weekdays.includes(day.value)).map((day) => day.label).join(", ");
  const officeReady = Boolean(form.office_contact_id.trim());
  const ownerReady = Boolean(form.owner_contact_id.trim());
  const supplyReady = Boolean(form.default_supply_house_contact_id || supplyHouses.length);
  const companyIdReady = Boolean(form.uptiq_company_id.trim());

  function updateForm(patch: Partial<SettingsForm>) {
    setNotice(null);
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleWeekday(value: number) {
    setNotice(null);
    setForm((current) => {
      const exists = current.check_in_weekdays.includes(value);
      const next = exists
        ? current.check_in_weekdays.filter((day) => day !== value)
        : [...current.check_in_weekdays, value];
      return { ...current, check_in_weekdays: next.sort((a, b) => a - b) };
    });
  }

  async function save() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await saveSettings({
        location: {
          company_name: form.company_name.trim(),
          timezone: form.timezone.trim(),
          uptiq_company_id: nullable(form.uptiq_company_id),
        },
        settings: {
          owner_contact_id: nullable(form.owner_contact_id),
          office_contact_id: nullable(form.office_contact_id),
          check_in_send_time: form.check_in_send_time,
          check_in_weekdays: form.check_in_weekdays,
          inspection_reminder_time: form.inspection_reminder_time,
          weekly_report_day: form.weekly_report_day,
          weekly_report_time: form.weekly_report_time,
          review_request_delay_days: Number(form.review_request_delay_days),
          default_supply_house_contact_id: nullable(form.default_supply_house_contact_id),
          parts_cost_ceiling: Number(form.parts_cost_ceiling),
          supply_house_pickup_time: nullable(form.supply_house_pickup_time),
          inspections_calendar_id: nullable(form.inspections_calendar_id),
          brand_primary_color: form.brand_primary_color,
          brand_secondary_color: form.brand_secondary_color,
          brand_font: form.brand_font.trim(),
          brand_logo_url: nullable(form.brand_logo_url),
          debug_mode: form.debug_mode,
        },
      });
      setData(next);
      setForm(toForm(next.location, next.settings));
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  function toggleCron(key: CronKey) {
    setCronResult(null);
    setCronSelected((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  }

  async function handleRunCrons() {
    if (!cronSelected.length) return;
    const labels = CRON_TARGETS.filter((t) => cronSelected.includes(t.key)).map((t) => t.label).join(", ");
    if (!(await confirm({
      title: "Run selected now?",
      body: `Fires now, ignoring send times: ${labels}. Each send-cron is forced, then the queue is drained once so messages actually go out. Sends real SMS/email via Uptiq — for testing.`,
      confirmLabel: "Run selected",
    }))) return;
    setCronBusy(true);
    setCronResult(null);
    setError(null);
    try {
      setCronResult(await runCrons(cronSelected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cron run failed");
    } finally {
      setCronBusy(false);
    }
  }

  async function handleSyncContacts(dryRun: boolean) {
    if (!dryRun && !(await confirm({
      title: "Sync contacts from Uptiq now?",
      body: "Reads Uptiq contacts and stores the matching Uptiq contact id on each app party (customers, crew, supply houses, owner, office). Read-only — it does NOT create or change anything in Uptiq.",
      confirmLabel: "Sync",
    }))) return;
    setContactsBusy(dryRun ? "preview" : "sync");
    setContactsResult(null);
    setError(null);
    try {
      setContactsResult(await syncContacts({ dryRun }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contacts sync failed");
    } finally {
      setContactsBusy(null);
    }
  }

  async function handlePull(dryRun: boolean) {
    if (!dryRun && !(await confirm({
      title: "Pull contacts from Uptiq now?",
      body: "Imports every tagged Uptiq contact into this Contacts list by role (crew/customer/owner/office/supply house), and links supply houses into the Supply Houses list too. Read-only in Uptiq; additive (never removes anyone); untagged/unrecognized contacts are skipped.",
      confirmLabel: "Import",
    }))) return;
    setPullBusy(dryRun ? "preview" : "pull");
    setPullResult(null);
    setError(null);
    try {
      setPullResult(await pullContacts({ dryRun }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contact pull failed");
    } finally {
      setPullBusy(null);
    }
  }

  async function handleSendTest() {
    const contact = contacts.find((c) => c.id === testContactId);
    const uptiqId = contact?.uptiq_contact_id ?? "";
    if (!uptiqId) return;
    if (!(await confirm({
      title: `Send a test ${testChannel === "email" ? "email" : "SMS"}?`,
      body: `Sends one ${testChannel === "email" ? "email" : "text"} to ${contact?.name ?? "this contact"} via Uptiq right now (bypasses the queue). For testing message delivery.`,
      confirmLabel: "Send test",
    }))) return;
    setTestBusy(true);
    setTestResult(null);
    setError(null);
    setNotice(null);
    try {
      const res = await sendTest({
        uptiqContactId: uptiqId,
        channel: testChannel,
        message: testMessage.trim() || undefined,
        subject: testChannel === "email" ? (testMessage.trim() || undefined) : undefined,
      });
      setTestResult(res);
      setNotice(res.provider_ok ? `Test ${testChannel} sent to ${contact?.name ?? "contact"}.` : `Provider returned ${res.provider_status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test send failed");
    } finally {
      setTestBusy(false);
    }
  }

  // The company owner/office messaging contacts (Settings ids) receive the app's owner/office
  // texts and usually have no app-contact row — offer them in the picker explicitly. Contact
  // labels carry the Uptiq id tail so two app contacts sharing one Uptiq thread is visible.
  const convOptions = useMemo(() => {
    const idTail = (raw: string | null) => (raw ? ` · …${raw.slice(-4)}` : "");
    return [
      { value: "owner", label: `Company owner contact (gets owner texts)${idTail(form.owner_contact_id || null)}` },
      { value: "office", label: `Company office contact (gets office texts)${idTail(form.office_contact_id || null)}` },
      ...contacts.map((c) => ({ value: c.id, label: `${c.name ?? "(unnamed)"} · ${c.role ?? "?"}${idTail(c.uptiq_contact_id)}` })),
    ];
  }, [contacts, form.owner_contact_id, form.office_contact_id]);

  const convContactName = (id: string) =>
    id === "owner" ? "Company owner contact"
      : id === "office" ? "Company office contact"
        : contacts.find((c) => c.id === id)?.name ?? "(unnamed)";

  // Owner/Office pickers: choose the company messaging contact from role-tagged contacts (the
  // Uptiq tag pull assigns roles), storing the contact's Uptiq id — same field the senders read.
  // Deduped by Uptiq id (persona contacts can share one); if the stored id doesn't belong to any
  // contact of that role it stays selectable as "Current" so an existing setup is never blanked
  // or hidden. "None" clears it (that audience simply stops receiving texts).
  const roleContactOptions = (role: "owner" | "office", currentId: string): SelectOption[] => {
    const seen = new Set<string>();
    const options: SelectOption[] = [{ value: "", label: "None" }];
    for (const c of contacts) {
      if (c.role !== role || !c.active || !c.uptiq_contact_id || seen.has(c.uptiq_contact_id)) continue;
      seen.add(c.uptiq_contact_id);
      options.push({ value: c.uptiq_contact_id, label: `${c.name ?? "(unnamed)"} · …${c.uptiq_contact_id.slice(-4)}` });
    }
    const current = currentId.trim();
    if (current && !seen.has(current)) {
      options.push({ value: current, label: `Current: …${current.slice(-4)} (no ${role}-tagged contact)` });
    }
    return options;
  };
  const ownerContactOptions = useMemo(() => roleContactOptions("owner", form.owner_contact_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, form.owner_contact_id]);
  const officeContactOptions = useMemo(() => roleContactOptions("office", form.office_contact_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, form.office_contact_id]);

  // Clear each selected contact's conversation independently (one backend call per contact) so
  // one failure never blocks the rest — each contact's outcome is captured in its own ConvRun.
  async function runConvClear(dryRun: boolean): Promise<ConvRun[]> {
    return Promise.all(convContactIds.map(async (id): Promise<ConvRun> => {
      const name = convContactName(id);
      try {
        return { contactId: id, name, result: await deleteContactConversation(id, dryRun), error: null };
      } catch (err) {
        return { contactId: id, name, result: null, error: err instanceof Error ? err.message : "failed" };
      }
    }));
  }

  async function handleConvPreview() {
    if (!convContactIds.length) return;
    setConvBusy("preview");
    setConvRuns(null);
    setError(null);
    try {
      setConvRuns(await runConvClear(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversation preview failed");
    } finally {
      setConvBusy(null);
    }
  }

  async function handleConvDelete() {
    if (!convContactIds.length) return;
    const names = convContactIds.map(convContactName);
    if (!(await confirm({
      title: `Clear ${convContactIds.length} Uptiq conversation${convContactIds.length > 1 ? "s" : ""}?`,
      body: `Backs up each contact + all messages here, then deletes the conversation thread in Uptiq for: ${names.join(", ")}. The contacts are NOT deleted; the next message to each starts a fresh thread.`,
      confirmLabel: "Back up & delete",
      destructive: true,
    }))) return;
    setConvBusy("delete");
    setConvRuns(null);
    setError(null);
    setNotice(null);
    try {
      const runs = await runConvClear(false);
      setConvRuns(runs);
      const ok = runs.filter((r) => r.result);
      const totalMessages = ok.reduce((sum, r) => sum + (r.result?.total_messages ?? 0), 0);
      const totalDeleted = ok.reduce((sum, r) => sum + (r.result?.deleted ?? 0), 0);
      const failed = runs.length - ok.length;
      setNotice(`Backed up ${totalMessages} message(s); deleted ${totalDeleted} conversation(s) across ${ok.length} contact(s)${failed ? ` · ${failed} failed` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversation delete failed");
    } finally {
      setConvBusy(null);
    }
  }

  const jobLabel = (job: JobSummary) =>
    `${job.address}${job.current_state?.label ? ` · ${job.current_state.label}` : ""}${job.active ? "" : " (archived)"}`;
  const jobAddress = (id: string) => clearableJobs.find((j) => j.id === id)?.address ?? "(job)";

  // Delete each selected job independently (one backend call per job) so one failure never
  // blocks the rest — each job's outcome is captured in its own JobClearRun.
  async function runJobClear(dryRun: boolean): Promise<JobClearRun[]> {
    return Promise.all(jobClearIds.map(async (id): Promise<JobClearRun> => {
      const address = jobAddress(id);
      try {
        return { jobId: id, address, result: await deleteJob(id, dryRun), error: null };
      } catch (err) {
        return { jobId: id, address, result: null, error: err instanceof Error ? err.message : "failed" };
      }
    }));
  }

  async function handleJobClearPreview() {
    if (!jobClearIds.length) return;
    setJobClearBusy("preview");
    setJobClearRuns(null);
    setError(null);
    try {
      setJobClearRuns(await runJobClear(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job preview failed");
    } finally {
      setJobClearBusy(null);
    }
  }

  async function handleJobClearDelete() {
    if (!jobClearIds.length) return;
    const addresses = jobClearIds.map(jobAddress);
    if (!(await confirm({
      title: `Delete ${jobClearIds.length} job${jobClearIds.length > 1 ? "s" : ""}?`,
      body: `Permanently deletes ${addresses.join(", ")} and ALL of their data — daily logs, expenses, purchase orders, and queued notifications. This cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
    }))) return;
    setJobClearBusy("delete");
    setJobClearRuns(null);
    setError(null);
    setNotice(null);
    try {
      const runs = await runJobClear(false);
      setJobClearRuns(runs);
      const ok = runs.filter((r) => r.result?.deleted);
      const failed = runs.length - ok.length;
      setNotice(`Deleted ${ok.length} job${ok.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}.`);
      // Drop the deleted jobs from the picker + selection so the list reflects reality.
      setJobClearIds([]);
      fetchJobs(true).then((res) => setClearableJobs(res.jobs)).catch(() => { /* keep the stale list on refresh failure */ });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job delete failed");
    } finally {
      setJobClearBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Company Settings</h1>
          <p className="text-xs text-muted-foreground">Business variables for this Uptiq instance.</p>
        </div>
        <div className="flex-1" />
        {canManage && (
          <button type="button" disabled={saving || loading || !form.company_name.trim() || !form.check_in_weekdays.length} onClick={save} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />
            Save Settings
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-5">
        <Metric icon={Clock3} label="Check-in send" value={form.check_in_send_time || "-"} />
        <Metric icon={CalendarClock} label="Check-in days" value={weekdayLabel || "-"} />
        <Metric icon={DollarSign} label="Parts ceiling" value={moneyLabel(Number(form.parts_cost_ceiling))} />
        <Metric icon={Truck} label="Supply houses" value={supplyHouses.length} tone={supplyReady ? "success" : "warning"} />
        <Metric icon={ShieldCheck} label="Office contact" value={officeReady ? "Set" : "Missing"} tone={officeReady ? "success" : "warning"} />
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading settings...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
          <main className="overflow-auto">
            <SettingsSection title="Company">
              <TextField label="Company name" value={form.company_name} disabled={!canManage || saving} onChange={(value) => updateForm({ company_name: value })} />
              <SelectField
                label="Timezone"
                value={form.timezone}
                disabled={!canManage || saving}
                onChange={(value) => updateForm({ timezone: value })}
                options={[
                  ...COMMON_TIMEZONES.map((timezone) => ({ value: timezone, label: timezone })),
                  ...(COMMON_TIMEZONES.includes(form.timezone) ? [] : [{ value: form.timezone, label: form.timezone }]),
                ]}
              />
            </SettingsSection>

            <SettingsSection title="Notification Timing">
              <TimeField label="Crew check-in send time" value={form.check_in_send_time} disabled={!canManage || saving} onChange={(value) => updateForm({ check_in_send_time: value })} />
              <WeekdayField values={form.check_in_weekdays} disabled={!canManage || saving} onToggle={toggleWeekday} />
              <TimeField label="Inspection reminder time" value={form.inspection_reminder_time} disabled={!canManage || saving} onChange={(value) => updateForm({ inspection_reminder_time: value })} />
              <SelectField
                label="Weekly report day"
                value={String(form.weekly_report_day)}
                disabled={!canManage || saving}
                onChange={(value) => updateForm({ weekly_report_day: Number(value) })}
                options={WEEKLY_REPORT_DAYS.map((day) => ({ value: String(day.value), label: day.label }))}
              />
              <TimeField label="Weekly report time" value={form.weekly_report_time} disabled={!canManage || saving} onChange={(value) => updateForm({ weekly_report_time: value })} />
              <NumberField label="Review delay days" value={form.review_request_delay_days} disabled={!canManage || saving} onChange={(value) => updateForm({ review_request_delay_days: value })} min={0} step="1" />
            </SettingsSection>

            <SettingsSection title="Owner & Office">
              <SelectField label="Owner (gets owner texts)" value={form.owner_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_contact_id: value })} options={ownerContactOptions} />
              <SelectField label="Office (gets office texts)" value={form.office_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ office_contact_id: value })} options={officeContactOptions} />
            </SettingsSection>

            <SettingsSection title="Supply & Costs">
              <SelectField
                label="Default supply house"
                value={form.default_supply_house_contact_id}
                disabled={!canManage || saving}
                onChange={(value) => updateForm({ default_supply_house_contact_id: value })}
                options={[{ value: "", label: "None selected" }, ...supplyHouses.map((supply) => ({ value: supply.id, label: supply.name }))]}
              />
              <NumberField label="Parts cost ceiling" value={form.parts_cost_ceiling} disabled={!canManage || saving} onChange={(value) => updateForm({ parts_cost_ceiling: value })} min={0} step="0.01" />
              <TextField label="Supply pickup time" value={form.supply_house_pickup_time} disabled={!canManage || saving} onChange={(value) => updateForm({ supply_house_pickup_time: value })} />
            </SettingsSection>

            <SettingsSection title="Brand">
              <ColorField label="Primary color" value={form.brand_primary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_primary_color: value })} />
              <ColorField label="Secondary color" value={form.brand_secondary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_secondary_color: value })} />
              <TextField label="Brand font" value={form.brand_font} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_font: value })} />
              <TextField label="Logo URL" value={form.brand_logo_url} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_logo_url: value })} />
            </SettingsSection>

            <SettingsSection title="External IDs">
              <TextField label="Uptiq company ID" value={form.uptiq_company_id} disabled={!canManage || saving} onChange={(value) => updateForm({ uptiq_company_id: value })} />
              <TextField label="Inspections calendar ID" value={form.inspections_calendar_id} disabled={!canManage || saving} onChange={(value) => updateForm({ inspections_calendar_id: value })} />
            </SettingsSection>

            {canManage && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Debug</div>
                <div className="px-4 py-4">
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={form.debug_mode} disabled={!canManage || saving} onChange={(event) => updateForm({ debug_mode: event.target.checked })} />
                    <span>
                      <span className="font-medium">Debug mode</span> &mdash; show the diagnostic panels (run crons on demand,
                      Uptiq contacts sync) and extra data on how things are working. Leave <strong>off</strong> for a clean/demo
                      tenant. Toggling shows/hides the panels immediately; <strong>Save Settings</strong> to persist it.
                    </span>
                  </label>
                </div>
              </section>
            )}

            {canManage && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Run crons</div>
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Check the jobs to fire now (ignoring their configured send times), then <strong>Run selected</strong>.
                    Each send-cron is forced and the queue is <strong>drained once</strong> so messages go out on the press.
                    <strong> Sends real SMS/email</strong> via Uptiq &mdash; for testing.
                  </p>
                  <div className="grid gap-1.5">
                    {CRON_TARGETS.map((t) => (
                      <label key={t.key} className="flex items-start gap-2 text-xs">
                        <input type="checkbox" className="mt-0.5" checked={cronSelected.includes(t.key)} disabled={cronBusy} onChange={() => toggleCron(t.key)} />
                        <span><span className="font-medium">{t.label}</span> <span className="text-muted-foreground">&mdash; {t.note}</span></span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={handleRunCrons} disabled={cronBusy || !cronSelected.length} className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50">
                      {cronBusy ? "Running..." : `Run selected (${cronSelected.length})`}
                    </button>
                    <button type="button" onClick={() => { setCronResult(null); setCronSelected(cronSelected.length === CRON_TARGETS.length ? [] : CRON_TARGETS.map((t) => t.key)); }} disabled={cronBusy} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-50">
                      {cronSelected.length === CRON_TARGETS.length ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <p className="text-2xs text-muted-foreground">Weekly report won&rsquo;t resend twice in one period; one drain sends up to 100 queued messages.</p>
                  {cronResult && <CronRunSummary result={cronResult} />}
                </div>
              </section>
            )}

            {canSyncContacts && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Uptiq contacts</div>
                <div className="space-y-5 px-4 py-4">
                  <div className="space-y-3">
                    <p className="text-xs font-medium">Pull contacts from Uptiq <span className="text-muted-foreground">(by tag)</span></p>
                    <p className="text-xs text-muted-foreground">
                      Imports every tagged Uptiq contact into <strong>Contacts</strong> by role
                      (crew / customer / owner / office / supply house), and links supply houses into the
                      <strong> Supply Houses</strong> list too. <strong>Read-only in Uptiq</strong>, additive; untagged or
                      unrecognized contacts are skipped. Preview first to confirm the tag&rarr;role mapping.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <CronButton label="Preview (dry run)" busy={pullBusy === "preview"} disabled={pullBusy !== null} onClick={() => handlePull(true)} />
                      <CronButton label="Import from Uptiq" busy={pullBusy === "pull"} disabled={pullBusy !== null} onClick={() => handlePull(false)} />
                    </div>
                    {pullResult && <ContactsPullSummary result={pullResult} />}
                  </div>

                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-xs font-medium">Link app parties to Uptiq</p>
                    <p className="text-xs text-muted-foreground">
                      Finds each app party (customers, crew, supply houses, owner, office) in Uptiq by email/phone and
                      stores the matching Uptiq contact id so messaging can reach them. <strong>Read-only</strong> &mdash;
                      nothing is created or changed in Uptiq. On staging, most parties are test data not in Uptiq, so
                      expect &ldquo;not in Uptiq&rdquo; for those.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <CronButton label="Preview (dry run)" busy={contactsBusy === "preview"} disabled={contactsBusy !== null} onClick={() => handleSyncContacts(true)} />
                      <CronButton label="Sync from Uptiq" busy={contactsBusy === "sync"} disabled={contactsBusy !== null} onClick={() => handleSyncContacts(false)} />
                    </div>
                    {contactsResult && <ContactsSyncSummary result={contactsResult} />}
                  </div>
                </div>
              </section>
            )}

            {canSyncContacts && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Send a test message</div>
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Send one SMS or email to a Uptiq-linked contact <strong>right now</strong> (bypasses the queue) to
                    verify delivery. Returns the raw provider status.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <InlineSelect
                      value={testContactId}
                      onChange={(value) => { setTestContactId(value); setTestResult(null); }}
                      disabled={testBusy}
                      className="h-8 w-64"
                      placeholder={contacts.length ? "Select a contact…" : "No Uptiq-linked contacts"}
                      options={contacts.map((c) => ({ value: c.id, label: `${c.name ?? "(unnamed)"} · ${c.role ?? "?"}` }))}
                    />
                    <InlineSelect
                      value={testChannel}
                      onChange={(value) => setTestChannel(value === "email" ? "email" : "sms")}
                      disabled={testBusy}
                      className="h-8 w-28"
                      options={[{ value: "sms", label: "SMS" }, { value: "email", label: "Email" }]}
                    />
                  </div>
                  <input
                    value={testMessage}
                    onChange={(event) => setTestMessage(event.target.value)}
                    disabled={testBusy}
                    maxLength={300}
                    placeholder={testChannel === "email" ? "Subject (optional)" : "Message (optional)"}
                    className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65"
                  />
                  <CronButton label="Send test" busy={testBusy} disabled={!testContactId || testBusy} onClick={handleSendTest} />
                  {testResult && (
                    <div className="break-all rounded-sm border border-border bg-muted/40 px-3 py-2 font-mono text-2xs text-muted-foreground">
                      {testResult.channel} · {testResult.provider_ok ? "OK" : `error ${testResult.provider_status}`}{testResult.provider_error ? ` · ${testResult.provider_error}` : ""}
                    </div>
                  )}
                </div>
              </section>
            )}

            {canSyncContacts && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Conversations (debug)</div>
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Clear a contact&rsquo;s Uptiq text/email thread so the next message starts fresh &mdash; for testing.
                    Backs up the contact + all messages to <code className="font-mono">conversation_backups</code> first, then
                    deletes the <strong>conversation</strong> in Uptiq. The <strong>contact is not deleted</strong>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <InlineMultiSelect
                      values={convContactIds}
                      onChange={(values) => { setConvContactIds(values); setConvRuns(null); }}
                      disabled={convBusy !== null}
                      className="h-8 w-72"
                      placeholder="Select contacts…"
                      options={convOptions}
                    />
                    <CronButton label="Preview" busy={convBusy === "preview"} disabled={!convContactIds.length || convBusy !== null} onClick={handleConvPreview} />
                    <CronButton label="Back up & delete" busy={convBusy === "delete"} disabled={!convContactIds.length || convBusy !== null} onClick={handleConvDelete} />
                  </div>
                  {convRuns && convRuns.map((run) => (
                    <div key={run.contactId} className="space-y-1 rounded-sm border border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
                      {run.error ? (
                        <div className="text-destructive"><span className="font-medium">{run.name}</span>: {run.error}</div>
                      ) : run.result && (
                        <>
                          <div className="font-medium text-foreground">
                            {run.result.dry_run ? "Preview" : "Done"}: {run.result.contact.name ?? run.name} &mdash; {run.result.total_conversations} conversation(s), {run.result.total_messages} message(s){run.result.capped && " (backup capped at 2000/conv)"}{!run.result.dry_run && ` · deleted ${run.result.deleted ?? 0}`}
                          </div>
                          {run.result.backup_id && <div>Backup id: <span className="font-mono">{run.result.backup_id}</span></div>}
                          {(run.result.results ?? []).filter((r) => !r.deleted).map((r, index) => (
                            <div key={index} className="text-destructive">conversation {r.id.slice(0, 8)}: {r.error}{r.status ? ` (${r.status})` : ""}</div>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {canSyncContacts && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Jobs (debug)</div>
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Permanently delete test jobs and everything under them &mdash; daily logs, expenses, purchase orders, and
                    queued notifications. Use this to reset test data; it <strong>cannot be undone</strong>. To take a real job
                    out of the daily loop without deleting it, use <strong>Archive</strong> on the job instead.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <InlineMultiSelect
                      values={jobClearIds}
                      onChange={(values) => { setJobClearIds(values); setJobClearRuns(null); }}
                      disabled={jobClearBusy !== null}
                      className="h-8 w-72"
                      placeholder={clearableJobs.length ? "Select jobs…" : "No jobs"}
                      options={clearableJobs.map((j) => ({ value: j.id, label: jobLabel(j) }))}
                    />
                    <CronButton label="Preview" busy={jobClearBusy === "preview"} disabled={!jobClearIds.length || jobClearBusy !== null} onClick={handleJobClearPreview} />
                    <CronButton label="Delete jobs" busy={jobClearBusy === "delete"} disabled={!jobClearIds.length || jobClearBusy !== null} onClick={handleJobClearDelete} />
                  </div>
                  {jobClearRuns && jobClearRuns.map((run) => (
                    <div key={run.jobId} className="space-y-1 rounded-sm border border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
                      {run.error ? (
                        <div className="text-destructive"><span className="font-medium">{run.address}</span>: {run.error}</div>
                      ) : run.result && (
                        <div className="font-medium text-foreground">
                          {run.result.dry_run ? "Preview" : "Deleted"}: {run.result.job.address ?? run.address} &mdash;{" "}
                          {run.result.counts.daily_logs} log(s), {run.result.counts.expenses} expense(s),{" "}
                          {run.result.counts.purchase_orders} PO(s), {run.result.counts.notifications} notification(s)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>

          <aside className="overflow-auto border-l border-border bg-card">
            <div className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold">Setup Health</h2>
                <p className="mt-1 text-xs text-muted-foreground">Variables needed before activation.</p>
              </div>
              <HealthRow label="Owner contact" ok={ownerReady} />
              <HealthRow label="Office contact" ok={officeReady} />
              <HealthRow label="Check-in schedule" ok={Boolean(form.check_in_send_time && form.check_in_weekdays.length)} />
              <HealthRow label="Supply settings" ok={supplyReady && Boolean(form.supply_house_pickup_time)} />
              <HealthRow label="Uptiq company ID" ok={companyIdReady} />
              <HealthRow label="Inspection calendar" ok={Boolean(form.inspections_calendar_id)} />
              <HealthRow label="Brand theme" ok={Boolean(form.brand_primary_color && form.brand_secondary_color && form.brand_font)} />
              {!canManage && (
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  View-only role.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function CronButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      {busy ? "Running..." : label}
    </button>
  );
}

function ContactsPullSummary({ result }: { result: ContactsPullResult }) {
  const byRole = Object.entries(result.by_role ?? {}).sort((a, b) => b[1] - a[1]);
  const supply = (result.supply_imported ?? 0) + (result.supply_updated ?? 0) + (result.supply_linked ?? 0);
  const summary = result.dry_run
    ? `Preview — scanned ${result.scanned ?? 0}${result.capped ? " (page cap hit)" : ""}; ${result.would_import ?? 0} would import by tag.`
    : `Imported ${result.contacts_imported ?? 0} · Updated ${result.contacts_updated ?? 0} contacts · Supply houses +${supply} · Skipped ${result.skipped ?? 0}.`;
  const rows = result.dry_run
    ? (result.preview ?? []).map((c) => ({ label: `${c.name || "(unnamed)"} → ${c.role}`, note: (c.tags ?? []).join(", ") }))
    : (result.errors ?? []).map((e) => ({ label: e.where ?? "error", note: `${e.id ?? ""} ${e.error ?? ""}`.trim() }));
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{summary}</div>
      {byRole.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {byRole.map(([role, n]) => (
            <span key={role} className={`pill ${role === "unrecognized" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"}`}>{role}: {n}</span>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-sm border border-border">
          <table className="w-full text-2xs">
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1">{row.label}</td>
                  <td className="break-all px-2 py-1 font-mono text-muted-foreground">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.dry_run && (result.unrecognized ?? []).length > 0 && (
        <div className="text-2xs text-muted-foreground">
          Skipped (no recognized tag): {(result.unrecognized ?? []).map((u) => u.name || u.email || "(unnamed)").slice(0, 10).join(", ")}{(result.unrecognized ?? []).length > 10 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

function CronRunSummary({ result }: { result: RunCronsResult }) {
  const sent = result.drain?.result ? JSON.stringify(result.drain.result) : null;
  return (
    <div className="space-y-1 rounded-sm border border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
      {result.crons.map((c) => (
        <div key={c.cron}><span className="font-medium text-foreground">{CRON_LABEL_BY_FN[c.cron] ?? c.cron}</span>: {c.ok ? "queued" : `error ${c.status}`}</div>
      ))}
      {result.drain && <div><span className="font-medium text-foreground">Drain queue</span>: {result.drain.ok ? "sent" : `error ${result.drain.status}`}{sent ? ` · ${sent}` : ""}</div>}
      {!result.crons.length && !result.drain && <div>Nothing selected.</div>}
    </div>
  );
}

function ContactsSyncSummary({ result }: { result: ContactsSyncResult }) {
  const rows = result.dry_run
    ? (result.parties ?? []).map((p) => ({ key: p.key, label: p.name || p.email || p.phone || "-", note: p.has_existing_id ? "already linked" : (p.email || p.phone || "") }))
    : (result.results ?? []).map((r) => ({ key: r.key, label: r.action ?? (r.ok ? "ok" : "failed"), note: r.contact_id ?? r.error ?? "" }));
  const summary = result.dry_run
    ? `Preview — ${result.would_sync ?? 0} of ${result.total_reachable} reachable parties would sync (no Uptiq calls made).`
    : `Linked ${result.linked ?? 0} · Not in Uptiq ${result.not_found ?? 0} · Failed ${result.failed ?? 0} (of ${result.attempted ?? 0} attempted).`;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{summary}</div>
      {rows.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-sm border border-border">
          <table className="w-full text-2xs">
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1 text-muted-foreground">{row.key}</td>
                  <td className="px-2 py-1">{row.label}</td>
                  <td className="break-all px-2 py-1 font-mono text-muted-foreground">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function TextField({ label, value, disabled, onChange, type = "text" }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
    </label>
  );
}

function NumberField({ label, value, disabled, onChange, min, step }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  min: number;
  step: string;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input type="number" min={min} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
    </label>
  );
}

function TimeField({ label, value, disabled, onChange }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input type="time" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
    </label>
  );
}

function SelectField({ label, value, disabled, onChange, options }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <InlineSelect value={value} disabled={disabled} onChange={onChange} options={options} className="w-full" />
    </div>
  );
}

function ColorField({ label, value, disabled, onChange }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_48px] gap-2 text-xs">
      <label className="block">
        <span className="mb-1 block text-muted-foreground">{label}</span>
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs disabled:opacity-65" />
      </label>
      <label className="block">
        <span className="mb-1 block text-muted-foreground">Swatch</span>
        <input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background p-1 disabled:opacity-65" />
      </label>
    </div>
  );
}

function WeekdayField({ values, disabled, onToggle }: {
  values: number[];
  disabled: boolean;
  onToggle: (value: number) => void;
}) {
  return (
    <div className="text-xs">
      <span className="mb-1 block text-muted-foreground">Check-in days</span>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(day.value)}
            className={`h-9 rounded-sm border text-xs font-medium disabled:opacity-65 ${values.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-xs">
      <span>{label}</span>
      <span className={`pill ${ok ? "bg-success/10 text-success" : "bg-warning/20 text-warning"}`}>{ok ? "ready" : "missing"}</span>
    </div>
  );
}
