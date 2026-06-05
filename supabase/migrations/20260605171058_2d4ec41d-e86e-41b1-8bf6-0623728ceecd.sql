
ALTER FUNCTION public.set_updated_at() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.has_role(TEXT, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT, public.app_role) TO service_role;
