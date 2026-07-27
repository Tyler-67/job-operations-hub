// Curated app changelog for the STABLE release. This is a running list of the real, user-facing
// changes made since the last stable build. Keep APPENDING bullets to the top entry's `changes`
// as we ship — this list accumulates until we're ready to promote to stable. `APP_VERSION` tracks
// the top entry's `version`, and ChangelogOverlay shows it once per user per version (localStorage).
// None of this reaches the stable app yet: changelogEnabled/STABLE_ONLY (below) keeps it on dev only.
//
// Keep bullets short and user-facing (what an owner/office user would notice) — not internal/dev
// plumbing. On promotion: flip STABLE_ONLY to true and finalize the top entry's version + date;
// start the next cycle by adding a fresh entry above it.

export interface ChangelogEntry {
  version: string; // stable id used for "has this user seen it?" — newest entry first
  date: string; // human-friendly display date
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2026-07-27",
    date: "Updated July 27, 2026",
    title: "Redesigned workspace, reports & configurable inspections",
    changes: [
      "Redesigned navigation - a grouped sidebar (Dashboard, Jobs, Billing, Configuration) with a global search that opens a live overlay from the top of the sidebar.",
      "Cleaner Dashboard and Jobs pages - at-a-glance counts on the column headers, plus subtle table gridlines.",
      "Reports - weekly and completion reports combined into one page grouped by week; expand a completed job to see its expenses.",
      "Expenses & POs - an editable pane to set the estimate, final amount, and sent status independently.",
      "Settings organized into tabs (Company, Notifications, Supply & Costs, Branding), with diagnostics on a separate Debug tab.",
      "Job States - delete archived stages, show or hide archived, and set each stage's next stage on pass and on fail.",
      "Inspections are now a tag on a work stage instead of a separate stage - fewer stages, with an inspection tag shown on Jobs and the Dashboard.",
      "Daily check-in - enter an estimated cost when ordering from a supply house.",
      "Inspection and walkthrough appointments keep their chosen time, and the office can set it.",
      "Progress shown as a single state % throughout the app.",
      "New in-app App guide (sidebar footer) documenting every flow.",
    ],
  },
];

// The newest entry's version — what a fresh boot compares the user's last-seen version against.
export const APP_VERSION = CHANGELOG[0]?.version ?? "";

// WHERE the changelog shows. For now it shows wherever this build runs — in practice that's the DEV
// app, since production is pinned to an older build without this code. Later, flip STABLE_ONLY to
// true so the changelog only appears on the production host (stable), per the plan.
const STABLE_ONLY = false;
const PROD_HOST = "job-operations-hub.vercel.app";
export function changelogEnabled(): boolean {
  if (!STABLE_ONLY) return true;
  return typeof window !== "undefined" && window.location.hostname === PROD_HOST;
}

// Per-browser record of the last changelog version the user acknowledged. Guarded so a blocked
// localStorage (private mode) never throws — it just means the overlay may show again.
const SEEN_KEY = "changelog_seen_version";
export function lastSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
export function markChangelogSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* ignore — a non-persistent dismiss is fine */
  }
}
