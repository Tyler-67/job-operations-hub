-- Weekly report snapshots. The weekly-report cron assembles a per-location summary of the
-- week (active jobs by phase, completed this week, stalled jobs, totals) and stores it here
-- as one JSONB snapshot per location per week. The owner gets an email digest linking to the
-- preview page, which reads the latest snapshot back. UNIQUE(location_id, period_start) makes
-- a re-fire idempotent: the cron upserts the same period row rather than duplicating it.
CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, period_start)
);
CREATE INDEX IF NOT EXISTS weekly_reports_location_period_idx
  ON public.weekly_reports(location_id, period_start DESC);
GRANT SELECT ON public.weekly_reports TO authenticated, anon;
GRANT ALL ON public.weekly_reports TO service_role;
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weekly_reports readable" ON public.weekly_reports FOR SELECT USING (true);
CREATE TRIGGER trg_weekly_reports_updated BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
