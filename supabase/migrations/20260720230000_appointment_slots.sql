-- The chosen time-of-day window for a job's inspection / walkthrough appointment ("9am" | "1pm").
-- Stored on the job so EVERY calendar re-sync (owner SMS form, office job form, date-only changes)
-- keeps the picked time instead of snapping back to the default morning window — before this, the
-- slot lived only in the submitting request, so an office date change re-timed the Uptiq event to
-- 9am no matter what the owner had chosen.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS inspection_slot TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS walkthrough_slot TEXT;

COMMENT ON COLUMN public.jobs.inspection_slot IS 'Appointment window for the inspection date ("9am" | "1pm"); app-enforced values.';
COMMENT ON COLUMN public.jobs.walkthrough_slot IS 'Appointment window for the walkthrough date ("9am" | "1pm"); app-enforced values.';
