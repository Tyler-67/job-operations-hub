
-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('owner_admin','office_manager','crew','viewer','support_admin');
CREATE TYPE public.po_status AS ENUM ('draft','sent','pending_value','valued','cancelled');
CREATE TYPE public.notif_status AS ENUM ('pending','sent','failed','cancelled');
CREATE TYPE public.notif_channel AS ENUM ('sms','email','task','tag','webhook');

-- ========== HELPERS ==========
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ========== LOCATIONS / CONTACTS ==========
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uptiq_location_id TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locations TO authenticated, anon;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locations readable" ON public.locations FOR SELECT USING (true);

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  uptiq_contact_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT, -- 'customer','crew','owner','office','supply_house','other'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.contacts(location_id);
CREATE INDEX ON public.contacts(uptiq_contact_id);
GRANT SELECT ON public.contacts TO authenticated, anon;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts readable" ON public.contacts FOR SELECT USING (true);
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.supply_house_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rep_name TEXT,
  email TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.supply_house_contacts TO authenticated, anon;
GRANT ALL ON public.supply_house_contacts TO service_role;
ALTER TABLE public.supply_house_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supply_houses readable" ON public.supply_house_contacts FOR SELECT USING (true);

-- ========== APP USERS / SESSIONS ==========
CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  role public.app_role NOT NULL DEFAULT 'viewer',
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, email)
);
GRANT SELECT ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_users service only" ON public.app_users FOR SELECT USING (false);
CREATE TRIGGER trg_app_users_updated BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip INET
);
CREATE INDEX ON public.app_sessions(app_user_id);
GRANT ALL ON public.app_sessions TO service_role;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_email TEXT, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE lower(email) = lower(_email) AND role = _role AND active
  );
$$;

-- ========== JOB STATE CONFIG ==========
CREATE TABLE public.job_state_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_state_sets TO authenticated, anon;
GRANT ALL ON public.job_state_sets TO service_role;
ALTER TABLE public.job_state_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "state_sets readable" ON public.job_state_sets FOR SELECT USING (true);

CREATE TABLE public.job_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_set_id UUID NOT NULL REFERENCES public.job_state_sets(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  is_inspection BOOLEAN NOT NULL DEFAULT false,
  is_walkthrough BOOLEAN NOT NULL DEFAULT false,
  is_billing BOOLEAN NOT NULL DEFAULT false,
  allow_check_ins BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_set_id, slug)
);
GRANT SELECT ON public.job_states TO authenticated, anon;
GRANT ALL ON public.job_states TO service_role;
ALTER TABLE public.job_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "states readable" ON public.job_states FOR SELECT USING (true);

CREATE TABLE public.job_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_set_id UUID NOT NULL REFERENCES public.job_state_sets(id) ON DELETE CASCADE,
  from_state_id UUID NOT NULL REFERENCES public.job_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES public.job_states(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL, -- 'inspection_requested','pass','fail','progress_100_owner_yes','walkthrough_approved','manual'
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_set_id, from_state_id, trigger)
);
GRANT SELECT ON public.job_state_transitions TO authenticated, anon;
GRANT ALL ON public.job_state_transitions TO service_role;
ALTER TABLE public.job_state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transitions readable" ON public.job_state_transitions FOR SELECT USING (true);

-- ========== JOBS ==========
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  state_set_id UUID NOT NULL REFERENCES public.job_state_sets(id),
  current_state_id UUID REFERENCES public.job_states(id),
  address TEXT NOT NULL,
  state_progress_pct INT NOT NULL DEFAULT 0,
  job_completion_pct INT NOT NULL DEFAULT 0,
  total_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_field_purchase_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_po_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  original_estimate NUMERIC(12,2),
  start_date DATE,
  scope_of_work TEXT,
  notes TEXT,
  inspection_date TIMESTAMPTZ,
  latest_po UUID,
  completion_report JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.jobs(location_id, active);
CREATE INDEX ON public.jobs(current_state_id);
GRANT SELECT ON public.jobs TO authenticated, anon;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs readable" ON public.jobs FOR SELECT USING (true);
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.job_crew (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, contact_id)
);
GRANT SELECT ON public.job_crew TO authenticated, anon;
GRANT ALL ON public.job_crew TO service_role;
ALTER TABLE public.job_crew ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_crew readable" ON public.job_crew FOR SELECT USING (true);

CREATE TABLE public.job_customers (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (job_id, contact_id)
);
GRANT SELECT ON public.job_customers TO authenticated, anon;
GRANT ALL ON public.job_customers TO service_role;
ALTER TABLE public.job_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_customers readable" ON public.job_customers FOR SELECT USING (true);

-- ========== DAILY LOGS ==========
CREATE TABLE public.daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  crew_contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  log_date DATE NOT NULL,
  state_id UUID REFERENCES public.job_states(id),
  inspection_requested BOOLEAN,
  state_progress_pct INT,
  hours_worked NUMERIC(6,2),
  parts_source TEXT, -- 'none','field_purchase','supply_house'
  parts_list TEXT,
  field_purchase_amount NUMERIC(10,2),
  field_purchase_vendor TEXT,
  field_purchase_description TEXT,
  receipt_photo_url TEXT,
  parts_photo_url TEXT,
  job_site_photo_urls TEXT[],
  issues TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(log_date, job_id, crew_contact_id)
);
CREATE INDEX ON public.daily_logs(job_id);
GRANT SELECT ON public.daily_logs TO authenticated, anon;
GRANT ALL ON public.daily_logs TO service_role;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_logs readable" ON public.daily_logs FOR SELECT USING (true);
CREATE TRIGGER trg_daily_logs_updated BEFORE UPDATE ON public.daily_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== PURCHASE ORDERS / EXPENSES ==========
CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  supply_house_id UUID REFERENCES public.supply_house_contacts(id),
  status public.po_status NOT NULL DEFAULT 'draft',
  estimated_amount NUMERIC(12,2),
  final_amount NUMERIC(12,2),
  description TEXT,
  created_by_contact_id UUID REFERENCES public.contacts(id),
  sent_at TIMESTAMPTZ,
  valued_at TIMESTAMPTZ,
  valued_by_app_user_id UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.purchase_orders(job_id);
