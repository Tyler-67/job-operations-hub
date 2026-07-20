-- Walkthrough punch list = FAIL (per Tyler, 2026-07-20): tapping PUNCH LIST (or STILL
-- ISSUES) on the walkthrough ask now REVERTS the job to the previous work phase — exactly
-- like an inspection FAIL — instead of leaving it parked in walkthrough. The crew works the
-- list under normal daily check-ins there; reporting 100% re-runs the standard forward path
-- (finish_walkthrough ask -> owner YES -> walkthrough -> a fresh schedule link). Add the
-- missing edge walkthrough -> finish_work under the existing 'fail' trigger (the decision
-- registry maps walkthrough_punch_list / walkthrough_still_issues onto it). Resolved
-- against the default state set by slug; sets without both slugs are untouched (the
-- decisions stay acknowledge-only there — resolveTransition simply finds no edge). Idempotent.
INSERT INTO public.job_state_transitions (state_set_id, from_state_id, to_state_id, trigger)
SELECT s_from.state_set_id, s_from.id, s_to.id, 'fail'
FROM public.job_state_sets ss
JOIN public.job_states s_from
  ON s_from.state_set_id = ss.id AND s_from.slug = 'walkthrough'
JOIN public.job_states s_to
  ON s_to.state_set_id = ss.id AND s_to.slug = 'finish_work'
WHERE ss.is_default = true
ON CONFLICT (state_set_id, from_state_id, trigger) DO NOTHING;
