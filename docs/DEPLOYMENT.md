# Deployment

## Model

- One Lovable project and one Supabase project per company.
- No shared production tables across companies.
- Use `location_id` plus RLS as defense in depth, not as the main tenancy boundary.
- Keep one canonical GitHub repo by default. Fork only when a company needs custom code.
- Each deployed instance needs its own Uptiq private integration token and environment secrets.

## First-Time Company Setup

1. Create a new Lovable project for the company.
2. Connect the canonical GitHub repo, or a deliberate company fork if custom code is required.
3. Connect or provision a fresh Supabase project for that company.
4. Apply all migrations in `supabase/migrations/`.
5. Configure the company row and replace demo identifiers:

   ```sql
   UPDATE public.locations
   SET
     uptiq_company_id = '<UPTIQ_COMPANY_ID>',
     uptiq_location_id = '<UPTIQ_SUBACCOUNT_ID>',
     company_name = '<Company Name>',
     timezone = '<IANA_TIMEZONE>'
   WHERE uptiq_location_id = 'DEMO_LOCATION';
   ```

6. Set Edge Function secrets from `docs/ENV.md`.
7. Deploy the Supabase Edge Functions.
8. Publish the Lovable app.
9. In Uptiq, add a custom menu link to the published app URL with iframe params:

   ```text
   ?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}&phone={{user.phone}}
   ```

## Required Production Hardening

Do not treat a company instance as production-ready until these are complete:

- `iframe-session` verifies the iframe user against Uptiq server-side.
- App RBAC is enforced for every admin and manager action.
- Broad anon read policies are removed or replaced by authenticated Edge Function access.
- `UPTIQ_API_TOKEN` is set and `UPTIQ_ALLOW_STUBS` is not enabled.
- Cron and webhook functions perform real work and write auditable events.
- Action-token form pages validate tokens without consuming them until submit.
- Photo uploads use Supabase Storage with explicit bucket and retention policy.
- Cross-company isolation tests pass.

## Cron

Schedule these Edge Functions from the Supabase/Lovable function scheduler:

- `cron-send-check-ins` - daily, using company check-in configuration
- `cron-inspection-reminders` - every 30 minutes
- `cron-weekly-report` - weekly, using company report configuration
- `cron-drain-notifications` - every 15 minutes

All cron endpoints require header:

```text
x-cron-secret: $CRON_SECRET
```

## Iframe And CSP

The app is intended to run inside Uptiq. Use `https://apps.uptiq.net` as the allowed iframe ancestor unless a deployment has a verified different Uptiq app domain.

Edge Function responses set `Content-Security-Policy` through shared utilities. The static app is served by Lovable hosting, so final iframe behavior also depends on Lovable hosting headers and the Uptiq embed surface.

Do not rely on third-party cookies for iframe auth. The app should use server-issued app session tokens after verifying Uptiq iframe context.

## Migration Hygiene

Migrations in this repo are part of the deployment contract. Do not remove a migration that may already be recorded in a connected Supabase project without first checking migration history.

On June 5, 2026, the legacy Uptiq form ID columns were retired. The repo includes idempotent `DROP COLUMN IF EXISTS` migrations for those columns because Lovable also recorded its own migration during deployment.

## Current Implementation Notes

Implemented:

- Dashboard
- Jobs create/edit/archive/restore
- Admin Job States
- Admin Expenses and PO value entry
- Admin Users
- Admin Settings
- Settings Edge Function

Still production-blocking:

- Real Uptiq API calls
- Cron dispatch behavior
- Inbound SMS handlers
- Full app-owned form submissions
- Photo uploads
- Weekly report generation
- Auth/RLS hardening
