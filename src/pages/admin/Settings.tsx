import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import {
  COMMON_TIMEZONES,
  WEEKDAYS,
  WEEKLY_REPORT_DAYS,
  canManageSettings,
  fetchSettings,
  runCrons,
  saveSettings,
  syncWithUptiq,
  timeForInput,
  clearData,
  fetchMessageLog,
  fetchMessageTemplates,
  saveMessageTemplate,
  formTestToken,
  CLEAR_DATA_CATEGORIES,
  type ClearDataCategory,
  type ClearDataResult,
  type MessageLogEntry,
  type MessageTemplate,
  type ContactsSyncResult,
  type ContactsPullResult,
  type CronKey,
  type RunCronsResult,
  type CompanySettings,
  type SettingsLocation,
  type SettingsResponse,
} from "@/lib/settings";
import { useSession } from "@/lib/session";
import { currentEnvLabel, otherEnvLabel, switchEnv } from "@/lib/envswitch";
import { InlineSelect, type SelectOption } from "@/components/InlineSelect";
import { InlineMultiSelect } from "@/components/InlineMultiSelect";
import { useConfirm } from "@/components/dialogs";
import { fetchContacts, deleteContactConversation, listUptiqThreads, sendTest, type ContactRow, type ConversationDeleteResult, type SendTestResult, type UptiqThread } from "@/lib/contacts";
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

// Config tabs + a debug tab (the debug tab only renders for users who hold a debug tool).
// The token-gated forms the Forms debug sub-tab can open a live test copy of.
const DEBUG_FORMS: { form: string; label: string; note: string }[] = [
  { form: "daily_check_in", label: "Daily check-in", note: "Crew's daily log — binds to a crew contact + the latest job." },
  { form: "inspection_date", label: "Inspection date", note: "Owner picks the inspection date." },
  { form: "walkthrough_date", label: "Walkthrough date", note: "Owner schedules the walkthrough." },
  { form: "inspection_fix_details", label: "Inspection fix details", note: "Owner records what the inspector flagged." },
  { form: "walkthrough_punch_details", label: "Walkthrough punch list", note: "Owner's list of remaining items." },
  { form: "quick_log", label: "Quick log", note: "Crew's quick log — binds to a crew contact + the latest job." },
];

type SettingsTab = "company" | "notifications" | "supply" | "branding" | "debug";
const CONFIG_TABS: { key: SettingsTab; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "notifications", label: "Notifications" },
  { key: "supply", label: "Supply & Costs" },
  { key: "branding", label: "Branding & IDs" },
];

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

