-- Supply-house "place order" support: human-readable PO numbers + a per-company
-- spend ceiling for the warehouse email's "don't exceed $X" note.
--
-- v1 (n8n .03N) generated a PO number so the supply house's returning invoice
-- carries a number we authored and can match deterministically to the job. v2
-- keeps that contract. Numbers are date-based per company: PO-YYYYMMDD-NN.

-- 1. The PO number itself. Nullable because the "already ordered" path and legacy
--    pending_value rows have none; unique so an authored number is never reused.
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS po_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_po_number_key
  ON public.purchase_orders(po_number) WHERE po_number IS NOT NULL;

-- 2. Per-company, per-day counter. Keeping the counter in the database (not the
--    edge function) means two simultaneous check-ins can't mint the same number.
CREATE TABLE IF NOT EXISTS public.po_number_counters (
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  po_date DATE NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, po_date)
);
GRANT ALL ON public.po_number_counters TO service_role;
ALTER TABLE public.po_number_counters ENABLE ROW LEVEL SECURITY;
-- Service-role only: no anon/authenticated policy. The edge function (service role)
-- bypasses RLS; nothing client-side ever touches the counter directly.

-- 3. Atomic allocator. One round-trip: upsert-increment the day's counter and
--    return the formatted number. SECURITY DEFINER so it runs with the owner's
--    rights regardless of caller; service role is the only intended caller.
CREATE OR REPLACE FUNCTION public.next_po_number(p_location_id UUID, p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  INSERT INTO public.po_number_counters (location_id, po_date, seq)
  VALUES (p_location_id, p_date, 1)
  ON CONFLICT (location_id, po_date)
  DO UPDATE SET seq = public.po_number_counters.seq + 1
  RETURNING seq INTO v_seq;

  RETURN 'PO-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 2, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_po_number(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_po_number(UUID, DATE) TO service_role;

-- The "don't exceed $X" spend ceiling and the supply-house pickup time the warehouse
-- email needs already live on company_settings (parts_cost_ceiling, supply_house_pickup_time).
