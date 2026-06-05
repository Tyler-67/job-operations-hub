CREATE TABLE IF NOT EXISTS public.company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE CASCADE,
  owner_name TEXT,
  owner_contact_id TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  office_contact_id TEXT,
  office_phone TEXT,
  office_email TEXT,
  check_in_send_time TIME NOT NULL DEFAULT '15:00',
  check_in_weekdays INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  inspection_reminder_time TIME NOT NULL DEFAULT '08:00',
  weekly_report_day INT NOT NULL DEFAULT 5,
  weekly_report_time TIME NOT NULL DEFAULT '15:00',
  review_request_delay_days INT NOT NULL DEFAULT 4,
  default_supply_house_contact_id UUID REFERENCES public.supply_house_contacts(id) ON DELETE SET NULL,
  parts_cost_ceiling NUMERIC(12,2) NOT NULL DEFAULT 500,
  supply_house_pickup_time TEXT,
  inspections_calendar_id TEXT,
  daily_checkin_form_id TEXT,
  inspection_date_form_id TEXT,
  inspection_fix_form_id TEXT,
  walkthrough_punch_list_form_id TEXT,
  brand_primary_color TEXT NOT NULL DEFAULT '#0f172a',
  brand_secondary_color TEXT NOT NULL DEFAULT '#0ea5e9',
  brand_font TEXT NOT NULL DEFAULT 'Inter',
  brand_logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_locations_updated ON public.locations;
CREATE TRIGGER trg_locations_updated
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT ALL ON public.company_settings TO service_role;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_settings service only" ON public.company_settings;
CREATE POLICY "company_settings service only" ON public.company_settings FOR ALL USING (false);

DROP TRIGGER IF EXISTS trg_company_settings_updated ON public.company_settings;
CREATE TRIGGER trg_company_settings_updated
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.company_settings (location_id, owner_name, owner_email, office_email, supply_house_pickup_time)
SELECT id, 'Owner', NULL, NULL, '7AM'
FROM public.locations
ON CONFLICT (location_id) DO NOTHING;