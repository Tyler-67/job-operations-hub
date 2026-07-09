-- BETA/STAGING ONLY: store the admin-set login password in plaintext on the user record so
-- an owner_admin can set AND view credentials from the Users page (explicit product decision
-- for the Murphy testing build — admins provision reviewer accounts and hand out the password).
--
-- SECURITY: this is plaintext credential storage and MUST NOT reach a real production/customer
-- deployment. Before GA, replace with a reveal-once flow (show at set time only) and drop this
-- column. The value is only ever exposed through the admin-gated `users` edge function to
-- owner_admin/support_admin; app_users itself is service-role-only (RLS USING(false)).
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS login_password TEXT;
