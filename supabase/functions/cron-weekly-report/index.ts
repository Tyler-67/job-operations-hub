/* eslint-disable @typescript-eslint/no-explicit-any */
// Weekly cron. For each company whose LOCAL clock now matches its weekly_report_time hour AND
// whose local weekday equals weekly_report_day (ISO Mon=1..Sun=7), assemble the week's snapshot
// (active jobs by phase, completed this week, stalled jobs, totals), store it in weekly_reports,
// and enqueue an owner email digest. We don't call Uptiq here: the email row goes into
// scheduled_notifications and the drain cron sends it, so the Uptiq dependency + retries live in
// one place. The weekly_reports upsert + per-period email dedupe make a double-fire idempotent.
//
// Server time is UTC, so the company's local hour/weekday/date are resolved from
// locations.timezone via Intl.DateTimeFormat — never the raw Date.
import { json, preflight, requireCronSecret, serviceClient, logEvent } from "../_shared/util.ts";
import { localContext, sendHourOf } from "../_shared/check-in-schedule.ts";
import { weeklyReportPeriod, generateWeeklyReport } from "../_shared/weekly-report.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const guard = requireCronSecret(req); if (guard) return guard;

  // Testing: ?force=1 (Settings "run cron" button) fires now, ignoring the local day/hour gate.
  const force = new URL(req.url).searchParams.get("force") === "1";

  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "").trim() || undefined;
  const sb = serviceClient();
  const now = new Date();

  const { data: companies, error: cErr } = await sb
    .from("company_settings")
    .select("location_id, weekly_report_day, weekly_report_time, owner_contact_id, locations(company_name, timezone)");
  if (cErr) return json({ error: cErr.message }, 500);

  let companiesFired = 0, generated = 0;

  for (const company of companies ?? []) {
    const loc = company.location_id as string;
    const location = (company.locations ?? {}) as { company_name?: string; timezone?: string };
    const tz = (location.timezone ?? "").trim() || "America/Chicago";

    const sendHour = sendHourOf(company.weekly_report_time);
    if (sendHour === null && !force) continue;
    const { hour, weekday, date } = localContext(tz, now);
    if (!force && hour !== sendHour) continue;
    if (!force && Number(company.weekly_report_day) !== weekday) continue;
    companiesFired++;

    const { periodStart, periodEnd } = weeklyReportPeriod(date);
    await generateWeeklyReport(sb, {
      locationId: loc,
      periodStart,
      periodEnd,
      now,
      ownerContactId: (company.owner_contact_id as string | null) ?? null,
      appBaseUrl,
      companyName: location.company_name ?? "",
    });
    generated++;
  }

  await logEvent({ source: "cron", kind: "cron.weekly_report.tick", payload: { companiesFired, generated } });
  return json({ ok: true, companiesFired, generated });
});
