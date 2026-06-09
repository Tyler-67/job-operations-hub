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
    // The hourly check-in cron enqueues this as an SMS to the job's lead crew. The link
    // is a single-use, job+contact-bound daily_check_in action token built by the cron.
    case "daily_check_in_link": {
      const company = str(payload.company_name);
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      const lead = company ? `${company}: ` : "";
      return { subject: null, body: `${lead}Time for today's job check-in${where}. Submit here: ${link}`.trim() };
    }
    case "daily_check_in_summary": {
      const logDate = str(payload.log_date);
      const subject = `Daily check-in${logDate ? ` — ${logDate}` : ""}`;
      const body = escapeHtml(
        `A daily check-in was submitted${address ? ` for ${address}` : ""}${logDate ? ` on ${logDate}` : ""}.`,
      );
      return { subject, body };
    }
    // The inspection-reminder cron enqueues this as an SMS to the owner when a job has
    // reached an inspection phase but has no date yet. The link is a single-use
    // inspection_date token that opens the branded date picker. Re-sent daily until set.
    case "inspection_date_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      return { subject: null, body: `Pick the inspection date${where}: ${link}`.trim() };
    }
    // Day-of-inspection SMS to the owner: two single-use decision links (PASS / FAIL),
    // each a token the action-decision spine consumes to advance or revert the job.
    case "inspection_result_ask": {
      const where = address ? ` at ${address}` : "";
      const pass = str(payload.pass_link);
      const fail = str(payload.fail_link);
      return {
        subject: null,
        body: `Inspection result${where}? Tap PASS ${pass} or FAIL ${fail}`.trim(),
      };
    }
    // Sent to the owner after a FAILED inspection: a single-use link to the form where
    // the owner records what the inspector flagged. Minted by the decision spine on fail.
    case "inspection_fix_details_link": {
      const link = str(payload.link);
      const where = address ? ` at ${address}` : "";
      return { subject: null, body: `Inspection failed${where}. Tell the crew what to fix: ${link}`.trim() };
    }
    // Sent to the crew lead once the owner submits the fix details: the actual fix list.
    case "inspection_fix_details_notice": {
      const where = address ? ` at ${address}` : "";
      const details = str(payload.details) || "(see owner)";
      return { subject: null, body: `Inspection fixes needed${where}: ${details}`.trim() };
    }
    // Follow-on SMS the decision spine (action-decision) enqueues after a tap-link
    // advances a job. Copy is keyed off the decision's action so one template serves
    // every owner/crew decision outcome.
    case "decision_outcome": {
      const where = address ? ` at ${address}` : "";
      const action = str(payload.action);
      const copy: Record<string, string> = {
        inspection_pass: `Inspection passed${where}. The job has advanced to the next phase.`,
        inspection_fail: `Inspection failed${where}. Please review the required fixes.`,
        finish_walkthrough_yes: `Marked ready for walkthrough${where}. The final walkthrough will be scheduled.`,
        walkthrough_approve: `Walkthrough approved${where}. Ready to prepare the invoice.`,
      };
      return { subject: null, body: copy[action] ?? `Job update${where}.` };
    }
    default:
      return { subject: templateKey, body: escapeHtml(JSON.stringify(payload)) };
  }
}
