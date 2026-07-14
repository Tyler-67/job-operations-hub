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
  pullCrew,
  runCron,
  saveSettings,
  syncContacts,
  timeForInput,
  type ContactsSyncResult,
  type CrewPullResult,
  type CronKey,
  type CompanySettings,
  type SettingsLocation,
  type SettingsResponse,
} from "@/lib/settings";
import { useSession } from "@/lib/session";
import { InlineSelect, type SelectOption } from "@/components/InlineSelect";
import { useConfirm } from "@/components/dialogs";

interface SettingsForm {
  company_name: string;
  timezone: string;
  uptiq_company_id: string;
  owner_name: string;
  owner_contact_id: string;
  owner_phone: string;
  owner_email: string;
  office_contact_id: string;
  office_phone: string;
  office_email: string;
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
    owner_name: "",
    owner_contact_id: "",
    owner_phone: "",
    owner_email: "",
    office_contact_id: "",
    office_phone: "",
    office_email: "",
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
    owner_name: settings.owner_name ?? "",
    owner_contact_id: settings.owner_contact_id ?? "",
    owner_phone: settings.owner_phone ?? "",
    owner_email: settings.owner_email ?? "",
    office_contact_id: settings.office_contact_id ?? "",
    office_phone: settings.office_phone ?? "",
    office_email: settings.office_email ?? "",
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
  const [cronBusy, setCronBusy] = useState<CronKey | null>(null);
  const [cronResult, setCronResult] = useState<string | null>(null);
  const [contactsBusy, setContactsBusy] = useState<"preview" | "sync" | null>(null);
  const [contactsResult, setContactsResult] = useState<ContactsSyncResult | null>(null);
  const [crewBusy, setCrewBusy] = useState<"preview" | "pull" | null>(null);
  const [crewResult, setCrewResult] = useState<CrewPullResult | null>(null);

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

  const supplyHouses = useMemo(() => data?.supply_houses ?? [], [data?.supply_houses]);
  const weekdayLabel = WEEKDAYS.filter((day) => form.check_in_weekdays.includes(day.value)).map((day) => day.label).join(", ");
  const officeReady = Boolean(form.office_email.trim() || form.office_phone.trim());
  const ownerReady = Boolean(form.owner_email.trim() || form.owner_phone.trim());
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
          owner_name: nullable(form.owner_name),
          owner_contact_id: nullable(form.owner_contact_id),
          owner_phone: nullable(form.owner_phone),
          owner_email: nullable(form.owner_email),
          office_contact_id: nullable(form.office_contact_id),
          office_phone: nullable(form.office_phone),
          office_email: nullable(form.office_email),
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

