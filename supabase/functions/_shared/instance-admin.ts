// Developer-console instance administration: create / update / delete instances (tenants)
// and assemble the ops overview. dev_super-only surface — the dev-console function gates
// every call on the FRESH role before touching any of this. The client is injected and
// loosely typed (like app-user.ts) so the pure pieces run under vitest.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface InstanceInput {
  company_name: string;
  timezone: string;
  uptiq_location_id: string;
  app_base_url: string | null;
  uptiq_sync_location_id: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Pure validation -> normalized input or an error code. The binding (uptiq_location_id) is
// the UNIQUE iframe/webhook join key: real GHL location ids for real companies, or any
// distinct synthetic slug (e.g. DEV-INTERNAL-2) for internal sandboxes.
export function validateInstanceInput(
  body: Record<string, unknown>,
): { ok: true; value: InstanceInput } | { ok: false; error: string } {
  const company = text(body.company_name);
  if (!company) return { ok: false, error: "company_name_required" };
  if (company.length > 80) return { ok: false, error: "company_name_too_long" };

  const binding = text(body.uptiq_location_id);
  if (!binding) return { ok: false, error: "uptiq_location_id_required" };
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(binding)) return { ok: false, error: "uptiq_location_id_invalid" };

  const timezone = text(body.timezone) || "America/Chicago";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { ok: false, error: "timezone_invalid" };
  }

  const url = text(body.app_base_url);
  if (url && !/^https:\/\/\S+$/i.test(url)) return { ok: false, error: "app_base_url_invalid" };

  return {
    ok: true,
    value: {
      company_name: company,
      timezone,
      uptiq_location_id: binding,
      app_base_url: url ? url.replace(/\/+$/, "") : null,
      uptiq_sync_location_id: text(body.uptiq_sync_location_id) || null,
    },
  };
}

// Create a tenant: locations row + company_settings + a state machine cloned from another
// instance's DEFAULT set (ids remapped through slugs — same recipe as migration
// 20260722190000, so the new instance always matches current live behavior).
export async function createInstance(sb: any, input: InstanceInput, cloneFromLocationId: string | null) {
  const { data: existing } = await sb
    .from("locations").select("id").eq("uptiq_location_id", input.uptiq_location_id).maybeSingle();
  if (existing) throw new Error("binding_in_use");

  const { data: loc, error: locErr } = await sb.from("locations").insert({
    company_name: input.company_name,
    timezone: input.timezone,
    uptiq_location_id: input.uptiq_location_id,
    app_base_url: input.app_base_url,
    uptiq_sync_location_id: input.uptiq_sync_location_id,
  }).select("id").single();
  if (locErr) throw locErr;
  const newLocId = loc.id as string;

  const { error: csErr } = await sb.from("company_settings")
    .insert({ location_id: newLocId, supply_house_pickup_time: "7AM", debug_mode: true });
  if (csErr) throw csErr;

  if (cloneFromLocationId) {
    const { data: srcSet } = await sb.from("job_state_sets")
      .select("id, name").eq("location_id", cloneFromLocationId).eq("is_default", true).limit(1).maybeSingle();
    if (srcSet) {
      const { data: newSet, error: setErr } = await sb.from("job_state_sets")
        .insert({ location_id: newLocId, name: srcSet.name, is_default: true }).select("id").single();
      if (setErr) throw setErr;

      const { data: srcStates } = await sb.from("job_states")
        .select("id, slug, label, sort_order, color, is_terminal, is_inspection, is_walkthrough, is_billing, allow_check_ins, active")
        .eq("state_set_id", srcSet.id);
      const idBySlug = new Map<string, string>();
      for (const st of srcStates ?? []) {
        const { data: inserted, error: stErr } = await sb.from("job_states").insert({
          state_set_id: newSet.id, slug: st.slug, label: st.label, sort_order: st.sort_order,
          color: st.color, is_terminal: st.is_terminal, is_inspection: st.is_inspection,
          is_walkthrough: st.is_walkthrough, is_billing: st.is_billing,
          allow_check_ins: st.allow_check_ins, active: st.active,
        }).select("id").single();
        if (stErr) throw stErr;
        idBySlug.set(st.slug as string, inserted.id as string);
      }

      const { data: srcTransitions } = await sb.from("job_state_transitions")
        .select("from_state_id, to_state_id, trigger, conditions").eq("state_set_id", srcSet.id);
      const slugById = new Map<string, string>();
      for (const st of srcStates ?? []) slugById.set(st.id as string, st.slug as string);
      for (const tr of srcTransitions ?? []) {
        const fromId = idBySlug.get(slugById.get(tr.from_state_id as string) ?? "");
        const toId = idBySlug.get(slugById.get(tr.to_state_id as string) ?? "");
        if (!fromId || !toId) continue;
        const { error: trErr } = await sb.from("job_state_transitions").insert({
          state_set_id: newSet.id, from_state_id: fromId, to_state_id: toId,
          trigger: tr.trigger, conditions: tr.conditions ?? {},
        });
        if (trErr) throw trErr;
      }
    }
  }

  return newLocId;
}

