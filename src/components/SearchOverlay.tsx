// Live search overlay driven by the sidebar's search input. Appears centered over the
// working area (right of the sidebar, below the header) and updates as the user types.
// Reuses the shared fetch + result markup from GlobalSearch.
import { useEffect, useState } from "react";
import { searchAll, searchResultCount, SearchResultsView, type SearchResults } from "@/components/GlobalSearch";

export default function SearchOverlay({ query, onClose }: { query: string; onClose: () => void }) {
  const [data, setData] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = query.trim();

  // Debounced live search: 250ms after the last keystroke. Below 2 chars we show a hint
  // instead of querying (matches the edge fn's minimum).
  useEffect(() => {
    if (trimmed.length < 2) { setData(null); setError(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchAll(trimmed)
        .then((r) => { if (active) { setData(r); setError(null); } })
        .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Search failed"); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [trimmed]);

  // Escape closes (clears the sidebar input via onClose).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = data ? searchResultCount(data) : 0;

  return (
    // Covers the working screen only (sidebar = 220px, header = 44px), so the search input
    // stays visible and usable while results show. Backdrop click closes.
    <div
      className="fixed bottom-0 left-[220px] right-0 top-[44px] z-40 flex items-start justify-center bg-black/20 p-6"
      onClick={onClose}
    >
      {/* items-start anchors the card's top a fixed distance below the header, so the typing
          window stays put while results populate/shrink beneath it (it grows downward and
          scrolls internally rather than re-centering). */}
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-2xs uppercase tracking-wider text-muted-foreground">
          <span>Search{trimmed ? `: "${trimmed}"` : ""}</span>
          <span>{loading ? "searching…" : data ? `${total} result${total === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-xs">
          {trimmed.length < 2 && (
            <div className="p-6 text-center text-muted-foreground">Type at least 2 characters to search.</div>
          )}
          {error && <div className="px-3 py-2 text-destructive">{error}</div>}
          {trimmed.length >= 2 && data && total === 0 && !loading && (
            <div className="p-6 text-center text-muted-foreground">No results for “{trimmed}”.</div>
          )}
          {trimmed.length >= 2 && data && total > 0 && (
            <div className="divide-y divide-border">
              <SearchResultsView data={data} compact onNavigate={onClose} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
