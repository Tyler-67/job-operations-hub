ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS uptiq_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_app_users_location_uptiq_user
  ON public.app_users(location_id, uptiq_user_id)
  WHERE uptiq_user_id IS NOT NULL;
