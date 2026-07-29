-- The conversation-clear debug tool backs up + deletes the Uptiq THREAD, but the app keeps its
-- own mirror of every system-sent message (scheduled_notifications) — which the Contacts message
-- panel + debug message log render. The tool now clears that mirror too, and this column holds
-- the cleared rows inside the same backup-before-delete guarantee the Uptiq side already has.
alter table public.conversation_backups
  add column if not exists app_notifications_snapshot jsonb;
