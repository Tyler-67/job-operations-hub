/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /job-photos
//   { action: "upload_url", token, kind, content_type }
//       Crew, token-gated. Validates (does NOT consume) the daily_check_in action
//       token, then returns a short-lived signed URL the form PUTs the file to,
//       plus the storage path to submit with the check-in.
//   { action: "read_urls", paths: string[] }
//       Owner/office, app-session-gated. Returns signed read URLs only for photos
//       whose job belongs to the caller's location.
//
// The bucket is private; signed URLs are the only access path. Uploads are scoped
// to one object path so a leaked token can't list or overwrite other photos.
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";
import { hashActionToken, resolveActionSecret } from "../_shared/action-tokens.ts";
import { buildPhotoPath, jobIdFromPath, PHOTO_BUCKET } from "../_shared/photos.ts";

const CHECK_IN_ACTION = "daily_check_in";
const UPLOAD_URL_TTL = 60 * 5; // signed upload URL valid 5 min
const READ_URL_TTL = 60 * 10; // signed read URL valid 10 min

// Validates the token WITHOUT consuming it — crews upload several photos before the
// single-use token is spent at check-in submit.
async function validateToken(sb: any, token: string) {
  const hash = await hashActionToken(token, resolveActionSecret());
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("action_tokens")
    .select("job_id, contact_id")
    .eq("token_hash", hash)
    .eq("action", CHECK_IN_ACTION)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function handleUploadUrl(sb: any, body: Record<string, unknown>) {
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "missing_token" }, 400);

  const claim = await validateToken(sb, token);
  if (!claim) return json({ error: "invalid_or_expired" }, 410);
  if (!claim.job_id) return json({ error: "token_not_bound" }, 422);

  let path: string;
  try {
    path = buildPhotoPath(claim.job_id as string, body.kind, body.content_type, crypto.randomUUID());
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "invalid_path" }, 400);
  }

  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return json({ ok: true, path, signed_url: data.signedUrl, token: data.token, expires_in: UPLOAD_URL_TTL });
}

async function handleReadUrls(sb: any, body: Record<string, unknown>, locationId: string) {
  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (!paths.length) return json({ ok: true, urls: {} });

  // Only sign paths whose job belongs to the caller's location.
  const jobIds = [...new Set(paths.map(jobIdFromPath).filter((id): id is string => id !== null))];
  const { data: jobs, error: jobsErr } = await sb
    .from("jobs")
    .select("id")
    .eq("location_id", locationId)
    .in("id", jobIds);
  if (jobsErr) throw jobsErr;
  const allowedJobs = new Set((jobs ?? []).map((j: any) => j.id as string));

  const urls: Record<string, string | null> = {};
  for (const path of paths) {
    const jobId = jobIdFromPath(path);
    if (!jobId || !allowedJobs.has(jobId)) {
      urls[path] = null;
      continue;
    }
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, READ_URL_TTL);
    urls[path] = error ? null : data.signedUrl;
  }
  return json({ ok: true, urls });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = serviceClient();

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "upload_url") {
      return await handleUploadUrl(sb, body);
    }

    if (action === "read_urls") {
      const claims = await verifySession(req.headers.get("x-app-session"));
      if (!claims) return json({ error: "unauthorized" }, 401);
      return await handleReadUrls(sb, body, claims.loc as string);
    }

    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
