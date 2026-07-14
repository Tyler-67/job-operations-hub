-- Debug mode toggle: when on, the app surfaces the dev/diagnostic panels (Settings testing tools,
-- Uptiq contacts sync) and extra "how it's working" data. Off by default so a normal/demo tenant
-- stays clean. Toggled from Admin -> Settings.
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS debug_mode BOOLEAN NOT NULL DEFAULT false;
