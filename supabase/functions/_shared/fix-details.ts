// Pure helpers for the inspection fix-details form: normalize the owner's free-text
// submission and format the dated line appended to jobs.notes. No Deno/remote imports,
// so the validation + formatting are unit-testable under vitest.

export interface FixDetailsInput {
  // The owner's description of what the inspector flagged; null when blank/missing.
  details: string | null;
}

export function normalizeFixDetailsInput(body: Record<string, unknown>): FixDetailsInput {
  const raw = typeof body.details === "string" ? body.details.trim() : "";
  return { details: raw.length > 0 ? raw : null };
}

// Appends a dated fix-details line to the job's running notes, preserving prior notes.
export function appendFixDetailsNote(existing: string | null, dateStr: string, details: string): string {
  const line = `[${dateStr}] Inspection fixes: ${details}`;
  const prior = (existing ?? "").trim();
  return prior ? `${prior}\n${line}` : line;
}
