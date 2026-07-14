/* eslint-disable @typescript-eslint/no-explicit-any */
// Hourly cron. For each company whose LOCAL clock now matches its check_in_send_time
// hour AND whose local weekday is in check_in_weekdays, send the day's check-in link to
// each active job's LEAD crew. The link is a single-use daily_check_in action token
// bound to (job, lead contact), carrying the branding + address + state label + supply
// houses the branded form needs. We don't call Uptiq here: we enqueue an SMS row into
// scheduled_notifications (dedupe per job+lead+local-date) and let the drain cron do the
// send, so retries and the Uptiq dependency live in exactly one place.
//
// Server time is UTC, so local hour/weekday/date are resolved from locations.timezone
// (an IANA zone) via Intl.DateTimeFormat — never the raw Date.
import { json, preflight, requireCronSecret, serviceClient, logEvent } from "../_shared/util.ts";
import { mintActionToken, buildActionLink } from "../_shared/action-tokens.ts";
import { localContext, sendHourOf } from "../_shared/check-in-schedule.ts";

const CHECK_IN_ACTION = "daily_check_in";
const CHECK_IN_FORM_PATH = "/forms/daily-check-in";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;

  // Testing: ?force=1 (from the Settings "run cron" button) fires every company now, ignoring
  // the local send-hour/weekday gate. The real pg_cron schedule never sets it, so cadence is unchanged.
  const force = new URL(req.url).searchParams.get("force") === "1";

  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
  if (!appBaseUrl) {
    // Without a base URL we can only build broken links — fail loud rather than send junk.
    await logEvent({ source: "cron", kind: "cron.check_ins.misconfigured", payload: { reason: "APP_BASE_URL_unset" } });
    return json({ error: "APP_BASE_URL_unset" }, 500);
  }

  const sb = serviceClient();
  const now = new Date();

  const { data: companies, error: cErr } = await sb
    .from("company_settings")
    .select("location_id, check_in_send_time, check_in_weekdays, brand_primary_color, brand_logo_url, default_supply_house_contact_id, locations(company_name, timezone)");
  if (cErr) return json({ error: cErr.message }, 500);

  // States that accept check-ins (id -> label). State ids are globally unique, so this
  // map doubles as both the eligibility filter and the phase label for the form.
  const { data: states, error: sErr } = await sb.from("job_states").select("id, label, allow_check_ins");
  if (sErr) return json({ error: sErr.message }, 500);
  const checkInStates = new Map<string, string>();
  for (const st of states ?? []) if (st.allow_check_ins) checkInStates.set(st.id as string, (st.label as string) ?? "");

  let enqueued = 0, skipped = 0, companiesFired = 0;

  for (const company of companies ?? []) {
    const loc = company.location_id as string;
    const location = (company.locations ?? {}) as { company_name?: string; timezone?: string };
    const tz = (location.timezone ?? "").trim() || "America/Chicago";

    const sendHour = sendHourOf(company.check_in_send_time);
    if (sendHour === null && !force) continue;
    const { hour, weekday, date } = localContext(tz, now);
    if (!force && hour !== sendHour) continue;
    const weekdays = Array.isArray(company.check_in_weekdays) ? company.check_in_weekdays.map(Number) : [];
    if (!force && !weekdays.includes(weekday)) continue;
    companiesFired++;

    // Supply houses + branding embedded in every token so the anon form never queries.
    const { data: houses } = await sb
      .from("supply_house_contacts").select("id, name")
      .eq("location_id", loc).eq("active", true).order("name", { ascending: true });
    const supplyHouses = (houses ?? []).map((h: any) => ({ id: h.id as string, name: (h.name as string) ?? "" }));
    const defaultSupplyHouseId = (company.default_supply_house_contact_id as string | null) ?? null;
    const branding = {
      company_name: location.company_name ?? "",
      primary_color: (company.brand_primary_color as string) ?? "#0f172a",
      logo_url: (company.brand_logo_url as string | null) ?? null,
    };

    // Active jobs currently in a check-in-eligible phase.
    const { data: jobs } = await sb.from("jobs")
      .select("id, address, current_state_id").eq("location_id", loc).eq("active", true);
    const eligibleJobs = (jobs ?? []).filter((j: any) => checkInStates.has(j.current_state_id));
    if (!eligibleJobs.length) continue;

    // Lead crew for those jobs, with the contact's Uptiq id (the SMS recipient) + uuid
    // (the token binding). is_lead only, per the configured recipient model.
    const { data: leads } = await sb.from("job_crew")
      .select("job_id, contacts(id, uptiq_contact_id)")
      .in("job_id", eligibleJobs.map((j: any) => j.id)).eq("is_lead", true);
    const leadsByJob = new Map<string, any[]>();
    for (const row of leads ?? []) {
      const arr = leadsByJob.get(row.job_id as string) ?? [];
      arr.push(row);
      leadsByJob.set(row.job_id as string, arr);
    }

    for (const job of eligibleJobs) {
      const stateLabel = checkInStates.get(job.current_state_id) ?? "";
      for (const lead of leadsByJob.get(job.id) ?? []) {
        const contact = (lead.contacts ?? {}) as { id?: string; uptiq_contact_id?: string | null };
        const contactId = contact.id ?? "";
        const uptiqId = (contact.uptiq_contact_id ?? "").trim();
        if (!contactId || !uptiqId) { skipped++; continue; }

        // Mint the link, then enqueue. A duplicate enqueue (e.g. the matching hour firing
        // twice) trips the unique dedupe_key and is skipped; the orphaned token simply
        // expires unused.
        const minted = await mintActionToken(sb, {
          action: CHECK_IN_ACTION,
          jobId: job.id,
          contactId,
          payload: {
            branding,
            address: job.address ?? null,
            state_label: stateLabel,
            supply_houses: supplyHouses,
            default_supply_house_id: defaultSupplyHouseId,
          },
        });
        const link = buildActionLink(appBaseUrl, CHECK_IN_FORM_PATH, minted.token);

        const { error: insErr } = await sb.from("scheduled_notifications").insert({
          location_id: loc,
          job_id: job.id,
          channel: "sms",
          recipient: uptiqId,
          template_key: "daily_check_in_link",
          payload: { link, company_name: branding.company_name, address: job.address ?? null },
          scheduled_for: new Date().toISOString(),
          dedupe_key: `notif:check_in_link:${job.id}:${contactId}:${date}`,
        });
        if (insErr) {
          if (String(insErr.message ?? insErr).toLowerCase().includes("duplicate")) { skipped++; continue; }
          throw insErr;
        }
        enqueued++;
      }
    }
  }

  await logEvent({ source: "cron", kind: "cron.check_ins.tick", payload: { companiesFired, enqueued, skipped } });
  return json({ ok: true, companiesFired, enqueued, skipped });
});
