-- Inspection-as-a-tag: the work stage itself is the inspection phase, so "ready for inspection /
-- being inspected" needs a marker on the JOB (in the old model the dedicated inspection STATE was
-- the marker). Set when an inspection cycle is requested (crew ready check-in, the office
-- Request-inspection toggle on the job page, or an office state-move into a tagged stage);
-- cleared when the cycle ends (PASS/FAIL transition, office cancel, or any state change).
-- NULL = no active request. The UI treats "requested OR a scheduled inspection_date" as active.
alter table public.jobs
  add column if not exists inspection_requested_at timestamptz;
