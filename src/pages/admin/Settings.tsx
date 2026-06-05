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
  saveSettings,
  timeForInput,
  type CompanySettings,
  type SettingsLocation,
  type SettingsResponse,
} from "@/lib/settings";
import { useSession } from "@/lib/session";

interface SettingsForm {
  company_name: string;
  timezone: string;
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
  daily_checkin_form_id: string;
  inspection_date_form_id: string;
  inspection_fix_form_id: string;
  walkthrough_punch_list_form_id: string;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_font: string;
  brand_logo_url: string;
}

function blankForm(): SettingsForm {
  return {
    company_name: "",
    timezone: "America/Boise",
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
    daily_checkin_form_id: "",
    inspection_date_form_id: "",
    inspection_fix_form_id: "",
    walkthrough_punch_list_form_id: "",
    brand_primary_color: "#0f172a",
    brand_secondary_color: "#0ea5e9",
    brand_font: "Inter",
    brand_logo_url: "",
  };
}

function toForm(location: SettingsLocation, settings: CompanySettings): SettingsForm {
  return {
    company_name: location.company_name,
    timezone: location.timezone,
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
    daily_checkin_form_id: settings.daily_checkin_form_id ?? "",
    inspection_date_form_id: settings.inspection_date_form_id ?? "",
    inspection_fix_form_id: settings.inspection_fix_form_id ?? "",
    walkthrough_punch_list_form_id: settings.walkthrough_punch_list_form_id ?? "",
    brand_primary_color: settings.brand_primary_color ?? "#0f172a",
    brand_secondary_color: settings.brand_secondary_color ?? "#0ea5e9",
    brand_font: settings.brand_font ?? "Inter",
    brand_logo_url: settings.brand_logo_url ?? "",
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
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>(blankForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSettings()
      .then((next) => {
        if (!active) return;
        setData(next);
        setForm(toForm(next.location, next.settings));
        setError(null);
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

  function updateForm(patch: Partial<SettingsForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleWeekday(value: number) {
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
    try {
      const next = await saveSettings({
        location: {
          company_name: form.company_name.trim(),
          timezone: form.timezone.trim(),
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
          daily_checkin_form_id: nullable(form.daily_checkin_form_id),
          inspection_date_form_id: nullable(form.inspection_date_form_id),
          inspection_fix_form_id: nullable(form.inspection_fix_form_id),
          walkthrough_punch_list_form_id: nullable(form.walkthrough_punch_list_form_id),
          brand_primary_color: form.brand_primary_color,
          brand_secondary_color: form.brand_secondary_color,
          brand_font: form.brand_font.trim(),
          brand_logo_url: nullable(form.brand_logo_url),
        },
      });
      setData(next);
      setForm(toForm(next.location, next.settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
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
      {loading && <div className="p-6 text-xs text-muted-foreground">Loading settings...</div>}

      {!loading && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
          <main className="overflow-auto">
            <SettingsSection title="Company">
              <TextField label="Company name" value={form.company_name} disabled={!canManage || saving} onChange={(value) => updateForm({ company_name: value })} />
              <SelectField label="Timezone" value={form.timezone} disabled={!canManage || saving} onChange={(value) => updateForm({ timezone: value })}>
                {COMMON_TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                {!COMMON_TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
              </SelectField>
            </SettingsSection>

            <SettingsSection title="Notification Timing">
              <TimeField label="Crew check-in send time" value={form.check_in_send_time} disabled={!canManage || saving} onChange={(value) => updateForm({ check_in_send_time: value })} />
              <WeekdayField values={form.check_in_weekdays} disabled={!canManage || saving} onToggle={toggleWeekday} />
              <TimeField label="Inspection reminder time" value={form.inspection_reminder_time} disabled={!canManage || saving} onChange={(value) => updateForm({ inspection_reminder_time: value })} />
              <SelectField label="Weekly report day" value={String(form.weekly_report_day)} disabled={!canManage || saving} onChange={(value) => updateForm({ weekly_report_day: Number(value) })}>
                {WEEKLY_REPORT_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
              </SelectField>
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
              <SelectField label="Default supply house" value={form.default_supply_house_contact_id} disabled={!canManage || saving} onChange={(value) => updateForm({ default_supply_house_contact_id: value })}>
                <option value="">None selected</option>
                {supplyHouses.map((supply) => <option key={supply.id} value={supply.id}>{supply.name}</option>)}
              </SelectField>
              <NumberField label="Parts cost ceiling" value={form.parts_cost_ceiling} disabled={!canManage || saving} onChange={(value) => updateForm({ parts_cost_ceiling: value })} min={0} step="0.01" />
              <TextField label="Supply pickup time" value={form.supply_house_pickup_time} disabled={!canManage || saving} onChange={(value) => updateForm({ supply_house_pickup_time: value })} />
            </SettingsSection>

            <SettingsSection title="Brand">
              <ColorField label="Primary color" value={form.brand_primary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_primary_color: value })} />
              <ColorField label="Secondary color" value={form.brand_secondary_color} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_secondary_color: value })} />
              <TextField label="Brand font" value={form.brand_font} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_font: value })} />
              <TextField label="Logo URL" value={form.brand_logo_url} disabled={!canManage || saving} onChange={(value) => updateForm({ brand_logo_url: value })} />
            </SettingsSection>

            <SettingsSection title="Uptiq IDs">
              <TextField label="Inspections calendar ID" value={form.inspections_calendar_id} disabled={!canManage || saving} onChange={(value) => updateForm({ inspections_calendar_id: value })} />
              <TextField label="Daily check-in form ID" value={form.daily_checkin_form_id} disabled={!canManage || saving} onChange={(value) => updateForm({ daily_checkin_form_id: value })} />
              <TextField label="Inspection date form ID" value={form.inspection_date_form_id} disabled={!canManage || saving} onChange={(value) => updateForm({ inspection_date_form_id: value })} />
              <TextField label="Inspection fix form ID" value={form.inspection_fix_form_id} disabled={!canManage || saving} onChange={(value) => updateForm({ inspection_fix_form_id: value })} />
              <TextField label="Walkthrough punch list form ID" value={form.walkthrough_punch_list_form_id} disabled={!canManage || saving} onChange={(value) => updateForm({ walkthrough_punch_list_form_id: value })} />
            </SettingsSection>
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

function SelectField({ label, value, disabled, onChange, children }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65">
        {children}
      </select>
    </label>
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
