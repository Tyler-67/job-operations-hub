import { useState } from "react";
import { callEdge, getSessionToken } from "@/lib/session";

export default function SearchPage() {
  const [q, setQ] = useState(""); const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        "x-app-session": getSessionToken() ?? "",
      }});
      setData(await res.json());
    } finally { setLoading(false); }
  }
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Search jobs, contacts, POs, expenses…"
          className="h-9 flex-1 rounded-sm border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring" />
        <button onClick={run} className="rounded-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">Search</button>
      </div>
      {loading && <div className="text-xs text-muted-foreground">Searching…</div>}
      {data && (
        <div className="grid grid-cols-2 gap-4 text-xs">
          {(["jobs", "contacts", "pos", "expenses"] as const).map((k) => (
            <div key={k} className="rounded-sm border border-border bg-card">
              <div className="border-b border-border bg-muted px-2 py-1 text-2xs uppercase tracking-wider text-muted-foreground">
                {k} ({data[k]?.length ?? 0})
              </div>
              <ul className="divide-y divide-border">
                {(data[k] ?? []).map((row: any) => (
                  <li key={row.id} className="px-2 py-1.5">{JSON.stringify(row).slice(0, 120)}</li>
                ))}
                {(data[k] ?? []).length === 0 && <li className="px-2 py-3 text-center text-muted-foreground">no results</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
