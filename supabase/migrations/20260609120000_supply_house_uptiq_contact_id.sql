-- v1's "Email Supply House" node addressed the supply house by its Uptiq/GHL contact
-- ID (the conversations API only sends to a contact, never a raw address). v2's
-- supply_house_contacts kept email/phone but dropped that contact ID, so the
-- place-order warehouse email had no Uptiq recipient. Restore it here.
ALTER TABLE public.supply_house_contacts ADD COLUMN IF NOT EXISTS uptiq_contact_id TEXT;
