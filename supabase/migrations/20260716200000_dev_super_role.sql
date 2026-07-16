-- New top role: dev_super ("Dev Super User") — everything owner_admin has PLUS the debug tools,
-- and the only role that can grant debug access or manage dev_super users.
-- NOTE: ALTER TYPE ... ADD VALUE cannot be used in the same transaction as statements that USE
-- the new value — apply this file alone, before 20260716200001.
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'dev_super';
