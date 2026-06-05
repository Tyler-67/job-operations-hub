# Uptiq — Tradesman Snapshot (v2)

Operational job dashboard for trades companies. Replaces a distributed system of 13 Uptiq workflows and 21 n8n flows with a single stable app per company.

> **Single-tenant per company.** One app instance + one Lovable Cloud (Supabase) project per company. See `docs/DEPLOYMENT.md`.

## Stack
- React 18 + Vite + TypeScript + Tailwind (operations-first design system)
- Lovable Cloud (Supabase) — Postgres + RLS, Edge Functions, Storage
- Uptiq for contacts, outbound SMS/email/calls, inspections calendar, iframe shell, Review Requested tag

## Phase 1 status
- ✅ Schema + RLS for all 17 tables, plumbing template seeded
- ✅ Iframe auth → signed session → `app_users` upsert + RBAC enum
- ✅ Dashboard with filters, search, state pills, progress bars
- ✅ Admin shells (Job States is live, others scaffolded)
- ✅ Token-gated forms scaffold (`/forms/*`, `/crew-completion`, `/action/confirm`)
- ✅ Edge functions: `iframe-session`, `me`, `logout`, `action-token-consume`, `inbound-sms`, `search`, `health`, `cron-*`
- ✅ Uptiq API wrapper with per-method API version isolation
- ✅ `scheduled_notifications` queue + `cron-drain-notifications`
- ✅ `event_log` with `dedupe_key` idempotency

## What's *not* in Phase 1 (queued)
- Live Uptiq calls (wrapper returns stubs until `UPTIQ_API_TOKEN` is set)
- Photo uploads to Storage
- PO value workflow end-to-end
- Weekly report generation
- Configurable `company_variables` UI + brand theming
- Inbound SMS keyword parsing handlers

## Local dev
The app boots into a Phase-1 dev session against the seeded `DEMO_LOCATION` if no iframe params are present. In production it requires Uptiq iframe params.

## Repo layout
```
src/
  components/AppShell.tsx
  pages/Dashboard.tsx, Search.tsx, admin/*, forms/*
  lib/session.tsx
supabase/
  functions/_shared/{util,uptiq}.ts
  functions/{iframe-session,me,logout,action-token-consume,inbound-sms,search,health,cron-*}/index.ts
  migrations/*.sql
docs/
  ENV.md, DEPLOYMENT.md
```

See `docs/ENV.md` for environment variables and `docs/DEPLOYMENT.md` for per-company onboarding.