export default function AdminSettings() {
  const { user } = useSession();
  const canManage = canManageSettings(user?.role);
  // Per-tool DEBUG capability: dev_super and support_admin hold every tool; a plain Owner holds
  // exactly what a dev_super granted (app_users.debug_tools). Server-side gates re-check fresh.
  const hasDebugTool = (tool: string) =>
    user?.role === "dev_super" || user?.role === "support_admin"
    || (user?.role === "owner_admin" && (user?.debug_tools ?? []).includes(tool));
  const canDebugAny = user?.role === "dev_super" || user?.role === "support_admin"
    || (user?.role === "owner_admin" && (user?.debug_tools ?? []).length > 0);
  const confirm = useConfirm();
  const [tab, setTab] = useState<SettingsTab>("company");
  const [debugSubTab, setDebugSubTab] = useState<"general" | "messages" | "forms">("general");
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>(blankForm());
  // Debug PANELS normally hide behind the per-company debug_mode toggle (an owner's switch to
  // reveal them). A dev_super is an app-wide superuser whose tools should be available on every
  // instance regardless of that per-tenant flag, so they bypass debug_mode. Owners still gate on it.
  const debugPanelsShown = form.debug_mode || user?.role === "dev_super";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cronSelected, setCronSelected] = useState<CronKey[]>(["check-ins", "inspection-reminders", "weekly-report"]);
  const [cronBusy, setCronBusy] = useState(false);
  const [cronResult, setCronResult] = useState<RunCronsResult | null>(null);
  const [uptiqSyncBusy, setUptiqSyncBusy] = useState<"preview" | "sync" | null>(null);
  const [uptiqSyncResult, setUptiqSyncResult] = useState<{ pull: ContactsPullResult; link: ContactsSyncResult } | null>(null);
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
  const [uptiqThreads, setUptiqThreads] = useState<UptiqThread[] | null>(null);
  const [threadsBusy, setThreadsBusy] = useState(false);
  const [clearableJobs, setClearableJobs] = useState<JobSummary[]>([]);
  const [jobClearIds, setJobClearIds] = useState<string[]>([]);
  const [jobClearBusy, setJobClearBusy] = useState<"preview" | "delete" | null>(null);
  // One entry per selected job (the backend deletes one job at a time).
  const [jobClearRuns, setJobClearRuns] = useState<JobClearRun[] | null>(null);
  const [resetCategories, setResetCategories] = useState<ClearDataCategory[]>([]);
  const [resetBusy, setResetBusy] = useState<"preview" | "clear" | null>(null);
  const [resetResult, setResetResult] = useState<ClearDataResult | null>(null);
  const [messageLog, setMessageLog] = useState<MessageLogEntry[] | null>(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Sent/queued message log grouped by contact (debug). Server returns newest-first; group by
  // recipient contact and sort the groups by name.
  const messageGroups = useMemo(() => {
    const map = new Map<string, { name: string; role: string | null; recipient: string; items: MessageLogEntry[] }>();
    for (const m of messageLog ?? []) {
      const key = m.contact_name ?? m.recipient ?? "(unknown)";
      const group = map.get(key) ?? { name: m.contact_name ?? m.recipient ?? "(unknown)", role: m.contact_role, recipient: m.recipient, items: [] };
      group.items.push(m);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [messageLog]);
  async function handleLoadMessageLog() {
    setMessageBusy(true);
    setError(null);
    try {
      const res = await fetchMessageLog(300);
      setMessageLog(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load message log");
    } finally {
      setMessageBusy(false);
    }
  }

  // Message-format editor (Messages debug sub-tab). Overrides are per-company; an empty body resets
  // a template to its built-in default. tplSubject/tplBody hold the form for the selected template.
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplKey, setTplKey] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplNotice, setTplNotice] = useState<string | null>(null);
  const selectedTpl = templates?.find((t) => t.key === tplKey) ?? null;

  function selectTemplate(key: string, list: MessageTemplate[] | null = templates) {
    setTplKey(key);
    setTplNotice(null);
    const t = list?.find((x) => x.key === key);
    setTplSubject(t?.override_subject ?? "");
    setTplBody(t?.override_body ?? "");
  }
  async function loadTemplates() {
    setTplBusy(true);
    setError(null);
    try {
      const res = await fetchMessageTemplates();
      setTemplates(res.templates);
      if (res.templates[0]) selectTemplate(res.templates[0].key, res.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load message templates");
    } finally {
      setTplBusy(false);
    }
  }
  async function persistTemplate(subject: string, bodyText: string) {
    if (!tplKey) return;
    setTplBusy(true);
    setError(null);
    setTplNotice(null);
    try {
      await saveMessageTemplate(tplKey, subject.trim() ? subject : null, bodyText);
      const res = await fetchMessageTemplates();
      setTemplates(res.templates);
      setTplNotice(bodyText.trim() ? "Saved — applies to real sends." : "Reset to the built-in default.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save template");
    } finally {
      setTplBusy(false);
    }
  }
  function saveTemplate() { void persistTemplate(tplSubject, tplBody); }
  function resetTemplate() { setTplBody(""); setTplSubject(""); void persistTemplate("", ""); }

  // Forms debug sub-tab: mint a single-use token for a form and open a live test copy in a new tab.
  const [formBusy, setFormBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  async function openTestForm(formKey: string) {
    setFormBusy(formKey);
    setFormError(null);
    try {
      const res = await formTestToken(formKey);
      window.open(`${window.location.origin}${res.path}?token=${encodeURIComponent(res.token)}`, "_blank", "noopener");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setFormError(
        msg.includes("no_state_set") ? "This tenant has no job states configured yet."
          : "Could not open a test copy.",
      );
    } finally {
      setFormBusy(null);
    }
  }

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
    if (!hasDebugTool("jobs_clear")) return;
    fetchJobs(true)
      .then((res) => setClearableJobs(res.jobs))
      .catch(() => { /* leave the picker empty on failure */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.debug_tools]);

  const supplyHouses = useMemo(() => data?.supply_houses ?? [], [data?.supply_houses]);
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

  // ONE command (contacts-sync mode:"sync") running both steps server-side: (1) the tag pull
  // imports/repairs everything Uptiq says (it is the id authority), then (2) the link pass fills
  // Uptiq ids for whatever app-side parties remain unlinked (job customers, hand-entered supply
  // houses). Link runs second and never overwrites, so the chain can't undo step 1.
  async function handleUptiqSync(dryRun: boolean) {
    if (!dryRun && !(await confirm({
      title: "Sync contacts with Uptiq now?",
      body: "Step 1 imports every tagged Uptiq contact by role (repairing stale links; supply houses land in the Supply Houses list too). Step 2 finds any remaining unlinked app parties in Uptiq by name/email/phone and stores their ids. Read-only in Uptiq; additive — never removes anyone.",
      confirmLabel: "Sync",
    }))) return;
    setUptiqSyncBusy(dryRun ? "preview" : "sync");
    setUptiqSyncResult(null);
    setError(null);
    try {
      const res = await syncWithUptiq({ dryRun });
      setUptiqSyncResult({ pull: res.pull, link: res.link });
      // The pull may have imported/repaired contacts — refresh the pickers that feed off them.
      if (!dryRun) fetchContacts().then((r) => setContacts(r.contacts.filter((c) => c.uptiq_contact_id))).catch(() => { /* stale list is fine */ });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uptiq contact sync failed");
    } finally {
      setUptiqSyncBusy(null);
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
    // Threads loaded straight from Uptiq reach conversations the app's contact mapping can't —
    // e.g. a PREVIOUS owner/office messaging contact after Settings switched to a different one.
    // Skip threads whose Uptiq id an app contact or company target already covers.
    const known = new Set<string>([form.owner_contact_id, form.office_contact_id, ...contacts.map((c) => c.uptiq_contact_id ?? "")].filter(Boolean));
    const threadOptions = (uptiqThreads ?? [])
      .filter((t) => !known.has(t.uptiq_contact_id))
      .map((t) => ({ value: `uptiq:${t.uptiq_contact_id}`, label: `${t.name ?? "(unnamed)"} · Uptiq thread${idTail(t.uptiq_contact_id)}` }));
    return [
      { value: "owner", label: `Company owner contact (gets owner texts)${idTail(form.owner_contact_id || null)}` },
      { value: "office", label: `Company office contact (gets office texts)${idTail(form.office_contact_id || null)}` },
      ...contacts.map((c) => ({ value: c.id, label: `${c.name ?? "(unnamed)"} · ${c.role ?? "?"}${idTail(c.uptiq_contact_id)}` })),
      ...threadOptions,
    ];
  }, [contacts, uptiqThreads, form.owner_contact_id, form.office_contact_id]);

  async function handleLoadThreads() {
    setThreadsBusy(true);
    setError(null);
    try {
      const res = await listUptiqThreads();
      setUptiqThreads(res.threads);
      setNotice(`Loaded ${res.total} Uptiq thread${res.total === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Uptiq threads");
    } finally {
      setThreadsBusy(false);
    }
  }

  const convContactName = (id: string) =>
    id === "owner" ? "Company owner contact"
      : id === "office" ? "Company office contact"
        : id.startsWith("uptiq:")
          ? (uptiqThreads?.find((t) => t.uptiq_contact_id === id.slice(6))?.name ?? `Uptiq contact …${id.slice(-4)}`)
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
        return { contactId: id, name, result: await deleteContactConversation(id, dryRun, name), error: null };
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

  const resetLabel = (key: ClearDataCategory) =>
    CLEAR_DATA_CATEGORIES.find((c) => c.key === key)?.label ?? key;

  async function handleResetPreview() {
    if (!resetCategories.length) return;
    setResetBusy("preview");
    setResetResult(null);
    setError(null);
    try {
      setResetResult(await clearData(resetCategories, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setResetBusy(null);
    }
  }

  async function handleResetClear() {
    if (!resetCategories.length) return;
    if (!(await confirm({
      title: `Clear ${resetCategories.length} data categor${resetCategories.length > 1 ? "ies" : "y"}?`,
      body: `Permanently deletes all ${resetCategories.map(resetLabel).join(", ")} for this company. Rows protected by job history are skipped. This cannot be undone.`,
      confirmLabel: "Clear permanently",
      destructive: true,
    }))) return;
    setResetBusy("clear");
    setResetResult(null);
    setError(null);
    setNotice(null);
    try {
      const res = await clearData(resetCategories, false);
      setResetResult(res);
      const total = res.results.reduce((n, r) => n + (r.deleted ?? 0), 0);
      const blocked = res.results.reduce((n, r) => n + (r.blocked ?? 0), 0);
      setNotice(`Cleared ${total} row${total === 1 ? "" : "s"}${blocked ? ` · ${blocked} skipped (still referenced)` : ""}.`);
      // Contacts / supply houses may have changed — refresh the pickers that feed off them.
      fetchContacts().then((r) => setContacts(r.contacts.filter((c) => c.uptiq_contact_id))).catch(() => { /* stale list is fine */ });
      fetchSettings().then((next) => setData(next)).catch(() => { /* stale payload is fine */ });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setResetBusy(null);
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

      {/* Setup health — compact strip, visible on every tab (replaces the old side panel + stat row). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Setup health</span>
        <HealthPill label="Owner" ok={ownerReady} />
        <HealthPill label="Office" ok={officeReady} />
        <HealthPill label="Check-in" ok={Boolean(form.check_in_send_time && form.check_in_weekdays.length)} />
        <HealthPill label="Supply" ok={supplyReady && Boolean(form.supply_house_pickup_time)} />
        <HealthPill label="Company ID" ok={companyIdReady} />
        <HealthPill label="Calendar" ok={Boolean(form.inspections_calendar_id)} />
        <HealthPill label="Brand" ok={Boolean(form.brand_primary_color && form.brand_secondary_color && form.brand_font)} />
      </div>

      {error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      {notice && <div className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>}
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading settings...</div>}

      {!loading && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-border bg-card px-4 pt-2">
            {CONFIG_TABS.map((t) => (
              <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabButton>
            ))}
            {canDebugAny && <TabButton active={tab === "debug"} onClick={() => setTab("debug")}>Debug</TabButton>}
          </div>
          <div className="flex-1 overflow-auto">
            {tab === "company" && (
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
            )}

            {tab === "notifications" && (
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
            )}

            {tab === "company" && (
            <SettingsSection title="Owner & Office">
              <SelectField label="Owner (gets owner texts)" value={form.owner_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_contact_id: value })} options={ownerContactOptions} />
              <SelectField label="Office (gets office texts)" value={form.office_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ office_contact_id: value })} options={officeContactOptions} />
            </SettingsSection>
            )}

            {tab === "supply" && (
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
            )}

            {tab === "branding" && (
            <SettingsSection title="Brand">
              <ColorField label="Primary color" value={form.brand_primary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_primary_color: value })} />
              <ColorField label="Secondary color" value={form.brand_secondary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_secondary_color: value })} />
              <TextField label="Brand font" value={form.brand_font} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_font: value })} />
              <TextField label="Logo URL" value={form.brand_logo_url} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_logo_url: value })} />
            </SettingsSection>
            )}

            {tab === "branding" && (
            <SettingsSection title="External IDs">
              <TextField label="Uptiq company ID" value={form.uptiq_company_id} disabled={!canManage || saving} onChange={(value) => updateForm({ uptiq_company_id: value })} />
              <TextField label="Inspections calendar ID" value={form.inspections_calendar_id} disabled={!canManage || saving} onChange={(value) => updateForm({ inspections_calendar_id: value })} />
            </SettingsSection>
            )}

            {tab === "debug" && canDebugAny && (
              <section className="border-b border-border">
                <div className="px-4 py-3">
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={form.debug_mode} disabled={!canManage || saving} onChange={(event) => updateForm({ debug_mode: event.target.checked })} />
                    <span>
                      <span className="font-medium">Debug mode</span>{" "}
                      <span className="text-muted-foreground">&mdash; show the diagnostic tools below. Off for a clean/demo tenant; Save Settings to persist.</span>
                      {user?.role === "dev_super" && (
                        <span className="mt-0.5 block text-2xs text-muted-foreground">As a dev_super, the tools stay visible to you on every instance regardless of this toggle.</span>
                      )}
                    </span>
                  </label>
                </div>
              </section>
            )}

            {/* Environment switch — dev_super only. Bounces this iframe between the Dev and Stable
                builds so a developer can preview either version inside Uptiq. Not gated behind
                debug_mode so the bounce-back is always reachable. */}
            {tab === "debug" && user?.role === "dev_super" && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Environment</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Bounce this iframe between the Dev and Stable (prod) builds to preview either version inside Uptiq. dev_super only.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill bg-muted text-muted-foreground">On: {currentEnvLabel()}</span>
                  <button
                    type="button"
                    onClick={switchEnv}
                    className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Switch to {otherEnvLabel()} &rarr;
                  </button>
                </div>
              </section>
            )}

            {tab === "debug" && canDebugAny && debugPanelsShown && (
              <div className="flex flex-wrap gap-1 border-b border-border bg-card px-4 pt-2">
                <TabButton active={debugSubTab === "general"} onClick={() => setDebugSubTab("general")}>General</TabButton>
                <TabButton active={debugSubTab === "messages"} onClick={() => setDebugSubTab("messages")}>Messages</TabButton>
                <TabButton active={debugSubTab === "forms"} onClick={() => setDebugSubTab("forms")}>Forms</TabButton>
              </div>
            )}

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("run_crons") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Run crons</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Fire selected crons now (ignores send times) &mdash; sends real SMS/email via Uptiq, for testing.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
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

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("contacts_sync") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Uptiq contacts</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Import Uptiq contacts by tag, then link the rest by name/email/phone. Read-only in Uptiq; additive.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <CronButton label="Preview (dry run)" busy={uptiqSyncBusy === "preview"} disabled={uptiqSyncBusy !== null} onClick={() => handleUptiqSync(true)} />
                    <CronButton label="Sync with Uptiq" busy={uptiqSyncBusy === "sync"} disabled={uptiqSyncBusy !== null} onClick={() => handleUptiqSync(false)} />
                  </div>
                  {uptiqSyncResult && (
                    <div className="space-y-2">
                      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Step 1 &mdash; tag import</p>
                      <ContactsPullSummary result={uptiqSyncResult.pull} />
                      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Step 2 &mdash; link the rest</p>
                      <ContactsSyncSummary result={uptiqSyncResult.link} />
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("send_test") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Send test message</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Send one SMS/email to a contact now (bypasses the queue); returns the raw provider status.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
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

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("conversations") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Conversations</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Back up then clear a contact&rsquo;s Uptiq thread so the next message starts fresh. The contact is kept.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
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
                    <CronButton label="Load Uptiq threads" busy={threadsBusy} disabled={threadsBusy || convBusy !== null} onClick={handleLoadThreads} />
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Load Uptiq threads adds every conversation Uptiq has for this location to the picker &mdash;
                    including threads for contacts the app doesn&rsquo;t know (e.g. a previous owner/office contact).
                  </p>
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

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("jobs_clear") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Delete jobs</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Permanently delete test jobs + all their data (logs, expenses, POs, notifications). Can&rsquo;t be undone; use Archive for real jobs.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
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

            {tab === "debug" && debugSubTab === "general" && hasDebugTool("data_reset") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Data reset</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Clear accumulated test data by category (history, snapshots, imported contacts…). Rows tied to job history are skipped. Can&rsquo;t be undone.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <InlineMultiSelect
                      values={resetCategories}
                      onChange={(values) => { setResetCategories(values as ClearDataCategory[]); setResetResult(null); }}
                      disabled={resetBusy !== null}
                      className="h-8 w-80"
                      placeholder="Select data to clear…"
                      options={CLEAR_DATA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
                    />
                    <CronButton label="Preview" busy={resetBusy === "preview"} disabled={!resetCategories.length || resetBusy !== null} onClick={handleResetPreview} />
                    <CronButton label="Clear selected" busy={resetBusy === "clear"} disabled={!resetCategories.length || resetBusy !== null} onClick={handleResetClear} />
                  </div>
                  {resetResult && (
                    <div className="space-y-1 rounded-sm border border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
                      {resetResult.results.map((r) => (
                        <div key={r.category}>
                          <span className="font-medium text-foreground">{resetLabel(r.category)}</span>:{" "}
                          {resetResult.dry_run
                            ? `${r.count ?? 0} row(s) would be cleared`
                            : `cleared ${r.deleted ?? 0}${r.blocked ? ` · ${r.blocked} skipped (still referenced)` : ""}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {tab === "debug" && debugSubTab === "messages" && hasDebugTool("message_log") && debugPanelsShown && (
              <section className="border-b border-border px-4 py-3">
                <div className="mb-2">
                  <h3 className="text-xs font-semibold">Message formats</h3>
                  <p className="text-2xs text-muted-foreground">
                    Customize a message template for this company. Leave the body empty to use the built-in default;
                    tap a {"{{placeholder}}"} chip to insert that message&rsquo;s fields. Saved formats apply to real sends.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CronButton label={templates ? "Reload" : "Load templates"} busy={tplBusy} disabled={tplBusy} onClick={loadTemplates} />
                  {templates && (
                    <InlineSelect
                      value={tplKey}
                      onChange={(value) => selectTemplate(value)}
                      className="h-8 w-80"
                      options={templates.map((t) => ({ value: t.key, label: `${t.label}${t.override_body ? " • customized" : ""}` }))}
                    />
                  )}
                </div>
                {selectedTpl && (
                  <div className="mt-3 space-y-2">
                    {selectedTpl.placeholders.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedTpl.placeholders.map((p) => (
                          <button key={p} type="button" title="Insert placeholder" onClick={() => setTplBody((b) => `${b}{{${p}}}`)} className="pill bg-muted font-mono text-muted-foreground hover:bg-muted/70">{`{{${p}}}`}</button>
                        ))}
                      </div>
                    )}
                    <div>
                      <p className="text-2xs text-muted-foreground">Built-in default{selectedTpl.has_sample ? " (from a recent message)" : " (no example message yet)"}:</p>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">{stripHtml(selectedTpl.default_body) || "(nothing to preview yet)"}</pre>
                    </div>
                    {selectedTpl.channel === "email" && (
                      <label className="block text-xs">
                        <span className="mb-1 block text-muted-foreground">Subject (email)</span>
                        <input value={tplSubject} onChange={(event) => setTplSubject(event.target.value)} disabled={tplBusy} placeholder="Leave blank for the default subject" className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65" />
                      </label>
                    )}
                    <label className="block text-xs">
                      <span className="mb-1 block text-muted-foreground">Custom body (empty = use the default)</span>
                      <textarea value={tplBody} onChange={(event) => setTplBody(event.target.value)} disabled={tplBusy} rows={5} placeholder="Type a custom message using {{placeholders}}" className="w-full rounded-sm border border-input bg-background px-2 py-1 text-xs disabled:opacity-65" />
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={saveTemplate} disabled={tplBusy || !tplBody.trim()} className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Save format</button>
                      <button type="button" onClick={resetTemplate} disabled={tplBusy || !selectedTpl.override_body} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-50">Reset to default</button>
                      {tplNotice && <span className="text-2xs text-success">{tplNotice}</span>}
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === "debug" && debugSubTab === "messages" && hasDebugTool("message_log") && debugPanelsShown && (
              <section className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:gap-4">
                <div className="sm:w-40 sm:shrink-0">
                  <p className="text-xs font-medium text-foreground">Message log</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">Every message sent/queued, grouped by contact &mdash; the exact SMS/email body, status, and time. Newest first; latest 300.</p>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <CronButton label={messageLog ? "Reload" : "Load message log"} busy={messageBusy} disabled={messageBusy} onClick={handleLoadMessageLog} />
                    {messageLog && (
                      <span className="text-2xs text-muted-foreground">
                        {messageLog.length} message{messageLog.length === 1 ? "" : "s"} · {messageGroups.length} contact{messageGroups.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {messageLog && messageLog.length === 0 && (
                    <div className="text-2xs text-muted-foreground">No messages logged yet.</div>
                  )}
                  {messageGroups.map((group) => {
                    const groupKey = group.recipient || group.name;
                    const collapsed = collapsedGroups.has(groupKey);
                    return (
                    <div key={groupKey} className="rounded-sm border border-border">
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupKey)}
                        className={`flex w-full items-center justify-between bg-muted/40 px-3 py-1.5 text-left hover:bg-muted/60 ${collapsed ? "" : "border-b border-border"}`}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          {group.name}
                          {group.role ? <span className="text-2xs font-normal text-muted-foreground">({group.role})</span> : null}
                        </span>
                        <span className="font-mono text-2xs text-muted-foreground">{group.items.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="divide-y divide-border">
                          {group.items.map((m) => (
                            <div key={m.id} className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2 text-2xs">
                                <span className="pill bg-muted text-muted-foreground">{m.channel}</span>
                                <span className={`pill ${m.status === "sent" ? "bg-success/10 text-success" : m.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-warning"}`}>{m.status}</span>
                                <span className="font-mono text-muted-foreground">{m.template_key}</span>
                                <span className="ml-auto text-muted-foreground">{formatWhen(m.sent_at ?? m.scheduled_for)}</span>
                              </div>
                              {m.subject && <div className="mt-1 text-2xs font-medium text-foreground">{m.subject}</div>}
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">{stripHtml(m.body)}</pre>
                              {m.last_error && <div className="mt-1 text-2xs text-destructive">error: {m.last_error}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </section>
            )}
            {tab === "debug" && debugSubTab === "forms" && hasDebugTool("forms_preview") && debugPanelsShown && (
              <section className="border-b border-border px-4 py-3">
                <div className="mb-2">
                  <h3 className="text-xs font-semibold">Forms</h3>
                  <p className="text-2xs text-muted-foreground">
                    Open a live test copy of a token-gated form. Each mints a single-use token bound to a hidden
                    <strong> ghost job</strong> (auto-created; crew forms also use a ghost crew contact), so submitting a
                    test form writes to the ghost, never a real job. Opens in a new tab; the token expires in 1 hour.
                  </p>
                </div>
                {formError && <div className="mb-2 text-2xs text-destructive">{formError}</div>}
                <div className="divide-y divide-border rounded-sm border border-border">
                  {DEBUG_FORMS.map((f) => (
                    <div key={f.form} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">{f.label}</div>
                        <div className="text-2xs text-muted-foreground">{f.note}</div>
                      </div>
                      <button type="button" onClick={() => openTestForm(f.form)} disabled={formBusy !== null} className="inline-flex h-8 shrink-0 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted disabled:opacity-50">
                        {formBusy === f.form ? "Opening..." : "Open test copy"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!canManage && (
              <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">View-only role.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Local timestamp for the message log; falls back to the raw value if unparseable.
function formatWhen(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

// Email bodies are simple HTML; flatten to readable text for the debug log (SMS passes through).
function stripHtml(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
          <table className="ops-grid w-full text-2xs">
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
          <table className="ops-grid w-full text-2xs">
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

// One tab sub-group: a small header, then its fields stacked in a single column (no
// side-by-side branching), width-constrained so inputs stay readable.
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid max-w-xl gap-3 px-4 py-4">{children}</div>
    </section>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-t-sm border border-b-0 border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground"
          : "rounded-t-sm border border-transparent px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`pill ${ok ? "bg-success/10 text-success" : "bg-warning/20 text-warning"}`}>
      {label} {ok ? "✓" : "•"}
    </span>
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

