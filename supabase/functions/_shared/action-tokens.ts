/* eslint-disable @typescript-eslint/no-explicit-any */
// Mint + hash single-use action tokens for signed crew/owner links.
// The consume side (action-token-consume) imports hashActionToken from here so the
// mint and consume hashing can never drift. No Deno/remote imports, so the hashing
// contract and link builder are unit-testable under vitest.

const DEFAULT_ACTION_SECRET = "dev-action-secret-change-me";

// Reads the env secret when running inside an edge function (Deno); tests and the
// browser never call this, they pass the secret explicitly.
export function resolveActionSecret(): string {
  const denoEnv = (globalThis as any).Deno?.env;
  return denoEnv?.get?.("ACTION_TOKEN_SECRET") ?? DEFAULT_ACTION_SECRET;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Single source of truth for the stored token hash. Must match what consume looks up.
export function hashActionToken(token: string, secret: string): Promise<string> {
  return sha256Hex(`${token}.${secret}`);
}

// 32 random bytes as hex — unguessable, URL-safe.
export function generateActionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildActionLink(appBaseUrl: string, path: string, token: string): string {
  const base = appBaseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}?token=${encodeURIComponent(token)}`;
}

export interface MintActionTokenOptions {
  action: string;
  payload?: Record<string, unknown>;
  jobId?: string | null;
  contactId?: string | null;
  ttlSeconds?: number;
  secret?: string;
  // Groups the options of ONE multi-link text (PASS+FAIL, APPROVE+PUNCH+RESCHEDULE, YES+NO).
  // Consuming any token of a batch burns its unused siblings (see action-decision), so a
  // leftover link from an answered text reads "already used" instead of acting later.
  // Single-link mints leave it null.
  batchId?: string | null;
}

export interface MintedActionToken {
  token: string;
  id: string;
  expiresAt: string;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Generates a token, stores only its hash, and returns the raw token for the link.
export async function mintActionToken(sb: any, opts: MintActionTokenOptions): Promise<MintedActionToken> {
  const secret = opts.secret ?? resolveActionSecret();
  const token = generateActionToken();
  const tokenHash = await hashActionToken(token, secret);
  const expiresAt = new Date(Date.now() + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000).toISOString();

  const row: Record<string, unknown> = {
    token_hash: tokenHash,
    action: opts.action,
    payload: opts.payload ?? {},
    job_id: opts.jobId ?? null,
    contact_id: opts.contactId ?? null,
    expires_at: expiresAt,
    batch_id: opts.batchId ?? null,
  };

  const { data, error } = await sb.from("action_tokens").insert(row).select("id").single();
  if (error) throw error;
  return { token, id: data.id, expiresAt };
}
