-- Per-user debugger grant: owner_admin sees the debug tools only when a dev_super has granted
-- debug_access (dev_super/support_admin always have them). Default off — a plain Owner.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS debug_access boolean NOT NULL DEFAULT false;

-- Promote the dev-side identities (Tyler + the Chris's) to dev_super.
UPDATE app_users SET role = 'dev_super'
WHERE email IN ('t.ernesto@procareme.com', 't.ernesto@icloud.com', 'chris@procareme.com', 'cj@uptiq.net');
