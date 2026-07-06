-- app_user_emails: SECONDARY login emails (aliases) for the standalone Supabase-Auth
-- login door. The user's PRIMARY email is app_users.email and stays authoritative — the
-- bridge (auth-session) resolves app_users.email FIRST and only consults this table for
-- additional addresses (see _shared/app-user.ts:resolveAppUser). So a user's own primary
-- email can never be shadowed by an alias planted on another account.
--
-- Follows the app_users DDL pattern (20260605171041_*.sql): gen_random_uuid() PK,
-- ON DELETE CASCADE FK, TIMESTAMPTZ NOT NULL DEFAULT now(), service-role-only grants,
-- RLS with a `USING (false)` SELECT policy, and the set_updated_at() trigger.
CREATE TABLE IF NOT EXISTS public.app_user_emails (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,              -- stored lowercased
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global case-insensitive uniqueness: one alias address maps to at most one app user.
-- (Collisions with any app_users.email are rejected in the users function on write.)
CREATE UNIQUE INDEX IF NOT EXISTS app_user_emails_lower_email_key
  ON public.app_user_emails (lower(email));

CREATE INDEX IF NOT EXISTS idx_app_user_emails_app_user
  ON public.app_user_emails (app_user_id);

GRANT ALL ON public.app_user_emails TO service_role;
ALTER TABLE public.app_user_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_user_emails service only" ON public.app_user_emails;
CREATE POLICY "app_user_emails service only" ON public.app_user_emails FOR SELECT USING (false);

DROP TRIGGER IF EXISTS trg_app_user_emails_updated ON public.app_user_emails;
CREATE TRIGGER trg_app_user_emails_updated
  BEFORE UPDATE ON public.app_user_emails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No backfill: primary emails live in app_users.email and are resolved from there. This
-- table starts empty and only ever holds additional (secondary) login addresses, so there
-- is no lossy mirror of the per-location-unique app_users.email into a global-unique alias.
