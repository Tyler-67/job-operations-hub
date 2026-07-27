-- 2026-07-27: per-tenant message-format overrides. A JSONB map of template_key ->
-- { subject?: string|null, body: string } on company_settings. Empty ({}) by default, so the
-- built-in defaults in _shared/notifications.ts are used unless a tenant sets an override — additive
-- and backward-compatible (the pinned prod FE + prod tenant are unaffected until an override exists).
-- The drain (cron-drain-notifications) reads this per location and renders overridden templates via
-- {{placeholder}} interpolation; the Settings > Debug > Messages editor writes it.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS message_templates JSONB NOT NULL DEFAULT '{}'::jsonb;
