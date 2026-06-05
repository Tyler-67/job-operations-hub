ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS uptiq_company_id TEXT;
