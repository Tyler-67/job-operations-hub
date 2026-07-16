-- Granular debugger grants: replace the all-or-nothing debug_access boolean with a per-tool
-- list. Slugs (kept in lockstep with _shared/debug-access.ts DEBUG_TOOLS):
--   run_crons, contacts_sync, send_test, conversations, jobs_clear, data_reset
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS debug_tools text[] NOT NULL DEFAULT '{}';
UPDATE app_users SET debug_tools = ARRAY['run_crons','contacts_sync','send_test','conversations','jobs_clear','data_reset']
WHERE debug_access = true;
ALTER TABLE app_users DROP COLUMN IF EXISTS debug_access;
