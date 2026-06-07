# Self-Hosting And Supabase Ownership Checklist

Use this checklist to move the app from Lovable Cloud's managed Supabase backend to a Supabase project owned by Uptiq.

This is the recommended production path. Lovable Cloud is acceptable for preview, but production needs direct access to migrations, RLS, backups, logs, secrets, Edge Functions, and incident response.

## Target Architecture

- Uptiq owns the Supabase project in Chris's Supabase dashboard.
- The app is hosted outside Lovable Cloud so `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` point at the Uptiq-owned project.
- Supabase remains the system of record.
- Uptiq remains the iframe context, contact source, outbound communication layer, inspection calendar integration, and Review Requested tag bridge.
- Each customer company still gets its own independent app instance and Supabase project.

## Preflight Decisions

- Choose the hosting target for the React app, such as Vercel or another controlled static host.
- Create a new Supabase project in the Uptiq Supabase account.
- Decide whether any Lovable Cloud data must be preserved. If the current data is demo-only, prefer a clean migration and reseed.
- Confirm the public app URL that will replace the Lovable preview URL.
- Confirm `apps.uptiq.net` DNS and hosting ownership before production cutover.
- Confirm the bootstrap `owner_admin` email for the first real company instance.

## Supabase Project Setup

1. Create the new Supabase project in the Uptiq-owned Supabase org.
2. Install and authenticate the Supabase CLI on the deployment machine.
3. Link the local repo to the new project:

   ```powershell
   supabase login
   supabase link --project-ref <NEW_PROJECT_REF>
   ```

4. Apply all repo migrations in order from `supabase/migrations/`.
5. Confirm the RLS lockdown migration is included:

   ```text
   20260607150706_lock_down_direct_table_reads.sql
   ```

6. Verify migration history in Supabase before any app traffic is pointed at the project.

## Edge Functions

Deploy every function in `supabase/functions/` to the new project:

- `action-token-consume`
- `cron-drain-notifications`
- `cron-inspection-reminders`
- `cron-send-check-ins`
- `cron-weekly-report`
- `expenses`
- `health`
- `iframe-session`
- `inbound-sms`
- `job-states`
- `jobs`
- `logout`
- `me`
- `search`
- `settings`
- `users`

Before production, verify each function's Supabase JWT setting. Functions with their own app-session, cron-secret, or action-token verification may need gateway JWT verification disabled, but only if the deployed gateway rejects valid app calls. Do not remove the function-level checks.

## Secrets

Set the Edge Function secrets in the Uptiq-owned Supabase project. Required values are documented in `docs/ENV.md`.

Required production secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPTIQ_API_TOKEN`
- `ACTION_TOKEN_SECRET`
- `APP_SESSION_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `CRON_SECRET`
- `ALLOWED_FRAME_ANCESTORS`
- `APP_BASE_URL`

Do not set `UPTIQ_ALLOW_STUBS` in production.

## Frontend Environment

Set these in the hosting platform, not in Git:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

The repo version of `src/integrations/supabase/client.ts` reads from these variables. If the app remains inside Lovable Cloud, Lovable may keep regenerating this config toward Lovable Cloud; full control requires hosting outside Lovable Cloud.

## Data Migration

If preserving Lovable Cloud data:

1. Export tables from Lovable Cloud Database -> Tables.
2. Preserve UUID values during import.
3. Import parent tables before child tables.
4. Import `jobs.latest_po` as `NULL` first, because jobs and purchase orders reference each other.
5. Import purchase orders.
6. Backfill `jobs.latest_po` after purchase orders exist.

Recommended import order:

1. `locations`
2. `contacts`
3. `supply_house_contacts`
4. `app_users`
5. `job_state_sets`
6. `job_states`
7. `job_state_transitions`
8. `jobs` with `latest_po` temporarily blank
9. `job_customers`
10. `job_crew`
11. `daily_logs`
12. `purchase_orders`
13. `job_expenses`
14. `scheduled_notifications`
15. `event_log`
16. `company_settings`
17. `jobs.latest_po` backfill

For a pre-production cutover, do not import `app_sessions` or `action_tokens`; force fresh sessions and links after the new project is live.

## Company Configuration

After migrations and optional data import, configure the company row:

```sql
UPDATE public.locations
SET
  uptiq_company_id = '<UPTIQ_COMPANY_ID>',
  uptiq_location_id = '<UPTIQ_SUBACCOUNT_ID>',
  company_name = '<Company Name>',
  timezone = '<IANA_TIMEZONE>'
WHERE uptiq_location_id = 'DEMO_LOCATION';
```

Then review `company_settings`, supply house contacts, check-in timing, inspection calendar ID, and branding.

## Verification Before Cutover

- `npm.cmd test` passes.
- `npm.cmd run lint` passes with only known warnings.
- `npm.cmd run build` passes with only known warnings.
- Supabase migrations are fully applied.
- Edge Functions are deployed and callable.
- `/health` returns successfully against the new Supabase project.
- Demo or bootstrap admin session loads.
- Dashboard loads jobs through Edge Functions.
- Search returns only current company data.
- Admin Settings can save and reload.
- Admin Job States can read and update states.
- Admin Expenses and PO value entry still work.
- Direct table reads through the public Data API fail for `anon` and `authenticated`.
- Edge Function reads still work through the app session.
- `iframe-session` fails closed when Uptiq verification is missing in production.
- `UPTIQ_ALLOW_STUBS` is absent in production.
- Cron functions reject missing or wrong `x-cron-secret`.

## Cutover

1. Deploy the hosted app with the new frontend environment variables.
2. Point `APP_BASE_URL` to the production app URL.
3. Set `ALLOWED_FRAME_ANCESTORS` to `https://apps.uptiq.net` unless a different Uptiq app domain has been verified.
4. Update the Uptiq custom menu link to the new app URL with iframe params:

   ```text
   ?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}&phone={{user.phone}}
   ```

5. Run iframe login verification from a real Uptiq subaccount user.
6. Run a short production smoke test before inviting company users.

## Rollback Plan

- Keep the Lovable Cloud preview untouched until the owned Supabase project passes verification.
- Do not change `apps.uptiq.net` DNS or Uptiq menu links until the new deployment is ready.
- If cutover fails, point the Uptiq menu link back to the prior Lovable preview while investigating.
- Do not migrate new customer data back into Lovable Cloud unless a deliberate rollback data plan is created.
