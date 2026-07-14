/* eslint-disable @typescript-eslint/no-explicit-any */
// Hourly cron. For each company whose LOCAL clock now matches its inspection_reminder_time
// hour, nudge the owner about each active job sitting in an inspection phase:
//   • no inspection_date yet  → SMS the owner a single-use "set the date" link (re-sent
//                               daily until they pick one).
//   • inspection_date is today → SMS the owner the day-of PASS/FAIL ask: two single-use
//                               decision links the action-decision spine consumes.
// We don't call Uptiq here — we enqueue SMS rows into scheduled_notifications and let the
// drain cron send, so retries + the Uptiq dependency live in exactly one place. Inspection
// phases are found via the job_states.is_inspection flag (data-driven, no hardcoded ids).
// Server time is UTC, so the local hour/date come from locations.timezone via Intl.
import { json, preflight, requireCronSecret, serviceClient, logEvent } from "../_shared/util.ts";
import { mintActionToken, buildActionLink } from "../_shared/action-tokens.ts";
import { localContext, sendHourOf } from "../_shared/check-in-schedule.ts";

const INSPECTION_DATE_ACTION = "inspection_date";
const INSPECTION_DATE_PATH = "/forms/inspection-date";
const DECISION_PATH = "/action/decision";

function isDuplicate(error: unknown): boolean {
  return String((error as { message?: unknown })?.message ?? error).toLowerCase().includes("duplicate");
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;

  // Testing: ?force=1 (Settings "run cron" button) fires now, ignoring the local reminder-hour gate.
  const force = new URL(req.url).searchParams.get("force") === "1";

  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim();
  if (!appBaseUrl) {
    await logEvent({ source: "cron", kind: "cron.inspection_reminders.misconfigured", payload: { reason: "APP_BASE_URL_unset" } });
    return json({ error: "APP_BASE_URL_unset" }, 500);
  }

  const sb = serviceClient();
  const now = new Date();

  const { data: companies, error: cErr } = await sb
    .from("company_settings")
    .select("location_id, owner_contact_id, office_contact_id, inspection_reminder_time, locations(timezone)");
  if (cErr) return json({ error: cErr.message }, 500);

  // Inspection-phase state ids, flagged in the configurable state set.
  const { data: states, error: sErr } = await sb.from("job_states").select("id, is_inspection");
  if (sErr) return json({ error: sErr.message }, 500);
  const inspectionStateIds = new Set<string>();
  for (const st of states ?? []) if (st.is_inspection) inspectionStateIds.add(st.id as string);

  let dateNudges = 0, resultAsks = 0, skipped = 0, companiesFired = 0;

  for (const company of companies ?? []) {
    const loc = company.location_id as string;
    const location = (company.locations ?? {}) as { timezone?: string };
    const tz = (location.timezone ?? "").trim() || "America/Chicago";

    const reminderHour = sendHourOf(company.inspection_reminder_time);
    if (reminderHour === null && !force) continue;
    const { hour, date } = localContext(tz, now);
    if (!force && hour !== reminderHour) continue;
    companiesFired++;

    const ownerContactId = (company.owner_contact_id as string | null)?.trim() || "";
    if (!ownerContactId) { skipped++; continue; } // no owner contact configured — nobody to nudge
    // Optional office copy (v1 Test 5): same reminder, no action link — the office can't enter the date.
    const officeContactId = (company.office_contact_id as string | null)?.trim() || "";

    const { data: jobs } = await sb
      .from("jobs")
      .select("id, address, current_state_id, inspection_date")
      .eq("location_id", loc).eq("active", true);
    const eligible = (jobs ?? []).filter((j: any) => inspectionStateIds.has(j.current_state_id));

    for (const job of eligible) {
      // Treat inspection_date as the literal calendar day it was entered as (the stored
      // midnight-UTC timestamp's date portion), so the today-check never drifts by zone.
      const inspectionDate = job.inspection_date ? String(job.inspection_date).slice(0, 10) : null;

      if (!inspectionDate) {
        // Branch A: the owner still needs to pick a date.
        const minted = await mintActionToken(sb, {
          action: INSPECTION_DATE_ACTION, jobId: job.id, contactId: null,
          payload: { address: job.address ?? null },
        });
        const link = buildActionLink(appBaseUrl, INSPECTION_DATE_PATH, minted.token);
        const { error } = await sb.from("scheduled_notifications").insert({
          location_id: loc, job_id: job.id, channel: "sms", recipient: ownerContactId,
          template_key: "inspection_date_link",
          payload: { link, address: job.address ?? null },
          scheduled_for: new Date().toISOString(),
          // Forced testing runs skip dedupe so no contact is skipped on repeat clicks.
          dedupe_key: force ? null : `notif:insp_date:${job.id}:${date}`,
        });
        if (error) { if (isDuplicate(error)) { skipped++; continue; } throw error; }
        dateNudges++;
        if (officeContactId) {
          const { error: oErr } = await sb.from("scheduled_notifications").insert({
            location_id: loc, job_id: job.id, channel: "sms", recipient: officeContactId,
            template_key: "inspection_reminder_office_notice",
            payload: { phase: "date", address: job.address ?? null },
            scheduled_for: new Date().toISOString(),
            dedupe_key: force ? null : `notif:insp_date_office:${job.id}:${date}`,
          });
          if (oErr && !isDuplicate(oErr)) throw oErr;
        }
      } else if (inspectionDate === date) {
        // Branch B: inspection day → ask the owner for the result. One ask per inspection date.
        const pass = await mintActionToken(sb, { action: "inspection_pass", jobId: job.id, contactId: null, payload: { address: job.address ?? null } });
        const fail = await mintActionToken(sb, { action: "inspection_fail", jobId: job.id, contactId: null, payload: { address: job.address ?? null } });
        const { error } = await sb.from("scheduled_notifications").insert({
          location_id: loc, job_id: job.id, channel: "sms", recipient: ownerContactId,
          template_key: "inspection_result_ask",
          payload: {
            address: job.address ?? null,
            pass_link: buildActionLink(appBaseUrl, DECISION_PATH, pass.token),
            fail_link: buildActionLink(appBaseUrl, DECISION_PATH, fail.token),
          },
          scheduled_for: new Date().toISOString(),
          dedupe_key: force ? null : `notif:insp_result:${job.id}:${inspectionDate}`,
        });
        if (error) { if (isDuplicate(error)) { skipped++; continue; } throw error; }
        resultAsks++;
        if (officeContactId) {
          const { error: oErr } = await sb.from("scheduled_notifications").insert({
            location_id: loc, job_id: job.id, channel: "sms", recipient: officeContactId,
            template_key: "inspection_reminder_office_notice",
            payload: { phase: "result", address: job.address ?? null },
            scheduled_for: new Date().toISOString(),
            dedupe_key: force ? null : `notif:insp_result_office:${job.id}:${inspectionDate}`,
          });
          if (oErr && !isDuplicate(oErr)) throw oErr;
        }
      }
    }
  }

  await logEvent({ source: "cron", kind: "cron.inspection_reminders.tick", payload: { companiesFired, dateNudges, resultAsks, skipped } });
  return json({ ok: true, companiesFired, dateNudges, resultAsks, skipped });
});
