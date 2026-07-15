-- Store the Uptiq (LeadConnector) calendar appointment id created for a job's inspection.
-- Lets a re-scheduled inspection UPDATE the same calendar event instead of creating a duplicate,
-- and gives an audit trail of which jobs made it onto the inspections calendar. Nullable: a job
-- has no appointment until an inspection date is set with a configured calendar + owner contact.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS inspection_appointment_id TEXT;
