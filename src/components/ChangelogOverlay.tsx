import { useEffect, useState } from "react";
import { APP_VERSION, CHANGELOG, changelogEnabled, lastSeenVersion, markChangelogSeen } from "@/lib/changelog";

// Shows the latest changelog once, on a user's first boot of a new version. "Seen" is tracked in
// localStorage (per browser, per version), so a returning user only sees it again after the next
// version bump. Self-contained: mount it once inside the app shell. Dismiss marks the version seen.
export function ChangelogOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!changelogEnabled() || !APP_VERSION) return;
    if (lastSeenVersion() !== APP_VERSION) setOpen(true);
  }, []);

  if (!open) return null;
  const entry = CHANGELOG[0];
  if (!entry) return null;

  const dismiss = () => {
    markChangelogSeen(APP_VERSION);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={dismiss}>
      <div
        className="w-full max-w-md rounded-md border border-border bg-card p-5 text-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="pill bg-accent/10 text-accent">What&rsquo;s new</span>
          <span className="text-2xs text-muted-foreground">{entry.date}</span>
        </div>
        <h2 className="text-sm font-semibold">{entry.title}</h2>
        <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {entry.changes.map((change, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{change}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-8 items-center rounded-sm bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
