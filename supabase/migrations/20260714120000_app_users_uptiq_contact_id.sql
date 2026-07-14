-- Optional Uptiq messaging CONTACT id on app_users, so a user (esp. crew synced from the
-- Uptiq "crew" tag) can carry their contact id directly. Distinct from uptiq_user_id (the
-- Uptiq staff/login user id). Nullable / optional — "not needed but there".
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS uptiq_contact_id TEXT;
