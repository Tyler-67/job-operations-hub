# Uptiq - Tradesman Snapshot v2

> **DEPRECATED (2026-06-11): Lovable is no longer part of this stack.** The app deploys to **Vercel** (auto-deploy on push to `main`); Supabase is owned directly. References to Lovable below are stale and pending a rewrite.

Operational job hub for trades companies. This app replaces the distributed v1 workflow system with one stable codebase, one Lovable deployment, and one Supabase project per company.

> Single-tenant per company: each company gets its own app deployment, Supabase project, Uptiq token, secrets, and data. Do not share production tables across companies.

## Stack

- React 18, Vite, TypeScript, Tailwind
- Supabase Postgres, RLS, Edge Functions, and Storage
- Lovable for app building, preview, and deployment
- Uptiq for contacts, outbound SMS/email/calls, inspections calendar, iframe shell, and the Review Requested tag bridge

## Current Build Status

Implemented and verified:

- Job dashboard with filters, search, state pills, progress, hours, expenses, and active-job focus
- Job create/edit/archive/restore workflow
- Admin Job States CRUD with role enforcement
- Admin Expenses and PO value-entry workflow
- Admin Users and role/status management
- Admin Settings for company variables, timing, contacts, branding, and external IDs
- App-owned settings save flow through Supabase Edge Functions
- Token-gated form route shells
- Supabase schema, migrations, default plumbing seed data, RLS foundation, and event log
- Iframe session bootstrap with app-owned RBAC records
- Scheduled notification queue and cron function skeletons

Retired v1 behavior:

- Uptiq form IDs are not configuration in v2.
- User-facing workflow forms are app-owned and write to Supabase.
- The only Uptiq ID currently kept in Settings is the inspections calendar ID.

## Production Readiness Gaps

These are intentionally still open and must be finished before customer production:

- Validate iframe user verification against a real Uptiq company ID and token before customer launch
- Lock down broad read policies and route sensitive reads through authenticated Edge Functions
- Replace remaining cron, inbound SMS, and weekly report stubs
- Split action-token validation from token consumption for form pages
- Implement photo upload and storage policies
- Finish app-owned form submission handlers end to end
- Add production dashboard query optimization for larger job volumes
- Add regression tests for cross-company isolation, RBAC, idempotency, and job-state transitions

## Local Dev

The app can bootstrap a development session against the seeded demo location when no Uptiq iframe params are present. Production deployments must use verified Uptiq iframe context plus app-owned RBAC.

```powershell
npm.cmd install
npm.cmd run dev
```

Useful checks:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run lint
```

## Repo Layout

```text
src/
  components/AppShell.tsx
  pages/Dashboard.tsx, Jobs.tsx, Search.tsx, admin/*, forms/*
  lib/session.tsx
supabase/
  functions/_shared/{util,uptiq}.ts
  functions/{iframe-session,me,logout,action-token-consume,inbound-sms,search,health,cron-*}/index.ts
  migrations/*.sql
docs/
  ENV.md, DEPLOYMENT.md
```

See `docs/ENV.md` for environment variables and `docs/DEPLOYMENT.md` for per-company onboarding.
