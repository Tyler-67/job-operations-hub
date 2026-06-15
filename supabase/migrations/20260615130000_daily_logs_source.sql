-- PAR-5: distinguish quick-log (SMS LOG-keyword) daily_logs from structured daily check-ins.
-- daily_logs previously had NO column separating the two; both forms write identical shapes.
-- source = 'quick_log' (quick-log path) vs 'check_in' (daily check-in) vs NULL (legacy rows).
ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS source TEXT;
-- Speeds the weekly report's per-period quick-log scan (Unlinked Work This Week).
CREATE INDEX IF NOT EXISTS daily_logs_source_logdate_idx
  ON public.daily_logs(source, log_date) WHERE source = 'quick_log';
