// Pure, I/O-free rendering of scheduled_notifications into channel-ready messages. The
// drain cron pulls a due row, renders subject/body here from its template_key + payload,
// then sends via the Uptiq wrapper. No Deno or remote imports so the copy and formatting
// rules are unit-testable under vitest. Mirrors the v1 n8n message shapes.

export interface RenderedMessage {
  // null for SMS (no subject line); the email subject otherwise.
  subject: string | null;
  // Plain text for SMS; simple HTML for email.
  body: string;
}

export type NotificationPayload = Record<string, unknown>;

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value === null || value === undefined ? "" : String(value);
}

// Whole-dollar USD (e.g. 500 → "$500"); null when absent or not a finite number.
// Guards null/undefined/"" explicitly because Number() coerces those to 0.
function money(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderNotification(templateKey: string, payload: NotificationPayload): RenderedMessage {
  const address = str(payload.address);
  const pickup = str(payload.pickup_time);
  const parts = str(payload.parts_list) || "(no parts listed)";
  const poNumber = str(payload.po_number);
  const ceiling = money(payload.cost_ceiling);

  switch (templateKey) {
    // v1 node 140: warehouse email to the supply house.
    case "supply_house_parts_order": {
      const subject = `${address || "Job site"} - Parts for pickup${pickup ? ` ${pickup}` : ""}`;
      const lines = [
        poNumber ? `PO ${poNumber}` : "",
        address ? `Job: ${address}` : "",
        pickup ? `Pickup: ${pickup}` : "",
        "",
        "Parts:",
        parts,
      ].filter((line, i) => line !== "" || i === 3); // keep the single spacer line
      let html = lines.map(escapeHtml).join("<br>");
      if (ceiling) {
        html += `<br><br>Please do not exceed ${escapeHtml(ceiling)} without calling the owner first.`;
      }
      return { subject, body: html };
    }
    // v1 nodes 150/160: owner + office "parts ordered" SMS.
    case "supply_house_parts_ordered_notice": {
      const bits = [
        `Parts ordered${poNumber ? ` (PO ${poNumber})` : ""}${address ? ` for ${address}` : ""}.`,
        parts ? `Items: ${parts}.` : "",
        pickup ? `Pickup ${pickup}.` : "",
      ].filter(Boolean);
      return { subject: null, body: bits.join(" ") };
    }
    // Warehouse heads-up when a crew check-in reports parts were ALREADY ordered with the
    // supply house (the place_order twin above sends the formal PO email). Worded as a
    // confirmation, never a new order — the crew placed it themselves, so the counter
    // double-ordering it is the failure mode to avoid. No PO number exists yet: the office
    // values the pending PO afterward.
    case "supply_house_already_ordered_notice": {
      const subject = `${address || "Job site"} - Order confirmation check${pickup ? ` (pickup ${pickup})` : ""}`;
      const lines = [
        address ? `Job: ${address}` : "",
        pickup ? `Pickup: ${pickup}` : "",
        "",
        "Our crew reports they already placed an order with you for:",
        parts,
        "",
        "Heads-up only - please don't create a new order. If nothing is on file for this job, call the office.",
      ].filter((line, i) => line !== "" || i === 2 || i === 5); // keep the two spacer lines
      return { subject, body: lines.map(escapeHtml).join("<br>") };
    }
    // v1 Test 12: owner + office "field purchase" SMS. Fires when a crew check-in records
    // a field_purchase expense (crew paid out of pocket / on a card). Mirrors the v1 text:
    // who bought, where, and the receipt/parts photo links so the office can value it.
    case "field_purchase_notice": {
      const crew = str(payload.crew_name);
      const receipt = str(payload.receipt_url);
      const partsPhoto = str(payload.parts_photo_url);
      const bits = [
        `Field purchase${address ? ` at ${address}` : ""}${crew ? ` by ${crew}` : ""}.`,
        receipt ? `Receipt: ${receipt}` : "",
        partsPhoto ? `Parts: ${partsPhoto}` : "",
      ].filter(Boolean);
      return { subject: null, body: bits.join("\n") };
    }
    // The hourly check-in cron enqueues this as an SMS to the job's lead crew. The link
    // is a single-use, job+contact-bound daily_check_in action token built by the cron.
    case "daily_check_in_link": {
      const company = str(payload.company_name);
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      const lead = company ? `${company}: ` : "";
      return { subject: null, body: `${lead}Time for today's job check-in${where}.\nSubmit here: ${link}`.trim() };
    }
    // Reply the inbound-sms handler enqueues when a crew member texts LOG. The link is a
    // single-use, contact-bound quick_log token that opens the lightweight hours/progress
    // form. Sent via the same drain path as the check-in link.
    case "quick_log_link": {
      const company = str(payload.company_name);
      const link = str(payload.link);
      const lead = company ? `${company}: ` : "";
      return { subject: null, body: `${lead}Log today's hours and progress here: ${link}`.trim() };
    }
    // Reply when a texting crew member has no active job to log against.
    case "quick_log_no_job": {
      const company = str(payload.company_name);
      const lead = company ? `${company}: ` : "";
      return { subject: null, body: `${lead}We couldn't find an active job for you to log. Check with the office.`.trim() };
    }
    case "daily_check_in_summary": {
      const logDate = str(payload.log_date);
      const subject = `Daily check-in${logDate ? ` — ${logDate}` : ""}`;
      const body = escapeHtml(
        `A daily check-in was submitted${address ? ` for ${address}` : ""}${logDate ? ` on ${logDate}` : ""}.`,
      );
      return { subject, body };
    }
    // Immediate SMS to owner + office the moment a crew check-in marks a phase ready for
    // inspection. Closes the latency gap where nobody heard about an inspection request until
    // the next daily reminder cron. No action link — the owner still schedules the date via
    // the inspection_date_link the reminder cron sends; this just tells them it's coming.
    case "inspection_requested_notice": {
      const where = address ? ` at ${address}` : "";
      const phase = str(payload.phase_label);
      const body = phase
        ? `Crew marked the job${where} ready for the ${phase}. The owner will be asked to schedule the inspection date.`
        : `Crew marked the job${where} ready for inspection. The owner will be asked to schedule the inspection date.`;
      return { subject: null, body };
    }
    // The inspection-reminder cron enqueues this as an SMS to the owner when a job has
    // reached an inspection phase but has no date yet. The link is a single-use
    // inspection_date token that opens the branded date picker. Re-sent daily until set.
    case "inspection_date_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      // phase_label = the job's inspection-stage label ("Rough-In Inspection") so the owner
      // knows WHICH inspection they're scheduling; generic fallback for older queued rows.
      const phase = str(payload.phase_label) || "Inspection";
      return { subject: null, body: `${phase}${where} - pick the date:\n${link}`.trim() };
    }
    // The owner's "schedule the walkthrough" link — sent when a job is promoted into the
    // walkthrough state (and re-sent daily by the reminder cron until a date is picked,
    // and again on a RESCHEDULE tap). The walkthrough twin of inspection_date_link.
    case "walkthrough_date_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      return { subject: null, body: `Schedule the final walkthrough${where}:\n${link}`.trim() };
    }
    // Office copy of the inspection reminder (v1 Test 5): same nudge the owner gets, but
    // with NO action link — the office can't enter the date or the result. One template,
    // two phases: "date" (owner still owes a date) and "result" (it's inspection day).
    case "inspection_reminder_office_notice": {
      const where = address ? ` at ${address}` : "";
      const mode = str(payload.phase); // "date" | "result" — which reminder this is
      const phase = str(payload.phase_label); // the stage label ("Rough-In Inspection")
      const body = mode === "result"
        ? `Reminder: ${phase || "inspection"} is today${where}. Waiting on the owner for the PASS/FAIL result.`
        : `Reminder: a job${where} is awaiting a ${phase || "inspection"} date. The owner has been asked to set one.`;
      return { subject: null, body };
    }
    // Day-of-inspection SMS to the owner: two single-use decision links (PASS / FAIL),
    // each a token the action-decision spine consumes to advance or revert the job.
    case "inspection_result_ask": {
      const where = address ? ` at ${address}` : "";
      const pass = str(payload.pass_link);
      const fail = str(payload.fail_link);
      const phase = str(payload.phase_label) || "Inspection";
      return {
        subject: null,
        body: `${phase} result${where}?\n\nPASS: ${pass}\n\nFAIL: ${fail}`.trim(),
      };
    }
    // Sent to the owner after a FAILED inspection: a single-use link to the form where
    // the owner records what the inspector flagged. Minted by the decision spine on fail.
    case "inspection_fix_details_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      const phase = str(payload.phase_label) || "Inspection";
      return { subject: null, body: `${phase} failed${where}. Tell the crew what to fix:\n${link}`.trim() };
    }
    // Sent to the crew lead once the owner submits the fix details: the actual fix list.
    case "inspection_fix_details_notice": {
      const where = address ? ` at ${address}` : "";
      const details = str(payload.details) || "(see owner)";
      const phase = str(payload.phase_label) || "Inspection";
      return { subject: null, body: `${phase} fixes needed${where}:\n\n${details}`.trim() };
    }
    // Enqueued to the owner when the crew reports the work 100% complete: two single-use
    // decision links (YES advances the job to the final walkthrough, NO just acknowledges
    // and the crew keeps working). Minted inline by the daily check-in handler.
    case "finish_walkthrough_ask": {
      const where = address ? ` at ${address}` : "";
      const yes = str(payload.yes_link);
      const no = str(payload.no_link);
      return {
        subject: null,
        body: `Crew marked the job${where} 100% complete. Ready for the final walkthrough?\n\nYES: ${yes}\n\nNO: ${no}`.trim(),
      };
    }
    // Enqueued to the owner when a job enters the final walkthrough state: two single-use
    // decision links (APPROVE advances the job to complete/invoice-ready, PUNCH LIST opens
    // the form to record outstanding fixes and keeps the job in walkthrough).
    case "walkthrough_result_ask": {
      const where = address ? ` at ${address}` : "";
      const approve = str(payload.approve_link);
      const punch = str(payload.punch_link);
      const reschedule = str(payload.reschedule_link);
      const lines = [
        `Final walkthrough${where} - how did it go?`,
        "",
        `APPROVE: ${approve}`,
        "",
        `PUNCH LIST: ${punch}`,
      ];
      if (reschedule) lines.push("", `RESCHEDULE: ${reschedule}`);
      return { subject: null, body: lines.join("\n") };
    }
    // Re-asked to the owner after a punch list is completed: three single-use decision
    // links. APPROVE advances to complete/invoice-ready; STILL ISSUES reopens the punch-list
    // form (loops); RESCHEDULE acknowledges a reschedule and keeps the job in walkthrough.
    case "walkthrough_reask": {
      const where = address ? ` at ${address}` : "";
      const approve = str(payload.approve_link);
      const still = str(payload.still_issues_link);
      const reschedule = str(payload.reschedule_link);
      return {
        subject: null,
        body: `Punch list done${where} - ready to approve?\n\nAPPROVE: ${approve}\n\nSTILL ISSUES: ${still}\n\nRESCHEDULE: ${reschedule}`.trim(),
      };
    }
    // Owner+office copy when the owner taps RESCHEDULE on a walkthrough ask. No state
    // change: the job stays in walkthrough so it can still be approved later. (Unused by
    // the current decision wiring, which routes reschedule through decision_outcome; kept
    // available for a dedicated reschedule notice.)
    case "walkthrough_reschedule_notice": {
      const where = address ? ` at ${address}` : "";
      return { subject: null, body: `Walkthrough reschedule requested${where}. Please rebook the walkthrough.`.trim() };
    }
    // Sent to the owner after they tap PUNCH LIST: a single-use link to the form where
    // they list the items still to fix. Minted by the decision spine on walkthrough_punch_list.
    case "walkthrough_punch_list_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      return { subject: null, body: `Walkthrough${where}: list the punch items here:\n${link}`.trim() };
    }
    // Sent to the crew lead once the owner submits the punch list: the actual item list.
    case "walkthrough_punch_list_notice": {
      const where = address ? ` at ${address}` : "";
      const details = str(payload.details) || "(see owner)";
      // The close-the-loop instruction matters: failing the walkthrough reverts the job to
      // the finish phase, and the owner's next prompt (the walkthrough schedule link) fires
      // off the crew's 100% check-in -> owner YES path — so the crew must know reporting
      // 100% is the "done" signal. (NOT "ready for inspection" — that would re-request the
      // city inspector, not the customer walkthrough.)
      return {
        subject: null,
        body: `Walkthrough punch list${where}:\n\n${details}\n\nThe job is back in the finish phase - report 100% on your daily check-in when the list is done.`.trim(),
      };
    }
    // Follow-on SMS the decision spine (action-decision) enqueues after a tap-link
    // advances a job. Copy is keyed off the decision's action so one template serves
    // every owner/crew decision outcome.
    case "decision_outcome": {
      const where = address ? ` at ${address}` : "";
      const action = str(payload.action);
      // The stage label ("Rough-In Inspection") of the state the decision was made ON, so
      // pass/fail outcomes say which inspection they settle. Walkthrough copies self-label.
      const phase = str(payload.phase_label) || "Inspection";
      const copy: Record<string, string> = {
        inspection_pass: `${phase} passed${where}. The job has advanced to the next phase.`,
        inspection_fail: `${phase} failed${where}. Please review the required fixes.`,
        finish_walkthrough_yes: `Marked ready for walkthrough${where}. The final walkthrough will be scheduled.`,
        walkthrough_approve: `Walkthrough approved${where}. Ready to prepare the invoice.`,
        walkthrough_reschedule: `Walkthrough reschedule requested${where}. Please rebook the walkthrough.`,
        walkthrough_still_issues: `Walkthrough still has issues${where}. A new punch list is being recorded.`,
      };
      return { subject: null, body: copy[action] ?? `Job update${where}.` };
    }
    // Weekly owner email digest enqueued by the weekly-report cron. Summarizes the four
    // sections from the stored snapshot and links to the preview page for the full detail.
    case "weekly_report_digest": {
      const company = str(payload.company_name);
      const periodStart = str(payload.period_start);
      const periodEnd = str(payload.period_end);
      const previewUrl = str(payload.preview_url);
      const totals = (payload.totals ?? {}) as Record<string, unknown>;
      const phases = Array.isArray(payload.active_by_phase) ? (payload.active_by_phase as any[]) : [];
      const completed = Array.isArray(payload.completed) ? (payload.completed as any[]) : [];
      const stalled = Array.isArray(payload.stalled) ? (payload.stalled as any[]) : [];
      const coverageGaps = Array.isArray(payload.coverage_gaps) ? (payload.coverage_gaps as any[]) : [];
      const unlinkedWork = Array.isArray(payload.unlinked_work) ? (payload.unlinked_work as any[]) : [];

      const range = periodStart && periodEnd ? `${periodStart} – ${periodEnd}` : (periodStart || periodEnd);
      const subject = `${company ? `${company} — ` : ""}Weekly report${range ? ` (${range})` : ""}`;

      // Each entry is a final HTML fragment (dynamic values escaped at construction), joined
      // by <br>. Numeric totals come straight from the snapshot but are escaped for safety.
      const lines: string[] = [];
      lines.push(`<strong>Week totals</strong>`);
      lines.push(
        `Active jobs: ${escapeHtml(str(totals.active_jobs) || "0")} · ` +
        `Completed: ${escapeHtml(str(totals.completed_jobs) || "0")} · ` +
        `Stalled: ${escapeHtml(str(totals.stalled_jobs) || "0")} · ` +
        `Hours logged: ${escapeHtml(str(totals.hours_logged) || "0")}`,
      );

      lines.push("");
      lines.push(`<strong>Active jobs by phase</strong>`);
      if (phases.length) {
        for (const p of phases) lines.push(`${escapeHtml(str(p.label) || "(no phase)")}: ${escapeHtml(str(p.count) || "0")}`);
      } else {
        lines.push("None");
      }

      lines.push("");
      lines.push(`<strong>Completed this week</strong>`);
      if (completed.length) {
        for (const c of completed) lines.push(escapeHtml(str(c.address) || "(no address)"));
      } else {
        lines.push("None");
      }

      lines.push("");
      lines.push(`<strong>Stalled / needs attention</strong>`);
      if (stalled.length) {
        for (const s of stalled) {
          const days = str(s.days_since);
          lines.push(`${escapeHtml(str(s.address) || "(no address)")}${days ? ` &mdash; ${escapeHtml(days)}d since last log` : ""}`);
        }
      } else {
        lines.push("None");
      }

      lines.push("");
      lines.push(`<strong>Coverage gaps</strong>`);
      if (coverageGaps.length) {
        for (const g of coverageGaps) lines.push(`${escapeHtml(str(g.name) || "(unnamed crew)")} &mdash; no check-ins this week`);
      } else {
        lines.push("None - every assigned crew logged this week");
      }

      lines.push("");
      lines.push(`<strong>Unlinked work this week</strong>`);
      if (unlinkedWork.length) {
        for (const u of unlinkedWork) {
          const crew = str(u.crew_name);
          const hrs = str(u.hours_worked);
          lines.push(
            `${escapeHtml(str(u.address) || "(no address)")}` +
            `${crew ? ` &mdash; ${escapeHtml(crew)}` : ""}` +
            `${hrs ? ` (${escapeHtml(hrs)}h)` : ""}`,
          );
        }
      } else {
        lines.push("None");
      }

      let html = lines.join("<br>");
      if (previewUrl) html += `<br><br>Full report: <a href="${escapeHtml(previewUrl)}">${escapeHtml(previewUrl)}</a>`;
      return { subject, body: html };
    }
    default:
      return { subject: templateKey, body: escapeHtml(JSON.stringify(payload)) };
  }
}
