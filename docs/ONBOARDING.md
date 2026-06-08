# Customer Onboarding Model

This app is sold as a production product for multiple contractor companies. Each contractor runs in an isolated instance.

## Production Tenancy Rule

- One contractor company gets one app instance.
- One app instance points to one Supabase project.
- No unrelated contractor companies share production tables.
- `location_id` is used inside an instance as defense in depth, not as the main tenancy boundary.
- Uptiq iframe context and server-side user verification decide which company location a session belongs to.

This keeps customer data isolated by infrastructure first, then by application logic.

## Required Customer Inputs

Each onboarding run needs these values:

- Customer company name
- Uptiq company ID
- Uptiq subaccount/location ID
- Bootstrap owner admin email
- Timezone
- Public app URL or customer subdomain
- Uptiq private integration token
- Allowed iframe ancestor, normally `https://apps.uptiq.net`

## Provisioning Flow

The target production process should be automated by an internal provisioner.

1. Create a new Supabase project owned by Uptiq.
2. Apply all migrations from `supabase/migrations/`.
3. Deploy all Edge Functions with the expected function-level auth settings.
4. Set required Edge Function secrets from `docs/ENV.md`.
5. Replace the seeded demo location with the real customer identifiers:

   ```sql
   UPDATE public.locations
   SET
     uptiq_company_id = '<UPTIQ_COMPANY_ID>',
     uptiq_location_id = '<UPTIQ_SUBACCOUNT_ID>',
     company_name = '<Company Name>',
     timezone = '<IANA_TIMEZONE>'
   WHERE uptiq_location_id = 'DEMO_LOCATION';
   ```

6. Ensure `company_settings` exists for that location.
7. Deploy or configure the frontend so its environment points to the new Supabase project.
8. Add the customer app URL as a custom menu link in Uptiq:

   ```text
   ?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}&phone={{user.phone}}
   ```

9. Run the onboarding smoke tests.

## Automation Target

The internal provisioner should eventually perform the flow from one command or admin screen:

```text
provision-customer --company "Acme Plumbing" --uptiq-company-id "..." --uptiq-location-id "..." --owner-email "..." --timezone "America/Denver"
```

The repo includes a first CLI version:

```powershell
npm.cmd run provision:customer -- --config path\to\customer.json
```

Dry-run is the default. To apply against an existing Supabase project, set `SUPABASE_DB_PASSWORD` in the shell and pass a local, uncommitted secrets file:

```powershell
npm.cmd run provision:customer -- --config path\to\customer.json --apply --secrets-env-file path\to\customer.env
```

Customer config shape:

```json
{
  "companyName": "Acme Plumbing",
  "uptiqCompanyId": "UPTIQ_COMPANY_ID",
  "uptiqLocationId": "UPTIQ_SUBACCOUNT_ID",
  "ownerEmail": "owner@example.com",
  "timezone": "America/Denver",
  "appBaseUrl": "https://acme.apps.uptiq.net",
  "supabaseProjectRef": "optional-existing-project-ref"
}
```

The provisioner can use the Supabase Management API to create projects programmatically:

https://supabase.com/docs/reference/api/management

It can then use the Supabase CLI or Management API workflows to apply migrations, deploy functions, and set secrets.

## Segregation Guarantees

For each customer instance:

- The frontend uses only that customer's Supabase URL and publishable key.
- Edge Functions use only that customer's service role key.
- `iframe-session` only issues sessions after matching the incoming Uptiq subaccount ID to `locations.uptiq_location_id`.
- App session tokens include the internal Supabase `location_id`.
- Data reads and writes through Edge Functions filter by the session `location_id`.
- Direct browser table access is locked down for `anon` and `authenticated`.
- Cron and action-token functions must use the same project-local secrets.

## Smoke Tests

Before a customer is considered live:

- Supabase project exists in the Uptiq-owned org.
- All migrations are applied.
- All expected Edge Functions are `ACTIVE`.
- Function JWT settings match the app-session architecture.
- Required secrets are set.
- `UPTIQ_ALLOW_STUBS` is not set.
- Direct table reads fail for public roles.
- `iframe-session` rejects an unknown Uptiq subaccount ID.
- `iframe-session` rejects a user not found in the Uptiq subaccount.
- Bootstrap owner admin can load the app through the iframe link.
- Dashboard, jobs, settings, job states, expenses, and users load through Edge Functions.
- A record created in this customer instance is not visible from any other customer instance.

## Non-Goals

- Do not onboard multiple unrelated contractors into one shared production Supabase project.
- Do not rely on frontend filtering for customer isolation.
- Do not expose the service role key to the browser.
- Do not use demo stubs in production.
- Do not manually provision customers long term; manual steps are acceptable only while building the provisioner.
