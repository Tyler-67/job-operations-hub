# Uptiq Tradesman Snapshot — Phase 1 Build Plan

This is a large production scaffold. I'll deliver Phase 1 only (per your spec), wired end-to-end so subsequent phases (forms logic, cron drainers, Uptiq live calls, reports) drop into a stable foundation. Please confirm before I proceed — once approved I'll execute in one pass.

## Assumptions (flag any to change)
1. **Lovable Cloud** (managed Supabase) is acceptable as the per-company Supabase project. I'll enable it now; in production each company gets its own clone of this repo + its own Cloud project.
2. **Edge Functions** (Deno) will back the `/api/*` routes — Lovable doesn't run a Node server. Iframe session, action token verification, cron endpoints, webhooks all live as edge functions.
3. **No Uptiq live calls in Phase 1** — wrapper stubs only, returning typed mocks; real calls land in Phase 2 once `UPTIQ_API_TOKEN` is provided.
4. **Iframe auth in Phase 1** runs in "trusted-dev" mode: it accepts the URL params, upserts `app_users`, and issues an HMAC-signed session cookie. The Uptiq Users-by-Location verification is stubbed behind a feature flag and turned on in Phase 2 with the real token.
5. **GitHub repo connection** is a user action (Plus menu → GitHub). I'll prepare the repo contents (migrations, seeds, env docs, README); you click connect.
6. Default seed is the **plumbing template** exactly as specified.
7. Frame ancestor allowed: `apps.uptiq.net` (set via response headers from edge functions; the static app itself is served by Lovable hosting which I'll document).

## Deliverables (Phase 1)

### Database (Supabase migrations)
Tables, all with `company_id`/`location_id`, RLS on, plus GRANTs:
`locations, contacts, app_users, app_sessions, supply_house_contacts, job_state_sets, job_states, job_state_transitions, jobs, job_crew, job_customers, daily_logs, purchase_orders, job_expenses, scheduled_notifications, action_tokens, event_log`.
Plus enum `app_role` (`owner_admin, office_manager, crew, viewer, support_admin`) and `has_role()` security-definer.
Seed: one demo location, plumbing `job_state_set` with the 10 states and the transition rows listed in the spec.

### Edge functions (stubs that compile + respond)
`iframe-session, logout, me, action-token-consume, inbound-sms, cron-send-check-ins, cron-inspection-reminders, cron-weekly-report, cron-drain-notifications, search, health`.
All set `Content-Security-Policy: frame-ancestors https://apps.uptiq.net`. All idempotent via `event_log.dedupe_key`. Cron endpoints require `CRON_SECRET` header.

### Frontend (React + Vite + Tailwind)
Operations-first, no marketing. Routes:
- `/dashboard` (default `/` → `/dashboard`) — dense job list with the columns specified, filters, terminal-state exclusion toggle.
- `/search` — global search shell.
- `/admin/settings`, `/admin/job-states`, `/admin/supply-houses`, `/admin/expenses`, `/admin/users` — admin shells with table scaffolding wired to Supabase.
- `/forms/daily-check-in`, `/forms/inspection-date`, `/forms/inspection-fix-details`, `/forms/walkthrough-punch-list`, `/forms/quick-log`, `/crew-completion` — token-gated form shells (UI + token validation hook; submit handlers stubbed to insert into respective tables).
- `/reports/completion`, `/reports/weekly-preview` — empty report shells.
- `/action/confirm` — tap-link consumer page.

Auth: a `useIframeSession` hook reads URL params on first load, POSTs to `iframe-session`, stores the signed session, gates all routes.

Design system: quiet, dense, work-focused. Neutral slate palette, mono-accent, compact spacing, no hero/marketing surfaces. Brand colors/logo become configurable in Phase 2 via `company_variables`.

### Repo artifacts
- `supabase/migrations/*.sql` (schema + seed)
- `supabase/functions/*/index.ts`
- `docs/ENV.md` listing every env var with where it's used
- `docs/DEPLOYMENT.md` for the per-company clone workflow
- `README.md` rewritten for Uptiq

### Explicitly out of scope for Phase 1 (queued for Phase 2+)
- Real Uptiq API calls (wrapper exists, returns stubs)
- Photo upload to Storage bucket (UI present, upload stubbed)
- PO value-entry workflow end-to-end (schema + admin shell only)
- Weekly report generation
- Inbound SMS LOG/PASS/FAIL parsing logic (endpoint exists, parser stubbed)
- Configurable `company_variables` admin UI
- Brand theming pipeline

## Technical notes
- Single-tenant per deployment; `company_id`/`location_id` columns + RLS exist as defense-in-depth.
- All multi-step state changes via Postgres functions called from edge functions inside a transaction.
- `action_tokens.token_hash` = `sha256(token + ACTION_TOKEN_SECRET)`; the raw token only appears in the signed link.
- `app_sessions` issued as HMAC-signed JWT-like blobs using `APP_SESSION_SECRET`; 30-min TTL, refreshed on activity.
- Iframe-safe: `SameSite=None; Secure` cookies on the session; CSP `frame-ancestors` set.

## What I need from you to start
Just **"approve"** (or list edits). After approval I'll:
1. Enable Lovable Cloud
2. Write all migrations + seed
3. Write edge function stubs
4. Build the dashboard + admin + form shells
5. Document env vars and deployment

Estimated turn count: several. I won't pause mid-way unless I hit a blocking question.