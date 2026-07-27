-- 2026-07-27: Inspection stages -> tags (DEV tenant only; mid-stage: dirt_work + roughin).
--
-- Collapses the dedicated `dirt_work_inspection` / `roughin_inspection` states into an
-- `is_inspection` tag on the work stage itself. The work stage now carries the inspection
-- outcome edges directly: PASS advances to the next stage, FAIL stays in the same stage
-- (redo in place; applyTransition still resets progress + clears inspection_date on `fail`).
-- The `inspection_requested` edges disappear (cascade with the deleted states) — the crew's
-- "ready for inspection" check-in fires the owner date-ask in place (see forms-daily-check-in).
--
-- SCOPE: mid-stage only. The final "inspection" state (finish_work -> inspection -> walkthrough)
-- is intentionally left untouched this pass.
--
-- ROLLOUT: scoped to the "Daily Burn DEV" tenant only. Production ("Daily Burn") stays on the
-- old inspection-state model until a new stable is blessed. The engine is fully data-driven
-- (job_states.is_inspection + job_state_transitions), so one shared backend serves both models.
-- The DEV tenant is empty (0 jobs) so deleting the two states is safe (jobs FK is NO ACTION).
DO $$
DECLARE
  v_set   uuid;
  s_dirt  uuid;
  s_rough uuid;
  s_finish uuid;
BEGIN
  SELECT ss.id INTO v_set
    FROM job_state_sets ss
    JOIN locations l ON l.id = ss.location_id
   WHERE l.company_name = 'Daily Burn DEV'
   LIMIT 1;
  IF v_set IS NULL THEN
    RAISE EXCEPTION 'Daily Burn DEV state set not found — refusing to run';
  END IF;

  SELECT id INTO s_dirt   FROM job_states WHERE state_set_id = v_set AND slug = 'dirt_work';
  SELECT id INTO s_rough  FROM job_states WHERE state_set_id = v_set AND slug = 'roughin';
  SELECT id INTO s_finish FROM job_states WHERE state_set_id = v_set AND slug = 'finish_work';

  -- 1. Tag the work stages as inspection stages.
  UPDATE job_states
     SET is_inspection = true
   WHERE state_set_id = v_set AND slug IN ('dirt_work', 'roughin');

  -- 2. Delete the dedicated inspection states. The FK on job_state_transitions
  --    (from_state_id/to_state_id, ON DELETE CASCADE) removes their edges:
  --    dirt_work->dirt_work_inspection, dirt_work_inspection->{roughin,dirt_work},
  --    and the roughin equivalents.
  DELETE FROM job_states
   WHERE state_set_id = v_set AND slug IN ('dirt_work_inspection', 'roughin_inspection');

  -- 3. Wire the inspection outcomes directly onto the work stages:
  --    PASS -> next stage, FAIL -> same stage (redo in place).
  INSERT INTO job_state_transitions (state_set_id, from_state_id, to_state_id, trigger) VALUES
    (v_set, s_dirt,  s_rough,  'pass'),
    (v_set, s_dirt,  s_dirt,   'fail'),
    (v_set, s_rough, s_finish, 'pass'),
    (v_set, s_rough, s_rough,  'fail')
  ON CONFLICT (state_set_id, from_state_id, trigger)
    DO UPDATE SET to_state_id = EXCLUDED.to_state_id;
END $$;
