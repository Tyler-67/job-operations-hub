-- Supply Houses admin CRUD support:
--  (1) add the fields the admin UI manages (the table only had name/rep_name/email/phone),
--  (2) add the updated_at trigger the table never got (it has an updated_at column but no trigger),
--  (3) add a nullable expense -> supply-house link so job expenses can reference a managed
--      supply house (purchase_orders already FK to it via purchase_orders.supply_house_id).
-- RLS/grants are already service-role-only after 20260607150706_lock_down_direct_table_reads.sql,
-- so no new policy/grant is needed — the browser only reaches this table through the edge fn.

ALTER TABLE public.supply_house_contacts
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

DROP TRIGGER IF EXISTS trg_supply_houses_updated ON public.supply_house_contacts;
CREATE TRIGGER trg_supply_houses_updated
  BEFORE UPDATE ON public.supply_house_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.job_expenses
  ADD COLUMN IF NOT EXISTS supply_house_id UUID REFERENCES public.supply_house_contacts(id) ON DELETE SET NULL;
