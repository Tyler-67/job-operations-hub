# Environment Variables

Required for production. All secrets live in Lovable/Supabase project settings or Edge Function secrets. Never commit secrets.

## Edge Function Runtime

| Name | Used In | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | every function | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | every function | Server-side only. Never expose to the frontend. |
| `UPTIQ_API_TOKEN` | `_shared/uptiq.ts` | Uptiq private integration token. Required production scopes include users read, contacts, conversations, calendars, and tag actions used by the app. |
| `UPTIQ_ALLOW_STUBS` | `_shared/uptiq.ts` | Optional local/demo-only flag. Set to `true` only when a preview should return typed Uptiq stubs without a token. Do not set in production. |
| `ACTION_TOKEN_SECRET` | action tokens and link generation | HMAC pepper for tap-link and form-link tokens. |
| `APP_SESSION_SECRET` | `iframe-session`, `me`, `search`, admin functions | HMAC pepper for app session tokens. |
| `BOOTSTRAP_ADMIN_EMAIL` | `iframe-session` | Email for the first `owner_admin` during setup. |
| `CRON_SECRET` | all `cron-*` functions | Required request header value for scheduled calls. |
| `ALLOWED_FRAME_ANCESTORS` | `_shared/util.ts` | Default should be `https://apps.uptiq.net`. |
| `APP_BASE_URL` | link generation | Public app URL for the deployed company instance. |

## Frontend

| Name | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase URL used by the frontend. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public anon key for client and Edge Function invocation. |
| `VITE_SUPABASE_PROJECT_ID` | Diagnostics and project identification. |

## Per-Company Deployment

This app is single-tenant per company. To onboard a new company:

1. Create a new Lovable deployment connected to the canonical repo or an intentional company fork.
2. Provision a fresh Supabase project.
3. Run all migrations in `supabase/migrations/`.
4. Replace the seeded `locations.uptiq_location_id` with the company's Uptiq subaccount ID.
5. Set the secrets in the table above.
6. Deploy all Edge Functions.
7. Add the published app URL as a custom menu link in Uptiq with iframe params `location_id`, `user_email`, `user_name`, and `phone`.

## Retired Configuration

Do not add or configure legacy Uptiq form IDs. The v2 app owns workflow forms and writes their submissions to Supabase.

Retired columns:

- `daily_checkin_form_id`
- `inspection_date_form_id`
- `inspection_fix_form_id`
- `walkthrough_punch_list_form_id`
