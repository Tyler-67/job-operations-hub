-- Private Storage bucket for crew check-in photos (receipts, parts, job-site shots)
-- and PDF receipts. Nothing here is publicly readable: the browser uploads and reads
-- only through short-lived signed URLs minted by the job-photos edge function using
-- the service-role key, matching the rest of the app (no direct anon/authenticated
-- Storage access). 15 MB cap covers full-resolution phone photos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  false,
  15728640,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS on storage.objects stays enabled with NO anon/authenticated policies for this
-- bucket, so the only access path is a signed URL. service_role bypasses RLS.
