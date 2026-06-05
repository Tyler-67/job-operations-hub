ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS daily_checkin_form_id,
  DROP COLUMN IF EXISTS inspection_date_form_id,
  DROP COLUMN IF EXISTS inspection_fix_form_id,
  DROP COLUMN IF EXISTS walkthrough_punch_list_form_id;
