// Curated app changelog. To announce a release, ADD a new entry at the TOP with a fresh `version`
// (a date or semver — it just has to be unique and newer). `APP_VERSION` tracks the newest entry,
// and ChangelogOverlay shows that entry once per user per version (tracked in localStorage). Keep
// each entry short and user-facing — this is what everyone sees on their first boot of a new build.

export interface ChangelogEntry {
  version: string; // stable id used for "has this user seen it?" — newest entry first
  date: string; // human-friendly display date
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2026-07-27",
    date: "July 27, 2026",
    title: "Inspections, Job States & debugging",
    changes: [
      "Inspections are now a tag on a work stage instead of a separate stage — fewer stages to manage.",
      "Job States: permanently delete archived stages, and pick each stage's next stage per outcome (on pass / on fail).",
      "Jobs and the Dashboard show an inspection tag right next to the stage name.",
      "Daily check-in: add an estimated cost when ordering from a supply house.",
      "Debug: a message log of everything sent, grouped by contact.",
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
