import { callEdge } from "@/lib/session";

// Short-lived signed read URLs for private job-photo storage paths (receipt / parts / job-site).
// Session-gated; the job-photos fn only signs paths whose job is in the caller's location.
// URLs expire (~10 min) — fetch them when the view loads.
export async function fetchPhotoReadUrls(paths: Array<string | null | undefined>): Promise<Record<string, string | null>> {
  const clean = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
  if (!clean.length) return {};
  const res = (await callEdge("job-photos", { method: "POST", body: { action: "read_urls", paths: clean } })) as unknown as {
    urls?: Record<string, string | null>;
  };
  return res.urls ?? {};
}

// A stored photo path is a PDF (receipt scans can be PDF) — render as a link, not an <img>.
export function isPdfPath(path: string | null | undefined): boolean {
  return typeof path === "string" && /\.pdf(\?|$)/i.test(path);
}