  async function handleRunCron(cron: CronKey, label: string) {
    if (!(await confirm({
      title: `Run “${label}” now?`,
      body: "This fires the cron immediately (ignoring its send-time) and sends real messages via Uptiq to the configured contacts. Use for testing only.",
      confirmLabel: "Run now",
    }))) return;
    setCronBusy(cron);
    setCronResult(null);
    setError(null);
    try {
      const res = await runCron(cron);
      const drainMsg = res.drain ? ` · sent: ${JSON.stringify(res.drain.result)}` : "";
      setCronResult(`${label}: ${res.ok ? "OK" : `error ${res.status}`} — ${JSON.stringify(res.result)}${drainMsg}`);
    } catch (err) {
      setCronResult(`${label}: ${err instanceof Error ? err.message : "failed"}`);
    } finally {
      setCronBusy(null);
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

  async function handlePullCrew(dryRun: boolean) {
    if (!dryRun && !(await confirm({
      title: "Pull crew from Uptiq now?",
      body: "Imports every Uptiq contact tagged “crew” as a crew contact in Daily Burn (created or updated, matched by Uptiq id). Read-only in Uptiq; it only adds/updates crew here and never removes anyone.",
      confirmLabel: "Pull crew",
    }))) return;
    setCrewBusy(dryRun ? "preview" : "pull");
    setCrewResult(null);
    setError(null);
    try {
      setCrewResult(await pullCrew({ dryRun }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crew pull failed");
    } finally {
      setCrewBusy(null);
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
              <TextField label="Owner name" value={form.owner_name} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_name: value })} />
              <TextField label="Owner phone" value={form.owner_phone} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_phone: value })} />
              <TextField label="Owner email" type="email" value={form.owner_email} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_email: value })} />
              <TextField label="Owner contact ID" value={form.owner_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ owner_contact_id: value })} />
              <TextField label="Office phone" value={form.office_phone} disabled={!canManage || saving} onChange={(value) => updateForm({ office_phone: value })} />
              <TextField label="Office email" type="email" value={form.office_email} disabled={!canManage || saving} onChange={(value) => updateForm({ office_email: value })} />
              <TextField label="Office contact ID" value={form.office_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ office_contact_id: value })} />
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

            {canSyncContacts && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Uptiq Contacts</div>
                <div className="space-y-5 px-4 py-4">
                  <div className="space-y-3">
                    <p className="text-xs font-medium">Pull crew from Uptiq <span className="text-muted-foreground">(tag: crew)</span></p>
                    <p className="text-xs text-muted-foreground">
                      Imports every Uptiq contact tagged <strong>crew</strong> as a crew contact in Daily Burn
                      (created or updated, matched by Uptiq id). <strong>Read-only in Uptiq</strong> &mdash; only adds/updates
                      crew here; never removes anyone.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <CronButton label="Preview (dry run)" busy={crewBusy === "preview"} disabled={crewBusy !== null} onClick={() => handlePullCrew(true)} />
                      <CronButton label="Pull crew from Uptiq" busy={crewBusy === "pull"} disabled={crewBusy !== null} onClick={() => handlePullCrew(false)} />
                    </div>
                    {crewResult && <CrewPullSummary result={crewResult} />}
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

            {canManage && form.debug_mode && (
              <section className="border-b border-border">
                <div className="border-b border-border bg-muted/60 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">Testing Tools</div>
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted-foreground">
                    Fire a scheduled job now, ignoring its configured send time. <strong>Sends real SMS/email</strong> via
                    Uptiq to the configured contacts &mdash; for testing. Send check-ins / Inspection reminders / Weekly report
                    now <strong>queue and drain in one press</strong>, so messages go out immediately. <strong>Drain queue</strong>
                    re-sends anything still pending (also runs on its own every ~15 min).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <CronButton label="Send check-ins" busy={cronBusy === "check-ins"} disabled={cronBusy !== null} onClick={() => handleRunCron("check-ins", "Send check-ins")} />
                    <CronButton label="Inspection reminders" busy={cronBusy === "inspection-reminders"} disabled={cronBusy !== null} onClick={() => handleRunCron("inspection-reminders", "Inspection reminders")} />
                    <CronButton label="Weekly report" busy={cronBusy === "weekly-report"} disabled={cronBusy !== null} onClick={() => handleRunCron("weekly-report", "Weekly report")} />
                    <CronButton label="Drain queue" busy={cronBusy === "drain"} disabled={cronBusy !== null} onClick={() => handleRunCron("drain", "Drain queue")} />
                  </div>
                  {cronResult && (
                    <div className="break-all rounded-sm border border-border bg-muted/40 px-3 py-2 font-mono text-2xs text-muted-foreground">{cronResult}</div>
                  )}
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

function CrewPullSummary({ result }: { result: CrewPullResult }) {
  const summary = result.dry_run
    ? `Found ${result.found} Uptiq contact${result.found === 1 ? "" : "s"} tagged "${result.tag}" (scanned ${result.scanned ?? 0}${result.capped ? ", page cap hit" : ""}).`
    : `Imported ${result.imported ?? 0} · Updated ${result.updated ?? 0} · Skipped ${result.skipped ?? 0} (of ${result.found} tagged "${result.tag}").`;
  const rows = result.dry_run
    ? (result.contacts ?? []).map((c) => ({ label: c.name || "(unnamed)", note: c.email || c.phone || c.id }))
    : (result.results ?? []).map((r) => ({ label: r.name || "(unnamed)", note: r.action + (r.error ? `: ${r.error}` : "") }));
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{summary}</div>
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
