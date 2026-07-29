-- Link contacts to their source supply_house_contacts row so the Supply Houses admin can keep a
-- synced contacts (role='supply_house') projection in the roster/messaging view.
-- supply_house_contacts stays the SOURCE OF TRUTH (it holds rep/account/address/PO-email); the
-- contacts row is a projection maintained by the supply-houses edge fn (auto-sync on save).
-- ON DELETE CASCADE: a hard-deleted supply house takes its mirror contact with it (soft-delete
-- via active is mirrored by the sync, not by this FK).
alter table public.contacts
  add column if not exists supply_house_id uuid
  references public.supply_house_contacts(id) on delete cascade;

create index if not exists contacts_supply_house_id_idx
  on public.contacts(supply_house_id);

-- Backfill (idempotent): link any existing supply_house-role contact to its house, then create a
-- mirror contact for any supply house still lacking one.
-- 1) precise link by shared uptiq id
update public.contacts c
set supply_house_id = s.id
from public.supply_house_contacts s
where c.supply_house_id is null
  and c.role = 'supply_house'
  and c.location_id = s.location_id
  and c.uptiq_contact_id is not null
  and c.uptiq_contact_id = s.uptiq_contact_id;

-- 2) fallback link by (location, name)
update public.contacts c
set supply_house_id = s.id
from public.supply_house_contacts s
where c.supply_house_id is null
  and c.role = 'supply_house'
  and c.location_id = s.location_id
  and lower(c.name) = lower(s.name);

-- 3) create a mirror contact for any supply house that still has none
insert into public.contacts (location_id, name, role, uptiq_contact_id, email, phone, active, supply_house_id)
select s.location_id, s.name, 'supply_house', s.uptiq_contact_id, s.email, s.phone, s.active, s.id
from public.supply_house_contacts s
where not exists (
  select 1 from public.contacts c where c.supply_house_id = s.id
);