GRANT SELECT ON public.purchase_orders TO authenticated, anon;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po readable" ON public.purchase_orders FOR SELECT USING (true);
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.job_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  daily_log_id UUID REFERENCES public.daily_logs(id) ON DELETE SET NULL,
  purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, -- 'field_purchase','po','adjustment'
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendor TEXT,
  description TEXT,
  receipt_url TEXT,
  parts_photo_url TEXT,
  recorded_by_contact_id UUID REFERENCES public.contacts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.job_expenses(job_id);
GRANT SELECT ON public.job_expenses TO authenticated, anon;
GRANT ALL ON public.job_expenses TO service_role;
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses readable" ON public.job_expenses FOR SELECT USING (true);
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.job_expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== QUEUE / TOKENS / EVENTS ==========
CREATE TABLE public.scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  channel public.notif_channel NOT NULL,
  recipient TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status public.notif_status NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.scheduled_notifications(status, scheduled_for);
GRANT ALL ON public.scheduled_notifications TO service_role;
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.action_tokens TO service_role;
ALTER TABLE public.action_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  source TEXT NOT NULL, -- 'webhook','cron','form','action','admin'
  kind TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  actor_contact_id UUID REFERENCES public.contacts(id),
  actor_app_user_id UUID REFERENCES public.app_users(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ok',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.event_log(kind, created_at DESC);
GRANT SELECT ON public.event_log TO authenticated;
GRANT ALL ON public.event_log TO service_role;
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_log service only" ON public.event_log FOR SELECT USING (false);

-- ========== SEED: demo location + plumbing template ==========
DO $seed$
DECLARE
  v_loc UUID;
  v_set UUID;
  s_scheduled UUID; s_dirt UUID; s_dirt_insp UUID; s_rough UUID; s_rough_insp UUID;
  s_finish UUID; s_insp UUID; s_walk UUID; s_complete UUID; s_paid UUID;
BEGIN
  INSERT INTO public.locations(uptiq_location_id, company_name, timezone)
  VALUES ('DEMO_LOCATION','Demo Plumbing Co','America/Chicago')
  RETURNING id INTO v_loc;

  INSERT INTO public.job_state_sets(location_id, name, is_default)
  VALUES (v_loc, 'Default Plumbing Template', true)
  RETURNING id INTO v_set;

  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'job_scheduled','Job Scheduled',10,'#94a3b8',false,false,false,false,true)  RETURNING id INTO s_scheduled;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'dirt_work','Dirt Work',20,'#a16207',false,false,false,false,true) RETURNING id INTO s_dirt;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'dirt_work_inspection','Dirt Work Inspection',30,'#0891b2',true,false,false,false,false) RETURNING id INTO s_dirt_insp;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'roughin','Rough-In',40,'#2563eb',false,false,false,false,true) RETURNING id INTO s_rough;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'roughin_inspection','Rough-In Inspection',50,'#0891b2',true,false,false,false,false) RETURNING id INTO s_rough_insp;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'finish_work','Finish Work',60,'#7c3aed',false,false,false,false,true) RETURNING id INTO s_finish;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'inspection','Final Inspection',70,'#0891b2',true,false,false,false,false) RETURNING id INTO s_insp;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'walkthrough','Walkthrough',80,'#16a34a',false,true,false,false,true) RETURNING id INTO s_walk;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'complete','Complete',90,'#22c55e',false,false,true,true,false) RETURNING id INTO s_complete;
  INSERT INTO public.job_states(state_set_id, slug, label, sort_order, color, is_inspection, is_walkthrough, is_terminal, is_billing, allow_check_ins) VALUES
    (v_set,'paid','Paid',100,'#15803d',false,false,true,true,false) RETURNING id INTO s_paid;

  -- Transitions per spec
  INSERT INTO public.job_state_transitions(state_set_id, from_state_id, to_state_id, trigger) VALUES
    (v_set, s_dirt,        s_dirt_insp,  'inspection_requested'),
    (v_set, s_rough,       s_rough_insp, 'inspection_requested'),
    (v_set, s_finish,      s_insp,       'inspection_requested'),
    (v_set, s_dirt_insp,   s_rough,      'pass'),
    (v_set, s_rough_insp,  s_finish,     'pass'),
    (v_set, s_insp,        s_walk,       'pass'),
    (v_set, s_dirt_insp,   s_dirt,       'fail'),
    (v_set, s_rough_insp,  s_rough,      'fail'),
    (v_set, s_insp,        s_finish,     'fail'),
    (v_set, s_finish,      s_walk,       'progress_100_owner_yes'),
    (v_set, s_walk,        s_complete,   'walkthrough_approved'),
    (v_set, s_complete,    s_paid,       'manual');
END
$seed$;
