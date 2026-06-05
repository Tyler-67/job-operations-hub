# Deployment

## Model
- **One Lovable project + one Lovable Cloud (Supabase) project per company.**
- No shared production tables across companies.
- `location_id` / `company_id` columns and RLS exist as defense in depth.

## First-time per-company setup
1. Fork this repo on GitHub (Lovable Plus menu → GitHub → Connect, then fork from there).
2. Create a new Lovable project and connect that forked repo.
3. Enable Lovable Cloud — this provisions the company's Supabase project.
4. Apply the migrations in `supabase/migrations/` (runs automatically on first Cloud connection).
5. Update the seeded demo row:
   ```sql
   UPDATE public.locations
   SET uptiq_location_id = '<UPTIQ_SUBACCOUNT_ID>', company_name = '<Company Name>', timezone = '<IANA TZ>'
   WHERE uptiq_location_id = 'DEMO_LOCATION';
   ```
6. Add Cloud secrets (see `docs/ENV.md`).
7. Publish the Lovable app.
8. In Uptiq, add a Custom Menu Link to the published URL with query params:
   `?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}&phone={{user.phone}}`

## Cron
Schedule the cron edge functions via Lovable Cloud → Functions → Schedules:
- `cron-send-check-ins` — daily, configurable per company
- `cron-inspection-reminders` — every 30 min
- `cron-weekly-report` — weekly, configurable
- `cron-drain-notifications` — every 15 min

All cron endpoints require header `x-cron-secret: $CRON_SECRET`.

## Iframe / CSP
All edge function responses set `Content-Security-Policy: frame-ancestors https://apps.uptiq.net`.
The static app is served by Lovable hosting; the iframe `frame-ancestors` is governed at the Uptiq side. Session cookies (Phase 2) must be `SameSite=None; Secure`.

## Phase 1 vs Phase 2
- **Phase 1 (this scaffold)**: schema, RLS, edge function stubs, dashboard, admin shells, token-gated form shells, queue/cron skeletons.
- **Phase 2**: real Uptiq API calls, photo upload to Storage, form submit logic, PO value workflow, weekly reports, configurable company variables UI, brand theming.
