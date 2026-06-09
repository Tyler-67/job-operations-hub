// Pure helpers for the walkthrough punch-list form: normalize the owner's free-text
// submission and format the dated line appended to jobs.notes. No Deno/remote imports,
// so the validation + formatting are unit-testable under vitest. Mirrors fix-details.ts,
// kept separate so the appended label ("Walkthrough punch list") stays distinct.

export interface PunchListInput {
  // The owner's list of items still to fix before approval; null when blank/missing.
  details: string | null;
}

export function normalizePunchListInput(body: Record<string, unknown>): PunchListInput {
  const raw = typeof body.details === "string" ? body.details.trim() : "";
  return { details: raw.length > 0 ? raw : null };
}

// Appends a dated punch-list line to the job's running notes, preserving prior notes.
export function appendPunchListNote(existing: string | null, dateStr: string, details: string): string {
  const line = `[${dateStr}] Walkthrough punch list: ${details}`;
  const prior = (existing ?? "").trim();
  return prior ? `${prior}\n${line}` : line;
}