const PATCHABLE = ["company_name", "timezone", "app_base_url", "uptiq_sync_location_id", "uptiq_location_id"] as const;

// Update instance-level fields (the ones with no other UI). Binding changes re-check
// uniqueness; nullable fields treat "" as null.
export async function updateInstance(sb: any, locationId: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE) {
    if (!(key in body)) continue;
    const value = text((body as Record<string, unknown>)[key]);
    if (key === "company_name") {
      if (!value) throw new Error("company_name_required");
      patch[key] = value;
    } else if (key === "timezone") {
      if (!value) throw new Error("timezone_invalid");
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }); } catch { throw new Error("timezone_invalid"); }
      patch[key] = value;
    } else if (key === "uptiq_location_id") {
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(value)) throw new Error("uptiq_location_id_invalid");
      const { data: clash } = await sb.from("locations")
        .select("id").eq("uptiq_location_id", value).neq("id", locationId).maybeSingle();
      if (clash) throw new Error("binding_in_use");
      patch[key] = value;
    } else if (key === "app_base_url") {
      if (value && !/^https:\/\/\S+$/i.test(value)) throw new Error("app_base_url_invalid");
      patch[key] = value ? value.replace(/\/+$/, "") : null;
    } else {
      patch[key] = value || null;
    }
  }
  if (!Object.keys(patch).length) return;
  const { error } = await sb.from("locations").update(patch).eq("id", locationId);
  if (error) throw error;
}

// Delete an instance — ONLY when it's an empty shell (no users, jobs, or contacts), and
// never the one the caller is standing in. The FK graph cascades settings/state sets/logs.
export async function deleteInstance(sb: any, locationId: string, callerLocationId: string) {
  if (locationId === callerLocationId) throw new Error("cannot_delete_current");
  const counts = await Promise.all(["app_users", "jobs", "contacts"].map(async (table) => {
    const { count } = await sb.from(table).select("id", { count: "exact", head: true }).eq("location_id", locationId);
    return count ?? 0;
  }));
  if (counts.some((c) => c > 0)) throw new Error("instance_not_empty");
  const { error } = await sb.from("locations").delete().eq("id", locationId);
  if (error) throw error;
}

// The ops overview: every instance with its vital counts + the global cron heartbeats.
export async function instanceOverview(sb: any) {
  const { data: locations } = await sb
    .from("locations")
    .select("id, company_name, timezone, uptiq_location_id, uptiq_sync_location_id, app_base_url, created_at")
    .order("created_at");

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const countWhere = async (table: string, build: (q: any) => any) => {
    const { count } = await build(sb.from(table).select("id", { count: "exact", head: true }));
    return count ?? 0;
  };

  const instances = await Promise.all((locations ?? []).map(async (loc: any) => {
    const [users, contacts, jobsActive, jobsTotal, notifPending, notifFailed, sent24h] = await Promise.all([
      countWhere("app_users", (q) => q.eq("location_id", loc.id).eq("active", true)),
      countWhere("contacts", (q) => q.eq("location_id", loc.id)),
      countWhere("jobs", (q) => q.eq("location_id", loc.id).eq("active", true)),
      countWhere("jobs", (q) => q.eq("location_id", loc.id)),
      countWhere("scheduled_notifications", (q) => q.eq("location_id", loc.id).eq("status", "pending")),
      countWhere("scheduled_notifications", (q) => q.eq("location_id", loc.id).eq("status", "failed")),
      countWhere("scheduled_notifications", (q) => q.eq("location_id", loc.id).eq("status", "sent").gte("sent_at", dayAgo)),
    ]);
    return {
      ...loc,
      metrics: {
        users_active: users, contacts, jobs_active: jobsActive, jobs_total: jobsTotal,
        notif_pending: notifPending, notif_failed: notifFailed, sent_24h: sent24h,
      },
    };
  }));

  const tickKinds: Record<string, string> = {
    check_ins: "cron.check_ins.tick",
    drain: "cron.drain_notifications.tick",
    inspection_reminders: "cron.inspection_reminders.tick",
    weekly_report: "cron.weekly_report.tick",
  };
  const crons: Record<string, string | null> = {};
  await Promise.all(Object.entries(tickKinds).map(async ([key, kind]) => {
    const { data } = await sb.from("event_log")
      .select("created_at").eq("kind", kind).order("created_at", { ascending: false }).limit(1);
    crons[key] = data?.[0]?.created_at ?? null;
  }));

  return { instances, crons };
}
