ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_source TEXT,
  ADD COLUMN IF NOT EXISTS paid_by_app_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_event_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_paid_source_check'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_paid_source_check
      CHECK (paid_source IS NULL OR paid_source IN ('quickbooks', 'uptiq_invoice', 'manual'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS jobs_location_invoice_id_idx
  ON public.jobs(location_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_location_invoice_number_idx
  ON public.jobs(location_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_location_payment_event_id_unique
  ON public.jobs(location_id, payment_event_id)
  WHERE payment_event_id IS NOT NULL;
