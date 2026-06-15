-- Lock down public.weekly_reports.
-- It was created (20260609150000_weekly_reports.sql) AFTER the blanket anon REVOKE in
-- 20260607150706_lock_down_direct_table_reads.sql, so that REVOKE never covered it. The
-- weekly_reports migration then re-GRANTed SELECT to anon/authenticated and added a
-- permissive "USING (true)" policy, leaving every snapshot (addresses + $ estimates)
-- world-readable via the public anon key shipped in the frontend bundle.
-- Reads legitimately go through the session-gated `weekly-reports` edge function using the
-- service-role client, which bypasses RLS — so removing anon access breaks nothing.

REVOKE SELECT ON public.weekly_reports FROM anon, authenticated;
DROP POLICY IF EXISTS "weekly_reports readable" ON public.weekly_reports;
