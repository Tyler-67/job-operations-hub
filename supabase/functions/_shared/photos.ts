// Pure helpers for job-photo storage paths and content types. No Deno or remote
// imports so the path/mime rules are unit-testable under vitest. The job-photos
// edge function does the signed-URL I/O; everything here is deterministic.

export const PHOTO_BUCKET = "job-photos";

// Which slot a photo fills on a daily check-in. Used as the second path segment.
export const ALLOWED_PHOTO_KINDS = ["receipt", "parts", "job_site"] as const;
export type PhotoKind = (typeof ALLOWED_PHOTO_KINDS)[number];

// Accepted uploads: phone camera formats + PDF receipts. Maps mime → file extension.
const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export function isAllowedKind(kind: unknown): kind is PhotoKind {
  return typeof kind === "string" && (ALLOWED_PHOTO_KINDS as readonly string[]).includes(kind);
}

export function extensionForContentType(contentType: unknown): string | null {
  if (typeof contentType !== "string") return null;
  return CONTENT_TYPE_EXT[contentType.toLowerCase().trim()] ?? null;
}

// Storage object path for one upload: `${jobId}/${kind}/${uuid}.${ext}`.
// Throws on an invalid kind or unsupported content type so the function can 400.
export function buildPhotoPath(
  jobId: string,
  kind: unknown,
  contentType: unknown,
  uuid: string,
): string {
  if (!jobId) throw new Error("missing_job");
  if (!isAllowedKind(kind)) throw new Error("invalid_kind");
  const ext = extensionForContentType(contentType);
  if (!ext) throw new Error("unsupported_content_type");
  return `${jobId}/${kind}/${uuid}.${ext}`;
}

// First path segment is the job id. Used to authorize reads against the caller's
// location before signing a URL. Returns null for a malformed path.
export function jobIdFromPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const segment = path.split("/")[0]?.trim();
  return segment ? segment : null;
}
