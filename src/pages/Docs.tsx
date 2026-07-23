import { ReactNode, useEffect, useState } from "react";

// The in-app guide, organized as TABS (one per area) each holding its sections. Pure static
// content; the active tab syncs to the URL hash so a tab can be linked directly. Keep this in
// sync with real behavior when flows change.

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 leading-relaxed text-foreground/90">{children}</p>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-foreground/90">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ul>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-foreground/90">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ol>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{children}</h2>;
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 text-xs font-semibold text-foreground">{children}</h3>;
}

function K({ children }: { children: ReactNode }) {
  return <span className="rounded-sm bg-muted px-1 py-0.5 font-mono-num text-2xs">{children}</span>;
}

function DocTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-sm border border-border">
      <table className="w-full border-collapse text-2xs">
        <thead className="bg-muted/60 text-left uppercase tracking-wider text-muted-foreground">
          <tr>{head.map((h) => <th key={h} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="align-top odd:bg-background even:bg-muted/20">
              {cells.map((c, j) => <td key={j} className="border-b border-border px-2 py-1.5 leading-relaxed last:border-b-0">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DocTab {
  id: string;
  label: string;
  body: ReactNode;
}

const TABS: DocTab[] = [
  {
    id: "start",
    label: "Start here",
    body: (
      <>
        <H2>What is Daily Burn?</H2>
        <P>
          Daily Burn runs a trades company&apos;s jobs from scheduling through payment. The office works in this
          dashboard; the crew and the owner mostly act over <strong>text message</strong> — every text carries a
          single-use link that opens a small branded form or a one-tap decision page. Nobody in the field needs an
          account or a password.
        </P>
        <Bullets items={[
          <><strong>Office</strong> — creates jobs, assigns crew, watches progress, values purchase orders, runs reports, and can push a job through any step from the job page.</>,
          <><strong>Crew</strong> — gets a daily check-in text per active job: hours, phase progress, parts, photos, and a &quot;ready for inspection&quot; flag.</>,
          <><strong>Owner</strong> — gets the decision texts: schedule the inspection or walkthrough, PASS/FAIL, APPROVE/PUNCH LIST, and writes fix lists when something fails.</>,
          <>Texts and emails send through <strong>Uptiq</strong> and appear in each contact&apos;s Uptiq conversation; appointments land on the company&apos;s Uptiq calendar.</>,
        ]} />
        <P>
          Links in texts are <strong>single-use and expiring</strong>: once submitted (or after the expiry window) the
          link shows &quot;already used&quot; instead of a form, so a forwarded or re-tapped link can&apos;t double-submit.
          Multi-choice texts retire <strong>as a unit</strong> — answering PASS also burns the FAIL link from that same
          text (and likewise for APPROVE/PUNCH LIST/RESCHEDULE and YES/NO). A decision link also only acts while the
          job is still in the matching phase; anything stale just shows the &quot;no longer valid&quot; page. When a step
          needs doing again, the flow sends a fresh link — or the office drives it from the job page.
        </P>

        <H2>The job lifecycle</H2>
        <P>Every job moves through the company&apos;s configured states (see Admin → Job States). The default plumbing flow:</P>
        <P>
          <K>Job Scheduled</K> → <K>Dirt Work</K> → <K>Dirt Work Inspection</K> → <K>Rough-In</K> → <K>Rough-In Inspection</K> → <K>Finish Work</K> → <K>Final Inspection</K> → <K>Walkthrough</K> → <K>Complete</K> → <K>Paid</K>
        </P>
        <DocTable
          head={["Movement", "Triggered by"]}
          rows={[
            [<>Work phase → its inspection</>, <>Crew marks <strong>ready for inspection</strong> on a daily check-in (or the office moves the state).</>],
            [<>Inspection → next phase</>, <>Owner taps <strong>PASS</strong> (or office clicks <strong>Mark inspection passed</strong>).</>],
            [<>Inspection → back to the work phase</>, <>Owner taps <strong>FAIL</strong> and writes the fix list (or office clicks <strong>Mark inspection failed</strong>).</>],
            [<>Finish Work → Walkthrough</>, <>Crew reports <strong>100%</strong> → owner answers <strong>YES</strong>; or Final Inspection <strong>PASS</strong>.</>],
            [<>Walkthrough → Complete</>, <>Owner taps <strong>APPROVE</strong> on the walkthrough ask.</>],
            [<>Walkthrough → back to Finish Work</>, <>Owner taps <strong>PUNCH LIST</strong> and writes the list (failing the walkthrough).</>],
            [<>Complete → Paid</>, <><strong>Mark Paid</strong> on the job page.</>],
          ]}
        />
        <P>
          The office <strong>Current state</strong> dropdown on the job page can move a job anywhere directly. A manual
          move fires the same notifications the natural path would — into an inspection phase texts the owner the
          scheduling link, into Walkthrough texts the walkthrough schedule link.
        </P>

        <H2>The Dashboard</H2>
        <P>
          Three columns: the <strong>Active jobs</strong> table, a <strong>Search</strong> panel (jobs, contacts, POs,
          expenses — same search as the Search page), and the <strong>Office queue</strong>. The counts live in the
          headers: <strong>Active jobs (n)</strong>; <strong>Inspection (due/scheduled)</strong>;
          <strong> Check-in (overdue/eligible)</strong> — crews that haven&apos;t checked in today out of those in a
          check-in phase; <strong>Action (n)</strong> — jobs needing any office action (overdue check-in, inspection
          phase, or a PO waiting for its real cost); <strong>Office queue (n)</strong> — those same jobs listed with a
          chip naming the action. <strong>Jobs by state / Completion pulse</strong> show where active work sits and
          what&apos;s ready for billing follow-up.
        </P>
      </>
    ),
  },
  {
    id: "jobs",
    label: "Jobs",
    body: (
      <>
        <H2>The Jobs list</H2>
        <P>
          Every job with its state, phase progress bar (<strong>State %</strong> — what the crew last reported for the
          current phase), crew, expenses, next inspection date, and last check-in. Search matches address, customer,
          and crew; the state filter and the <strong>Archived</strong> toggle narrow the list. <strong>Search</strong> in
          the sidebar searches across jobs, contacts, and logs.
        </P>

        <H2>The job page — field reference</H2>
        <DocTable
          head={["Field", "What it does"]}
          rows={[
            [<strong>Job address</strong>, <>The job&apos;s identity everywhere: lists, texts, calendar titles, reports.</>],
            [<strong>Current state</strong>, <>The lifecycle position. Changing it is a real move — the matching notifications fire (see Start here).</>],
            [<strong>Customer</strong>, <>Name/email/phone. Linked to an Uptiq contact by the sync; the customer gets the review request after completion.</>],
            [<strong>Crew + crew lead</strong>, <>Pick crew from the synced contact list or type names. Every active crew member with an Uptiq contact gets the daily check-in text; the <strong>lead</strong> also gets decision outcomes and fix/punch lists.</>],
            [<strong>Start date</strong>, <>Shown on reports; no automation hangs off it.</>],
            [<strong>Inspection date &amp; time</strong>, <>The scheduled inspection. Setting/moving it syncs the Uptiq calendar appointment. Time offers &quot;No time&quot; / 9:00 AM / 1:00 PM — with no time chosen, the calendar and the day-of ask fall back to the morning window. The PASS/FAIL ask arrives at the window, not the moment the date is saved.</>],
            [<strong>Walkthrough date &amp; time</strong>, <>Same semantics for the walkthrough appointment and the APPROVE/PUNCH LIST ask.</>],
            [<strong>State progress %</strong>, <>Phase progress from crew check-ins (resets each phase). Editable here as a correction.</>],
            [<strong>Hours</strong>, <>Running job total. Check-ins add to it; an office edit here is the correction path — later check-ins add on top of your corrected number.</>],
            [<strong>Estimate / Invoice number</strong>, <>Reference numbers; the estimate shows against expenses in Job totals.</>],
            [<strong>Scope of work / Notes</strong>, <>Free text. Fix lists and punch lists the owner writes are appended to Notes automatically, dated.</>],
          ]}
        />
        <Sub>Buttons</Sub>
        <Bullets items={[
          <><strong>Mark inspection passed / failed</strong> — shown while the job sits in an inspection phase; the office version of the owner&apos;s text, same machinery and texts.</>,
          <><strong>Mark Paid</strong> — shown on completed jobs; moves to Paid and records the payment source.</>,
          <><strong>Archive</strong> — takes the job out of the daily loop and cancels its calendar appointments. Reversible (the Archived filter on the Jobs list shows them; restore by un-archiving).</>,
        ]} />
        <Sub>Job totals</Sub>
        <P>
          Expenses (field purchases + valued POs), estimate, hours, and POs awaiting value — compiled from the
          purchasing records, not hand-entered.
        </P>
        <Sub>Check-ins drill-down</Sub>
        <P>
          Everything the crew submitted, one row per day per crew member: date, crew, phase chip, ready-for-inspection
          flag, photo count, progress, hours. Click a row for the notes, the parts story, photo thumbnails (job site,
          receipt, parts — click for full size), and the submission time + channel. Photo links are signed and expire
          after ~10 minutes; reload the page if one stops loading.
        </P>
      </>
    ),
  },
  {
    id: "check-ins",
    label: "Check-ins",
    body: (
      <>
        <H2>How the daily check-in works</H2>
        <P>
          On each check-in day at the configured send time (Settings → Notification timing), <strong>every active crew
          member</strong> on every active job in a check-in phase gets their own text with their own link — not just the
          lead. The link opens the branded check-in form for that job.
        </P>
        <Sub>What the form captures</Sub>
        <DocTable
          head={["Field", "Where it goes"]}
          rows={[
            [<strong>Hours worked</strong>, <>Added to that crew member&apos;s day entry and the job&apos;s total hours. Two same-day submissions add together (3h then 2h = 5h for the day).</>],
            [<strong>Phase progress %</strong>, <>Becomes the job&apos;s State % (latest value wins).</>],
            [<strong>Parts</strong>, <>None / field purchase / supply house order — see the Purchasing tab for what each one does.</>],
            [<strong>Job site photos</strong>, <>Stored on the day&apos;s entry; visible in the job&apos;s Check-ins drill-down.</>],
            [<strong>Issues or notes</strong>, <>Shown in the drill-down and the daily summary email.</>],
            [<strong>Mark this phase ready for inspection</strong>, <>Confirms first, then advances the job into the phase&apos;s inspection and starts the scheduling flow. In Walkthrough it instead re-asks the owner to review.</>],
          ]}
        />
        <Sub>What sends when a check-in is submitted</Sub>
        <Bullets items={[
          <>Owner + office get the <strong>daily check-in summary</strong> email — every submission, immediately.</>,
          <>If ready-for-inspection advanced the job: owner + office get the text naming the stage, and the owner gets the <strong>date &amp; time link</strong> right away.</>,
          <>If parts were involved: the purchasing messages (see Purchasing).</>,
          <>If the crew reported <strong>100%</strong> in a phase that leads to the walkthrough: the owner gets the &quot;ready for the final walkthrough?&quot; YES/NO ask.</>,
        ]} />
        <P>
          A second same-day check-in <strong>updates</strong> that day&apos;s entry (hours add; other fields take the
          latest values) and sends its messages again — the office always hears about real activity. Crew who logged
          nothing count toward the Dashboard&apos;s Check-in (overdue/eligible) header and the weekly report&apos;s
          coverage gaps.
        </P>
      </>
    ),
  },
  {
    id: "inspections",
    label: "Inspections",
    body: (
      <>
        <H2>The inspection cycle</H2>
        <P>
          Each inspection text names its stage — &quot;Dirt Work Inspection&quot;, &quot;Rough-In Inspection&quot;,
          &quot;Final Inspection&quot; (the labels come from Job States, so renaming a state renames its texts).
        </P>
        <Steps items={[
          <><strong>Request.</strong> The crew marks ready for inspection (or the office moves the job into the inspection phase). Instantly: the owner gets the <strong>pick-the-date link</strong> (date + 9:00 AM / 1:00 PM window) and the office gets a heads-up text.</>,
          <><strong>Schedule.</strong> The picked date &amp; time land on the job and as an appointment on the company&apos;s Uptiq calendar. Re-picking moves the same appointment (it never duplicates). While no date is set, the owner gets one nudge per day at the reminder hour, and the office a copy.</>,
          <><strong>Inspection day.</strong> The owner gets <strong>PASS / FAIL</strong> links at the appointment&apos;s time window — a 1:00 PM inspection asks at 1:00 PM, not at dawn (and not the moment someone sets today&apos;s date; if the window already passed, it asks right away). The office gets a no-links copy at the same time.</>,
          <><strong>PASS.</strong> The job advances; owner, office, and crew lead get the stage-named outcome text.</>,
          <><strong>FAIL.</strong> The job falls back to the work phase, and the same page asks the owner what the inspector flagged. The list is appended to the job&apos;s notes and texted to the crew lead. The inspection date clears — the next cycle schedules fresh.</>,
          <><strong>Fix &amp; re-request.</strong> When the crew marks ready for inspection again, the whole cycle restarts: fresh date link, fresh appointment, fresh PASS/FAIL. Every re-entry asks again — nothing is swallowed because &quot;it already asked once.&quot;</>,
        ]} />
        <Sub>Office controls</Sub>
        <Bullets items={[
          <>Set or move the <strong>date &amp; time</strong> on the job page — same calendar sync, and date-to-today sends the ask now.</>,
          <>Change just the <strong>time window</strong> — re-times the same appointment, no texts.</>,
          <><strong>Mark inspection passed / failed</strong> buttons — identical to the owner&apos;s taps; FAIL texts the owner the fix-list link.</>,
        ]} />
      </>
    ),
  },
  {
    id: "walkthrough",
    label: "Walkthrough",
    body: (
      <>
        <H2>The final walkthrough</H2>
        <P>The customer-facing final review. It runs like an inspection — scheduled first, decided on the day.</P>
        <Steps items={[
          <><strong>Enter Walkthrough</strong> (Final Inspection PASS, the owner&apos;s YES after 100%, or the office dropdown): the owner gets the <strong>schedule-the-walkthrough link</strong> (date + 9:00 AM / 1:00 PM). The appointment lands on the Uptiq calendar; an unset date gets a daily nudge at the reminder hour.</>,
          <><strong>Walkthrough day:</strong> the owner gets <strong>APPROVE / PUNCH LIST / RESCHEDULE</strong> at the walkthrough&apos;s time window (right away if the window already passed).</>,
          <><strong>APPROVE:</strong> the job moves to Complete — the completion report snapshot is generated and the customer review request is scheduled (see Reports).</>,
          <><strong>PUNCH LIST</strong> — failing the walkthrough: the owner writes the list on the same page. The job reverts to <strong>Finish Work</strong>, the walkthrough date is voided and the calendar slot cancelled, the list is appended to the job notes, and the crew lead gets it by text with the done-signal: <em>report 100% on the daily check-in when the list is finished</em>.</>,
          <><strong>The loop closes:</strong> the crew&apos;s 100% report asks the owner &quot;ready for the final walkthrough?&quot; — YES re-enters Walkthrough and sends a <strong>fresh schedule link</strong>. Approve, or run another punch list; every cycle asks again.</>,
          <><strong>RESCHEDULE:</strong> voids the date and sends the owner a fresh scheduling link.</>,
        ]} />
        <P>
          If the crew marks &quot;ready for inspection&quot; while the job sits in Walkthrough (punch work done without a
          revert, or a nudge), the owner is re-asked to review: <strong>APPROVE / STILL ISSUES / RESCHEDULE</strong>.
          STILL ISSUES opens a fresh punch list.
        </P>
      </>
    ),
  },
  {
    id: "purchasing",
    label: "Purchasing",
    body: (
      <>
        <H2>The three parts answers on a check-in</H2>
        <Sub>No parts today</Sub>
        <P>Nothing happens — the check-in records as usual.</P>
        <Sub>I bought parts (field purchase)</Sub>
        <Bullets items={[
          <>Captures amount, vendor, description, receipt photo, parts photo.</>,
          <>Creates a <strong>field purchase expense</strong> on the job (rolls into Job totals).</>,
          <>Owner + office get a text with the receipt/parts photo links so the office can verify and value it.</>,
        ]} />
        <Sub>Ordered from supply house — &quot;Place order with supply house&quot;</Sub>
        <Bullets items={[
          <>The app authors the order: a <strong>PO number</strong> is minted (per-company, per-day sequence) and the PO is created as <strong>sent</strong>.</>,
          <>The supply house gets the <strong>order email</strong>: parts list, job address, pickup time, and the &quot;please don&apos;t exceed&quot; cost ceiling (both from Settings).</>,
          <>Owner + office get the &quot;parts ordered&quot; text with the PO number.</>,
        ]} />
        <Sub>Ordered from supply house — &quot;I&apos;ve already ordered&quot;</Sub>
        <Bullets items={[
          <>The crew placed the order themselves; the app records a <strong>pending-value PO</strong> (no number yet).</>,
          <>The supply house gets a <strong>confirmation heads-up</strong> email — explicitly <em>not a new order</em> — so the counter can check what&apos;s on file.</>,
          <>The office values it later (below).</>,
        ]} />

        <H2>Valuing POs — Admin → Expenses</H2>
        <Bullets items={[
          <><strong>PO queue</strong> — pending-value POs wait here; the Dashboard&apos;s &quot;POs need value&quot; counts them. Enter the real cost and the PO&apos;s value rolls into the job&apos;s totals.</>,
          <><strong>Expenses</strong> — every job expense (field purchases + valued POs) with receipt/parts photo thumbnails; add manual expenses here too.</>,
          <><strong>Purchase orders</strong> — the full PO list with status and history.</>,
        ]} />
        <P>
          Supply houses themselves are managed under <strong>Admin → Supply Houses</strong> (email required — that&apos;s
          where the order emails go). The default supply house pre-fills the crew&apos;s check-in picker.
        </P>
      </>
    ),
  },
  {
    id: "messages",
    label: "Messages",
    body: (
      <>
        <H2>Timing rules</H2>
        <Bullets items={[
          <><strong>Anything a person does sends its messages immediately</strong> — check-ins, decisions, date picks, punch lists, office state changes. Seconds, not minutes.</>,
          <><strong>Only scheduled things ride the clock:</strong> daily check-in links (send time + days), the daily unscheduled-date nudges and day-of asks (reminder hour), and the weekly report (its day + time). All times are company-local (Settings → timezone).</>,
          <>A retry backstop sweeps unsent messages every 15 minutes, so a temporarily failed send recovers on its own.</>,
        ]} />

        <H2>Message reference</H2>
        <P>Every message the app sends, who gets it, and when:</P>
        <DocTable
          head={["Message", "To", "When"]}
          rows={[
            [<>Daily check-in link <K>SMS</K></>, "Each crew member", "Check-in days at the send time, per active job in a check-in phase"],
            [<>Daily check-in summary <K>email</K></>, "Owner + office", "Every check-in submission, immediately"],
            [<>Ready-for-inspection notice <K>SMS</K></>, "Owner + office", "Crew marks ready and the job advances (stage-named)"],
            [<>Inspection date &amp; time link <K>SMS</K></>, "Owner", "Entering an inspection phase; re-sent daily at the reminder hour while unset"],
            [<>Office reminder copy <K>SMS</K></>, "Office", "Alongside the owner's nudge / day-of ask (no links)"],
            [<>Inspection PASS/FAIL ask <K>SMS</K></>, "Owner", "At the inspection's time window on its day (as soon as the window passed, if scheduled late)"],
            [<>Fix-details link <K>SMS</K></>, "Owner", "Office marks FAIL (an owner FAIL tap shows the form inline instead)"],
            [<>Fix list <K>SMS</K></>, "Crew lead", "Owner submits the fix details (stage-named)"],
            [<>Decision outcome <K>SMS</K></>, "Owner / office / crew lead", "After each decision — pass, fail, approve, etc. (stage-named)"],
            [<>&quot;Ready for the final walkthrough?&quot; YES/NO <K>SMS</K></>, "Owner", "Crew reports 100% in a phase that leads to the walkthrough"],
            [<>Walkthrough schedule link <K>SMS</K></>, "Owner", "Entering Walkthrough; daily nudge while unset; after RESCHEDULE or a punch-list revert cycle"],
            [<>Walkthrough APPROVE/PUNCH LIST ask <K>SMS</K></>, "Owner", "At the walkthrough's time window on its day (as soon as the window passed, if scheduled late)"],
            [<>Walkthrough re-ask (APPROVE/STILL ISSUES) <K>SMS</K></>, "Owner", "Crew marks ready for inspection while the job sits in Walkthrough"],
            [<>Punch list <K>SMS</K></>, "Crew lead", "Owner submits a punch list (includes the report-100% done signal)"],
            [<>Supply order <K>email</K></>, "Supply house", "Crew places an order (parts list, pickup time, cost ceiling, PO number)"],
            [<>Order confirmation heads-up <K>email</K></>, "Supply house", "Crew says they already ordered (explicitly not a new order)"],
            [<>Parts ordered <K>SMS</K></>, "Owner + office", "The app placed a supply order"],
            [<>Field purchase <K>SMS</K></>, "Owner + office", "A check-in records a field purchase (with photo links)"],
            [<>Weekly report <K>email</K></>, "Owner + office", "The configured day + time"],
          ]}
        />
        <P>
          Multi-choice texts list one labeled link per line (APPROVE: … / PUNCH LIST: …). Inspection texts always name
          their stage. Crew texts open with the company name from Settings.
        </P>
      </>
    ),
  },
  {
    id: "reports",
    label: "Reports",
    body: (
      <>
        <H2>Completion reports</H2>
        <P>
          The moment a job reaches a billing state (Complete), a snapshot is generated no matter which path completed
          it: customer, crew, dates, hours, expenses, POs, and the check-in trail — the invoice-prep package.
          <strong> Reports → Completion</strong> lists every snapshot; the newest also renders on the job page.
        </P>
        <H2>Weekly report</H2>
        <P>
          An owner + office email digest at the configured day/time (Settings): week totals (hours, expenses, jobs
          completed), active jobs by phase, completed jobs, stalled jobs, crew coverage gaps (crew who logged nothing
          all week), and unlinked work, with a link to the full preview (<strong>Reports → Weekly</strong>). One digest
          per period — it won&apos;t double-send within the same week.
        </P>
        <H2>Customer review requests</H2>
        <P>
          A configurable number of days after completion (Settings → review delay), the customer&apos;s Uptiq contact is
          tagged — that tag kicks off whatever review-request campaign is configured in Uptiq. It fires once per job,
          on every completion path.
        </P>
      </>
    ),
  },
  {
    id: "admin",
    label: "Admin",
    body: (
      <>
        <H2>Contacts &amp; the Uptiq sync</H2>
        <P>
          <strong>Admin → Contacts</strong> is the list of people the company messages: customers, crew, owner, office,
          supply houses. Contacts are separate from app users — a contact never logs in, a user never gets job texts
          (unless they&apos;re also a contact).
        </P>
        <Bullets items={[
          <><strong>Sync with Uptiq</strong> is one command, two steps. Step 1 — tag import: every Uptiq contact tagged <K>crew</K>, <K>customer</K>, <K>owner</K>, <K>office</K>, or <K>supply house</K> lands in Contacts by role, repairing stale links (supply houses also join the Supply Houses list). Step 2 — link the rest: app records still missing their Uptiq link are matched by name/email/phone. Read-only in Uptiq, additive, and it never overwrites an already-linked record.</>,
          <>Workflow for new people: tag them in Uptiq → Sync → they appear here (and crew in the job form&apos;s dropdown).</>,
          <>Deactivate a contact to stop their texts without deleting history; delete only works when a contact has no history.</>,
        ]} />

        <H2>Settings</H2>
        <DocTable
          head={["Group", "Fields"]}
          rows={[
            ["Company", "Name (the prefix on crew texts + form headers) and timezone (all send times are local)."],
            ["Notification timing", "Crew check-in send time + days, inspection reminder hour, weekly report day + time, review delay days."],
            ["Owner & office", "The two contacts that receive owner/office texts — pick from role-tagged contacts."],
            ["Supply & costs", "Default supply house, parts cost ceiling (quoted on order emails), pickup time."],
            ["Branding", "Color + logo on the crew & owner form pages."],
            ["Setup health", "The checklist of what must be configured before going live."],
            ["Debug mode", "Reveals the testing panels for granted users (see Help). Keep it off day-to-day."],
          ]}
        />

        <H2>Job States editor</H2>
        <P><strong>Admin → Job States</strong> defines the workflow stages. Each state has a label, API value, color, sort order, and flags:</P>
        <DocTable
          head={["Flag", "Effect"]}
          rows={[
            ["Check-ins", "Crew get daily check-in links while a job sits here."],
            ["Inspection", "Runs the inspection scheduling / PASS-FAIL flow; texts carry this state's label."],
            ["Walkthrough", "Runs the walkthrough scheduling / APPROVE-PUNCH flow."],
            ["Billing", "Entering it generates the completion report and schedules the review request."],
            ["Terminal", "The end of the line (Paid) — no further automation."],
          ]}
        />
        <P>
          Renaming a state renames it everywhere, including the stage names in texts. The allowed movements between
          states are preconfigured for the trade — changing the flow itself is a support task.
        </P>

        <H2>Users, roles &amp; login</H2>
        <DocTable
          head={["Role", "Can"]}
          rows={[
            [<strong>Viewer / Crew</strong>, "See everything; change nothing. (Crew do their real work via the SMS links, no login needed.)"],
            [<strong>Office manager</strong>, "Run the day-to-day: jobs, expenses & POs, supply houses, settings, reports. Can't manage users or contacts."],
            [<strong>Owner</strong>, "Everything an office manager can, plus users and contacts."],
            [<strong>Support admin / Dev super user</strong>, "Product-maintenance roles, including the debug tools."],
          ]}
        />
        <Bullets items={[
          <>Two doors, one session: inside <strong>Uptiq</strong> the app signs you in automatically; the standalone page at <K>/login</K> takes a password or an emailed magic link.</>,
          <>Admins set (and can view) a user&apos;s password from the Users page; anyone can change their own via the header&apos;s <strong>Change password</strong>.</>,
          <>Deactivating a user revokes access immediately; the last owner can&apos;t be demoted or deactivated.</>,
        ]} />
      </>
    ),
  },
  {
    id: "help",
    label: "Help",
    body: (
      <>
        <H2>Testing &amp; debug tools</H2>
        <P>
          With <strong>Debug mode</strong> on (Settings), granted users see extra panels. Access is per-tool, granted on
          the Users page. The tools trigger or clean up — they never change how the app behaves for real users.
        </P>
        <DocTable
          head={["Tool", "What it does"]}
          rows={[
            ["Testing tools (crons)", "Run the scheduled sends on demand — check-in links, reminder nudges, weekly report, and the delivery sweep."],
            ["Uptiq contacts", "Preview (dry run) or run the two-step contact sync."],
            ["Send a test message", "One SMS or email to a linked contact, right now, with the raw provider response."],
            ["Conversations", "List Uptiq threads, back one up, and clear it so the next message starts fresh."],
            ["Jobs (debug)", "Hard-delete test jobs and everything under them. Not for real jobs — that's Archive."],
            ["Data reset", "Clear accumulated test data by category (history, tokens, reports, contacts…)."],
          ]}
        />
        <P>
          Running a scheduled send manually near its real send time can double-text — the real run doesn&apos;t know
          about the forced one. Expected; that&apos;s the price of the testing buttons never suppressing real sends.
          Forced runs only fire for <em>your own</em> instance (see below) — never anyone else&apos;s.
        </P>

        <H2>Instances &amp; release channels (dev/support)</H2>
        <P>
          The product runs two builds against one shared database. <strong>Production</strong> (the app inside Uptiq)
          serves the <K>stable</K> release; the separate <strong>Development</strong> app serves <K>latest</K> — the
          newest build. Each app pairs with its own <em>instance</em> (company workspace): production data lives in the
          production instance, and the Development instance is a sandbox that starts empty (run the Uptiq sync there to
          pull the contacts on demand).
        </P>
        <Bullets items={[
          <>Any account can belong to <strong>more than one instance</strong>: give the same email a user row in another instance and a picker appears in their header — with a separate role per instance. One email, one password, everywhere (a password change anywhere changes it everywhere). Accounts in a single instance never see the picker.</>,
          <>Dev accounts are <strong>app-wide</strong>: their picker lists every instance without needing a row in each.</>,
          <>Texts minted by a tenant open <em>that tenant&apos;s</em> app: production links go to the production app, Development links to the Development app.</>,
          <>When a <K>latest</K> build is blessed as <K>stable</K>, production gets it — so the two apps briefly run the same build until development moves on.</>,
        ]} />

        <H2>Quick answers</H2>
        <Bullets items={[
          <><strong>Why does a finished job show 0%?</strong> The percent is per-phase progress and resets when the job changes phases; a completed job has no active phase.</>,
          <><strong>A link says &quot;already used.&quot;</strong> Single-use protection. The flow re-sends a fresh link at its next step, or drive the step from the job page.</>,
          <><strong>Photos stopped loading.</strong> Photo links are signed and expire after ~10 minutes. Reload the job page.</>,
          <><strong>The owner didn&apos;t get a text.</strong> Check Settings → owner contact is set and carries a real Uptiq contact; then check the contact&apos;s Uptiq conversation — sends land there even when carrier delivery isn&apos;t enabled yet.</>,
          <><strong>Change the appointment time?</strong> The date &amp; time fields on the job page (9:00 AM / 1:00 PM) re-time the calendar appointment without texting anyone.</>,
          <><strong>Who hears about a supply order?</strong> The supply house always (order or heads-up email); owner + office when the app placed it. Pending POs wait under Admin → Expenses.</>,
          <><strong>Why did the crew get two check-in links?</strong> Usually a testing button fired near the real send time — see above.</>,
          <><strong>Same-day re-inspection?</strong> Set today&apos;s date (or the crew re-requests) — the PASS/FAIL ask arrives at the chosen time window, or right away if that time already passed. Nothing waits for tomorrow&apos;s reminder hour.</>,
        ]} />
      </>
    ),
  },
];

export default function Docs() {
  const [active, setActive] = useState<string>(() => {
    const hash = window.location.hash.replace("#", "");
    return TABS.some((t) => t.id === hash) ? hash : TABS[0].id;
  });

  useEffect(() => {
    window.history.replaceState(null, "", `#${active}`);
  }, [active]);

  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-card px-4 pt-3">
        <h1 className="text-sm font-semibold">Daily Burn — App guide</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How jobs, check-ins, inspections, walkthroughs, purchasing, and messaging fit together — and what every admin
          page does.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={
                t.id === active
                  ? "rounded-t-sm border border-b-0 border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground"
                  : "rounded-t-sm border border-transparent px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6 pb-16 text-xs">{tab.body}</div>
      </main>
    </div>
  );
}
