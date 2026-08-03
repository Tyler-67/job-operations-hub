import { useEffect, useRef } from "react";

// Keeps a page's data fresh without the user hitting refresh.
//
// Every read in this app goes through an edge function with the custom x-app-session header
// (iframe users have no Supabase Auth JWT), so Supabase Realtime/postgres_changes isn't
// available to the client — RLS denies anon on the ops tables by design. Polling is the
// pragmatic equivalent: re-run `refresh` on an interval WHILE THE TAB IS VISIBLE, and
// immediately when the tab or window regains focus, so anything that landed while the user
// was elsewhere shows up the moment they look back.
//
// A hidden tab polls nothing, so a dashboard left open overnight costs zero requests.

const DEFAULT_INTERVAL_MS = 30_000;
// Rapid alt-tabbing shouldn't fire a request per focus event.
const MIN_GAP_MS = 5_000;

export function useAutoRefresh(refresh: () => void, intervalMs = DEFAULT_INTERVAL_MS) {
  // Keep the newest callback without restarting the timer on every render.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let timer: number | undefined;
    let lastRun = Date.now();

    const run = () => { lastRun = Date.now(); latest.current(); };
    const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const start = () => { stop(); timer = window.setInterval(run, intervalMs); };

    function onActive() {
      if (document.hidden) { stop(); return; }
      // Catch up on whatever arrived while we were away, then resume the cadence.
      if (Date.now() - lastRun >= MIN_GAP_MS) run();
      start();
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [intervalMs]);
}
