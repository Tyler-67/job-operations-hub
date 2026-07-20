-- Walkthrough scheduling parity with inspections (2026-07-20, per Tyler):
-- entering walkthrough texts the owner a date-picker link; the chosen date lands here and
-- syncs to the Uptiq calendar (appointment id stored so a re-set updates the same event);
-- on that day the owner gets the APPROVE / PUNCH LIST ask. Mirrors
-- jobs.inspection_date / jobs.inspection_appointment_id exactly.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS walkthrough_date DATE;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS walkthrough_appointment_id TEXT;
