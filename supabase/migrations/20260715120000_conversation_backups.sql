-- Debug tool support: before deleting a contact's Uptiq conversation (the thread, never the
-- contact), snapshot the contact record + all its messages here so nothing is truly lost.
-- Service-role only (written by edge functions); RLS enabled with no policies denies everyone else.
create table if not exists public.conversation_backups (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  uptiq_contact_id text,
  uptiq_conversation_id text,
  contact_snapshot jsonb not null,
  messages_snapshot jsonb,
  message_count integer not null default 0,
  deleted_ok boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_backups_location_created_idx
  on public.conversation_backups (location_id, created_at desc);

alter table public.conversation_backups enable row level security;
