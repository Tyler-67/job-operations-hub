-- B6: job_scheduled (seed sort 10) had NO outgoing transition, so a job sitting
-- there could never advance via any trigger. Add the missing edge job_scheduled ->
-- dirt_work under the existing 'manual' trigger (same trigger used for complete ->
-- paid). Resolved against the single default state set by slug. Idempotent.
INSERT INTO public.job_state_transitions (state_set_id, from_state_id, to_state_id, trigger)
SELECT s_from.state_set_id, s_from.id, s_to.id, 'manual'
FROM public.job_state_sets ss
JOIN public.job_states s_from
  ON s_from.state_set_id = ss.id AND s_from.slug = 'job_scheduled'
JOIN public.job_states s_to
  ON s_to.state_set_id = ss.id AND s_to.slug = 'dirt_work'
WHERE ss.is_default = true
ON CONFLICT (state_set_id, from_state_id, trigger) DO NOTHING;
