import { ReactNode } from "react";

// The in-app guide: how every part of Daily Burn works, for office users. Pure static content —
// organized as anchored sections with a sticky table of contents. Reached from the "App guide"
// link at the bottom of the sidebar. Keep this in sync with real behavior when flows change.

interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
}

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

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 text-xs font-semibold text-foreground">{children}</h3>;
}

function K({ children }: { children: ReactNode }) {
  return <span className="rounded-sm bg-muted px-1 py-0.5 font-mono-num text-2xs">{children}</span>;
}

const SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "What is Daily Burn?",
    body: (
      <>
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
          <>Texts and emails send through <strong>Uptiq</strong>; appointments land on the company&apos;s Uptiq calendar.</>,
        ]} />
        <P>
          Links in texts are <strong>single-use and expiring</strong>: once submitted (or after the expiry window) the
          link shows &quot;already used&quot; instead of a form, so a forwarded or re-tapped link can&apos;t double-submit.
        </P>
      </>
    ),
  },
  {
    id: "lifecycle",
    title: "The job lifecycle",
    body: (
      <>
        <P>
          Every job moves through the company&apos;s configured states (see <a className="text-accent hover:underline" href="#job-states">Job States</a>).
          The default plumbing flow:
        </P>
        <P>
          <K>Job Scheduled</K> → <K>Dirt Work</K> → <K>Dirt Work Inspection</K> → <K>Rough-In</K> → <K>Rough-In Inspection</K> → <K>Finish Work</K> → <K>Final Inspection</K> → <K>Walkthrough</K> → <K>Complete</K> → <K>Paid</K>
        </P>
        <Bullets items={[
          <>Work phases advance into their inspection when the crew marks <strong>ready for inspection</strong> on a check-in.</>,
          <>Inspections advance on the owner&apos;s <strong>PASS</strong>, or fall back to the work phase on <strong>FAIL</strong>.</>,
          <>Finish Work moves to Walkthrough when the crew reports <strong>100%</strong> and the owner answers <strong>YES</strong> to the walkthrough ask (or via Final Inspection PASS).</>,
          <>Walkthrough <strong>APPROVE</strong> completes the job; a <strong>PUNCH LIST</strong> sends it back to Finish Work.</>,
          <><strong>Mark Paid</strong> (on the job page) moves a completed job to Paid.</>,
        ]} />
        <P>
          The office can also move a job directly with the <strong>Current state</strong> dropdown on the job page. That
          manual move fires the same notifications the natural path would — moving a job into an inspection phase texts
          the owner the scheduling link; moving it into Walkthrough texts the walkthrough schedule link.
        </P>
      </>
    ),
  },
  {
    id: "jobs",
    title: "Jobs & the job page",
    body: (
      <>
        <P>
          <strong>Jobs</strong> lists every job with its state, phase progress, crew, expenses, and next office action.
          <strong> New Job</strong> needs an address and a starting state; everything else is optional.
        </P>
        <Sub>Fields worth knowing</Sub>
        <Bullets items={[
          <><strong>Crew</strong> — pick from the crew contact list (synced from Uptiq) or type names. The <strong>crew lead</strong> gets decision-outcome texts; every active crew member with an Uptiq contact gets their own daily check-in link.</>,
          <><strong>State progress %</strong> — how far the current phase is, reported by crew check-ins (it resets as the job changes phases). This is the number shown on the Jobs list and Dashboard.</>,
          <><strong>Hours</strong> — the job&apos;s running total. Crew check-ins add to it; editing the field here is the office correction path (later check-ins keep adding on top of your correction).</>,
          <><strong>Inspection / Walkthrough date &amp; time</strong> — setting or changing these syncs the appointment on the Uptiq calendar (9:00 AM or 1:00 PM window). Setting a date to today sends the owner&apos;s result ask immediately.</>,
          <><strong>Archive</strong> — takes a job out of the daily loop (and cancels its calendar appointments) without deleting anything.</>,
        ]} />
        <Sub>Check-ins drill-down</Sub>
        <P>
          The <strong>Check-ins</strong> panel lists everything the crew submitted — one row per day per crew member.
          Click a row for the notes, the parts story, and photo thumbnails (job site, receipt, parts). Thumbnails open
          full size; the links are short-lived for security, so re-open the job if a photo stops loading.
        </P>
        <Sub>Inspection result buttons</Sub>
        <P>
          While a job sits in an inspection phase, the job page shows <strong>Mark inspection passed / failed</strong> —
          the office version of the owner&apos;s PASS/FAIL text. It runs the exact same machinery, texts included.
        </P>
      </>
    ),
  },
  {
    id: "check-ins",
    title: "Daily check-ins (crew)",
    body: (
      <>
        <P>
          Every check-in day at the configured send time (Settings → Notification timing), each active crew member on
          each active, check-in-eligible job gets a text with their own link. The form captures:
        </P>
        <Bullets items={[
          <><strong>Hours worked</strong> — added to the day&apos;s log and the job total.</>,
          <><strong>Phase progress %</strong> — updates the job&apos;s state progress.</>,
          <><strong>Parts</strong> — none, a field purchase, or a supply-house order (see <a className="text-accent hover:underline" href="#parts">Parts &amp; purchasing</a>).</>,
          <><strong>Job site photos</strong>, <strong>notes / issues</strong> for the office.</>,
          <><strong>Mark this phase ready for inspection</strong> — advances the job into the phase&apos;s inspection and starts the scheduling flow. In Walkthrough, it instead re-asks the owner to review.</>,
        ]} />
        <P>
          Submitting a second check-in the same day updates that day&apos;s entry (hours add up; other fields take the
          latest values). The owner and office get a daily summary email per check-in, and a text the moment a crew
          marks a phase ready for inspection.
        </P>
        <P>
          Crew who miss their check-in show up under <strong>Overdue check-ins</strong> on the Dashboard and in the
          weekly report&apos;s coverage gaps.
        </P>
      </>
    ),
  },
  {
    id: "inspections",
    title: "Inspections",
    body: (
      <>
        <P>Each inspection text names its stage — &quot;Dirt Work Inspection&quot;, &quot;Rough-In Inspection&quot;, &quot;Final Inspection&quot; — so everyone knows which one is being scheduled or decided.</P>
        <Sub>The cycle</Sub>
        <Bullets items={[
          <><strong>1. Request</strong> — the crew marks ready for inspection (or the office moves the job into the inspection phase). The owner immediately gets a link to pick the inspection date and time window (9:00 AM / 1:00 PM); the office gets a heads-up text.</>,
          <><strong>2. Schedule</strong> — the picked date lands on the job and as an appointment on the company&apos;s Uptiq calendar. Re-picking moves the same appointment. If no date is set, the owner gets a daily nudge at the reminder hour.</>,
          <><strong>3. Inspection day</strong> — the owner gets the PASS / FAIL text (immediately, if the date was set to today). The office gets a copy without the links.</>,
          <><strong>4a. PASS</strong> — the job advances to the next phase; owner, office, and crew lead get the outcome text.</>,
          <><strong>4b. FAIL</strong> — the job falls back to the work phase, and the same page asks the owner what the inspector flagged. The crew lead gets that fix list by text. When the fixes are done, the crew marks ready for inspection again and the whole cycle restarts with a fresh date link.</>,
        ]} />
        <P>
          Office alternative: set the date &amp; time on the job page (syncs the calendar the same way) and use the
          Mark passed / failed buttons.
        </P>
      </>
    ),
  },
  {
    id: "walkthrough",
    title: "Final walkthrough",
    body: (
      <>
        <P>
          The walkthrough is the customer-facing final review, and it runs like an inspection — scheduled first, decided
          on the day.
        </P>
        <Bullets items={[
          <><strong>Entering Walkthrough</strong> (Final Inspection PASS, the owner&apos;s YES after 100%, or the office dropdown) texts the owner a link to <strong>schedule the walkthrough</strong> (date + 9:00 AM / 1:00 PM window). The appointment lands on the Uptiq calendar; an unset date gets a daily nudge.</>,
          <><strong>On the scheduled day</strong> the owner gets the ask: <strong>APPROVE / PUNCH LIST / RESCHEDULE</strong> (immediately, if the date was set to today).</>,
          <><strong>APPROVE</strong> — the job moves to Complete: the completion report snapshot is generated and the customer review request is scheduled.</>,
          <><strong>PUNCH LIST</strong> — failing the walkthrough: the owner writes the list on the same page, the job reverts to Finish Work, the walkthrough date is voided and the calendar slot cancelled, and the crew gets the list with instructions to report 100% on their daily check-in when it&apos;s done. That 100% report re-asks the owner, and a YES starts the walkthrough again with a fresh schedule link.</>,
          <><strong>RESCHEDULE</strong> — voids the date and sends the owner a fresh scheduling link.</>,
          <>If the crew marks &quot;ready for inspection&quot; while the job sits in Walkthrough, the owner is re-asked to review (APPROVE / STILL ISSUES / RESCHEDULE).</>,
        ]} />
      </>
    ),
  },
  {
    id: "parts",
    title: "Parts & purchasing",
    body: (
      <>
        <Sub>Field purchase</Sub>
        <P>
          Crew bought parts directly (counter or card): the check-in records the amount, vendor, description, receipt
          photo, and parts photo. It becomes an expense on the job, and the owner + office get a text with the photo
          links so the office can value it.
        </P>
        <Sub>Supply house — place order</Sub>
        <P>
          The crew lists the parts and the app authors the order: a PO number is minted, the supply house gets the
          formal order email (parts list, job address, pickup time, and the &quot;don&apos;t exceed&quot; cost ceiling from
          Settings), and the owner + office get a &quot;parts ordered&quot; text — all on submit.
        </P>
        <Sub>Supply house — already ordered</Sub>
        <P>
          The crew placed the order themselves: a pending-value PO is created for the office, and the supply house gets
          a <em>confirmation heads-up</em> email (explicitly not a new order) so the counter can double-check what&apos;s on
          file.
        </P>
        <Sub>Valuing POs</Sub>
        <P>
          <strong>Admin → Expenses</strong> has the PO queue: pending-value POs wait there for the office to enter the
          real cost (the Dashboard&apos;s &quot;POs need value&quot; counter tracks them). Expense rows show receipt and parts
          photo thumbnails.
        </P>
      </>
    ),
  },
  {
    id: "messaging",
    title: "Messages & timing",
    body: (
      <>
        <P>The messaging rule of thumb:</P>
        <Bullets items={[
          <><strong>Anything a person does sends its texts immediately</strong> — check-in submissions, decisions, date picks, punch lists, office state changes. Within seconds.</>,
          <><strong>Only scheduled things ride the clock</strong> — the daily check-in links (send time + days in Settings), the daily &quot;no date picked yet&quot; nudges and day-of asks (reminder hour), and the weekly report (its day + time).</>,
          <>A retry backstop sweeps anything still unsent every 15 minutes, so a temporarily failed send recovers on its own.</>,
        ]} />
        <P>
          All texts and emails go through Uptiq and appear in each contact&apos;s Uptiq conversation. Every actionable
          text names its purpose and, for inspections, its stage. Multi-choice texts list one labeled link per line
          (APPROVE: … / PUNCH LIST: …).
        </P>
      </>
    ),
  },
  {
    id: "reports",
    title: "Reports",
    body: (
      <>
        <Sub>Completion reports</Sub>
        <P>
          The moment a job reaches a billing state (Complete), a snapshot is generated: customer, crew, dates, hours,
          expenses, POs, and the check-in trail — the invoice-prep package. <strong>Reports → Completion</strong> lists
          them; the newest also renders inline on the job page.
        </P>
        <Sub>Weekly report</Sub>
        <P>
          An owner + office email digest on the configured day/time: week totals, active jobs by phase, completed jobs,
          stalled jobs, crew coverage gaps, and unlinked work, with a link to the full preview page
          (<strong>Reports → Weekly</strong>).
        </P>
        <Sub>Review requests</Sub>
        <P>
          A few days after a job completes (delay set in Settings), the customer&apos;s Uptiq contact is tagged to kick
          off the review-request flow in Uptiq.
        </P>
      </>
    ),
  },
  {
    id: "contacts",
    title: "Contacts & Uptiq sync",
    body: (
      <>
        <P>
          <strong>Admin → Contacts</strong> is the list of people the company messages: customers, crew, owner, office,
          and supply houses. Contacts are separate from app users — a contact never logs in.
        </P>
        <Bullets items={[
          <><strong>Sync with Uptiq</strong> runs one command, two steps: first every Uptiq contact tagged <K>crew</K>, <K>customer</K>, <K>owner</K>, <K>office</K>, or <K>supply house</K> is imported/updated by its tag (supply houses also land on the Supply Houses list); then any app record still missing its Uptiq link is matched by name/email/phone. It never writes to Uptiq and never removes anyone.</>,
          <>Tag people in Uptiq, then sync — that&apos;s how new crew appear in the job form&apos;s crew dropdown.</>,
          <>The <strong>owner</strong> and <strong>office</strong> pickers in Settings choose which contact receives the owner/office texts.</>,
          <><strong>Admin → Supply Houses</strong> holds the ordering details (email required — that&apos;s where POs go; pickup time and cost ceiling come from Settings).</>,
        ]} />
      </>
    ),
  },
  {
    id: "settings",
    title: "Settings",
    body: (
      <>
        <Bullets items={[
          <><strong>Company</strong> — name (the prefix on crew texts and the form headers) and timezone (all send times are local).</>,
          <><strong>Notification timing</strong> — crew check-in send time + days, inspection reminder hour, weekly report day/time, review delay days.</>,
          <><strong>Owner &amp; office</strong> — the two contacts that receive owner/office texts.</>,
          <><strong>Supply &amp; costs</strong> — default supply house, parts cost ceiling (quoted in order emails), pickup time.</>,
          <><strong>Branding</strong> — the color/logo on the crew &amp; owner form pages.</>,
          <><strong>Debug mode</strong> — reveals the testing panels (below). Keep it off day-to-day.</>,
        ]} />
      </>
    ),
  },
  {
    id: "job-states",
    title: "Job States editor",
    body: (
      <>
        <P>
          <strong>Admin → Job States</strong> defines the workflow: each state&apos;s label, color, and order, plus the
          flags that drive behavior:
        </P>
        <Bullets items={[
          <><strong>Check-ins</strong> — crew get daily check-in links while a job sits here.</>,
          <><strong>Inspection</strong> — this state runs the inspection scheduling/PASS-FAIL flow (texts carry this state&apos;s label).</>,
          <><strong>Walkthrough</strong> — this state runs the walkthrough flow.</>,
          <><strong>Billing</strong> — entering it generates the completion report and schedules the review request.</>,
          <><strong>Terminal</strong> — the end of the line (Paid).</>,
        ]} />
        <P>
          Renaming a state renames it everywhere, including the stage names in texts. The allowed movements between
          states (what PASS/FAIL/ready-for-inspection actually do) are preconfigured for the trade — changing the flow
          itself is a support task, not a Settings toggle.
        </P>
      </>
    ),
  },
  {
    id: "users",
    title: "Users, roles & login",
    body: (
      <>
        <P>
          <strong>Admin → Users</strong> manages who can open this dashboard. Roles: <strong>Owner</strong> and{" "}
          <strong>Office manager</strong> run the app day-to-day (office managers can&apos;t manage users or delete
          things); <strong>Crew</strong>/<strong>Viewer</strong> are read-only; <strong>Support admin</strong> and{" "}
          <strong>Dev super user</strong> are for the people who maintain the product.
        </P>
        <Bullets items={[
          <>Two doors, one session: the app inside <strong>Uptiq</strong> signs you in automatically; the standalone page at <K>/login</K> takes a password or an emailed magic link.</>,
          <>Admins set (and can view) a user&apos;s password from the Users page; anyone can change their own via the header&apos;s <strong>Change password</strong>.</>,
          <>Deactivating a user revokes their access immediately.</>,
        ]} />
      </>
    ),
  },
  {
    id: "debug",
    title: "Testing & debug tools",
    body: (
      <>
        <P>
          With <strong>Debug mode</strong> on (Settings), granted users see extra panels: run the scheduled sends on
          demand, preview/run the Uptiq contact sync, send a test text/email, list &amp; clear Uptiq conversation
          threads (backed up first), hard-delete test jobs, and reset accumulated test data. Access is per-tool,
          granted on the Users page.
        </P>
        <P>
          These tools never change how the app behaves for real users — they only trigger or clean up. Note that
          running a scheduled send manually near its real send time can double-text (the real run doesn&apos;t know about
          the forced one); that&apos;s expected.
        </P>
      </>
    ),
  },
  {
    id: "faq",
    title: "Quick answers",
    body: (
      <>
        <Bullets items={[
          <><strong>Why does a finished job show 0%?</strong> The percent is per-phase progress, and it resets when the job changes phases. A job sitting in Complete has no active phase to be partway through.</>,
          <><strong>A link says &quot;already used.&quot;</strong> That&apos;s the single-use protection. The flow re-sends a fresh link at its next natural step, or the office can drive the step from the job page.</>,
          <><strong>Photos stopped loading in the drill-down.</strong> Photo links are signed and short-lived (~10 minutes). Reload the job page.</>,
          <><strong>The owner didn&apos;t get a text.</strong> Check the owner contact is set in Settings and carries a real Uptiq contact. Texts appear in the contact&apos;s Uptiq conversation even when carrier delivery isn&apos;t enabled yet.</>,
          <><strong>Can I change what time the appointment is?</strong> Yes — the date &amp; time fields on the job page (9:00 AM / 1:00 PM windows) re-time the calendar appointment without re-texting anyone.</>,
          <><strong>Who hears about a supply order?</strong> The supply house (order email or confirmation heads-up), plus the owner and office when the app placed the order. The office values pending POs under Admin → Expenses.</>,
        ]} />
      </>
    ),
  },
];

export default function Docs() {
  return (
    <div className="flex h-full min-h-0">
      <nav className="hidden w-56 shrink-0 overflow-auto border-r border-border bg-card p-4 md:block">
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">App guide</div>
        <ul className="mt-2 space-y-1 text-xs">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-sm px-2 py-1 text-foreground/80 hover:bg-muted hover:text-foreground">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6 pb-16">
          <h1 className="text-sm font-semibold">Daily Burn — App guide</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            How jobs, check-ins, inspections, walkthroughs, purchasing, and messaging fit together, and what every
            admin page does.
          </p>
          <div className="mt-4 space-y-8 text-xs">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
