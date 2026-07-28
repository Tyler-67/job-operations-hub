// Shared input-validation primitives (were copy-pasted across ~9 edge functions).

export function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

// Canonical email cleaner. THROWS "invalid_email" on a malformed (non-empty) address; returns
// null only for an empty/absent value. (Previously users/index.ts returned null on malformed,
// silently dropping a mistyped email — a same-name/different-behavior trap. Behavior is preserved
// there: users already threw invalid_email on the null result.)
export function cleanEmail(value: unknown): string | null {
  const email = cleanText(value)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");
  return email;
}

export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// True when a DB error is a unique/duplicate-key violation (treat a racing insert as a no-op).
// Lives here (a pure, remote-import-free module) so state-machine.ts can share it without
// breaking its vitest loader — util.ts pulls in the remote supabase-js client.
export function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}
