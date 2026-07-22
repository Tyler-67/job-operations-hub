-- Two-channel / two-instance support (2026-07-22)
-- 1) Per-instance frontend base URL: minted SMS/form links for a tenant open ITS app
--    (null = fall back to the APP_BASE_URL edge secret, i.e. the production app).
-- 2) Per-instance Uptiq SYNC target: lets a tenant's contact pull + calendar sync address a
--    different GHL location than its (unique) iframe binding. Used by the Development
--    instance, whose iframe binding is synthetic but whose "Sync with Uptiq" should hit the
--    real staging GHL location on demand.
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS app_base_url TEXT;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS uptiq_sync_location_id TEXT;

COMMENT ON COLUMN public.locations.app_base_url IS
  'Frontend origin for links minted for this tenant; null = APP_BASE_URL env (production app).';
COMMENT ON COLUMN public.locations.uptiq_sync_location_id IS
  'GHL location id used by contact pull + calendar sync when it differs from the iframe binding (uptiq_location_id). Null = use uptiq_location_id.';

-- Seed the Development instance (idempotent; every block no-ops when its row already exists).
DO $dev$
DECLARE
  v_prod_loc UUID;
  v_dev_loc UUID;
  v_prod_set UUID;
  v_dev_set UUID;
BEGIN
  SELECT id INTO v_prod_loc FROM public.locations WHERE uptiq_location_id = 'JrBcbFAsvPtRlR0UfaLj';
  IF v_prod_loc IS NULL THEN
    RAISE NOTICE 'prod location not found; skipping dev-instance seed';
    RETURN;
  END IF;

  SELECT id INTO v_dev_loc FROM public.locations WHERE uptiq_location_id = 'DEV-INTERNAL-1';
  IF v_dev_loc IS NULL THEN
    INSERT INTO public.locations
      (uptiq_location_id, company_name, timezone, uptiq_company_id, app_base_url, uptiq_sync_location_id)
    SELECT 'DEV-INTERNAL-1', 'Daily Burn DEV', l.timezone, l.uptiq_company_id,
           'https://job-operations-hub-dev.vercel.app', l.uptiq_location_id
    FROM public.locations l WHERE l.id = v_prod_loc
    RETURNING id INTO v_dev_loc;
  END IF;

  INSERT INTO public.company_settings (location_id, supply_house_pickup_time, debug_mode)
  VALUES (v_dev_loc, '7AM', TRUE)
  ON CONFLICT (location_id) DO NOTHING;

  -- State machine: clone the LIVE prod default set once (10 states + all transitions,
  -- ids remapped through slugs so the clone always matches current prod behavior).
  SELECT id INTO v_dev_set FROM public.job_state_sets
    WHERE location_id = v_dev_loc AND is_default = TRUE LIMIT 1;
  IF v_dev_set IS NULL THEN
    SELECT id INTO v_prod_set FROM public.job_state_sets
      WHERE location_id = v_prod_loc AND is_default = TRUE LIMIT 1;
    IF v_prod_set IS NULL THEN
      RAISE NOTICE 'prod default state set not found; skipping state clone';
      RETURN;
    END IF;

    INSERT INTO public.job_state_sets (location_id, name, is_default)
    SELECT v_dev_loc, s.name, TRUE FROM public.job_state_sets s WHERE s.id = v_prod_set
    RETURNING id INTO v_dev_set;

    INSERT INTO public.job_states
      (state_set_id, slug, label, sort_order, color, is_terminal, is_inspection,
       is_walkthrough, is_billing, allow_check_ins, active)
    SELECT v_dev_set, st.slug, st.label, st.sort_order, st.color, st.is_terminal, st.is_inspection,
           st.is_walkthrough, st.is_billing, st.allow_check_ins, st.active
    FROM public.job_states st WHERE st.state_set_id = v_prod_set;

    INSERT INTO public.job_state_transitions (state_set_id, from_state_id, to_state_id, trigger, conditions)
    SELECT v_dev_set, f2.id, t2.id, tr.trigger, tr.conditions
    FROM public.job_state_transitions tr
    JOIN public.job_states f1 ON f1.id = tr.from_state_id
    JOIN public.job_states t1 ON t1.id = tr.to_state_id
    JOIN public.job_states f2 ON f2.state_set_id = v_dev_set AND f2.slug = f1.slug
    JOIN public.job_states t2 ON t2.state_set_id = v_dev_set AND t2.slug = t1.slug
    WHERE tr.state_set_id = v_prod_set;
  END IF;
END
$dev$;
