# Uptiq Messaging & Contacts — Integration + Live-Test Status

_Last updated: 2026-07-13 (staging: "Uptiq Staging", location `JrBcbFAsvPtRlR0UfaLj`, company `0-152-331`)._

## TL;DR — "Have we done the full live test to Uptiq with messages + emails?"

**Partially — the pipeline is proven live, but not a comprehensive all-flows pass.**
- **SMS:** ✅ sent live through Uptiq — **9 successful** sends (last 2026-06-16), plus 5 failures on 2026-06-12 that were the pre-B9 token-scope bug (since fixed).
- **Email:** ✅ sent live through Uptiq — **2 successful** sends (2026-06-16).
- **What that proves:** the outbound path (app → `scheduled_notifications` → `cron-drain-notifications` → Uptiq `/conversations/messages` by `contactId`) works live for both SMS and email.
- **What's NOT done:** a full pass across *every* template/flow, on real contacts, recently. The sends above were spot-checks during earlier lifecycle testing (~1 month ago) on a handful of test contacts. **Inbound** SMS (the `LOG`/quick-log reply flow) was never wired live. That comprehensive pass is what the CJ → Murphy → A2P walkthrough is for.

## How the integration works

All contact + messaging traffic goes through **one file** — `supabase/functions/_shared/uptiq.ts` — the single **swap-point** if we move to a different A2P provider later. It talks to Uptiq/GoHighLevel (LeadConnector, `https://services.leadconnectorhq.com`).

- **Messaging is contact-addressed:** SMS/email are sent to a **contact id** (`/conversations/messages`), never a raw phone/email. So every recipient needs a Uptiq contact id stored on their app record (`contacts.uptiq_contact_id`, `supply_house_contacts.uptiq_contact_id`, `company_settings.owner_contact_id`/`office_contact_id`).
- **Nothing sends inline:** handlers enqueue `scheduled_notifications` rows; `cron-drain-notifications` (every 15 min) renders + sends. So a message can take up to ~15 min.

## Token scopes (the gating factor)

The `UPTIQ_API_TOKEN` is a per-location token. Current scope state (verified live 2026-07-13):

| Capability | Scope | Status | Evidence |
|---|---|---|---|
| Send SMS / Email | Conversations **write** | ✅ have it | 9 SMS + 2 email sent live (added in B9) |
| Tag contacts | Contacts (tags) | ✅ have it | `applyTag`/`removeTag` wired |
| **Read** contacts | Contacts **read** | ✅ have it | `contacts-sync` link mode returns results (no 401) |
| **Create/update** contacts | Contacts **write** | ❌ missing | `POST /contacts/upsert` → `401 "The token is not authorized for this scope."` |

**Decision (Tyler, 2026-07-13):** for now the app only needs to **read** contacts (link to existing ones). Creating contacts (Contacts **write** scope) is deferred — enable it later when we want the app to auto-create contacts in Uptiq.

> Note: this is separate from **A2P/10DLC**. A2P is currently **off**, which only means outbound texts don't reach real phones — they still appear on the Uptiq side, which is fine for testing. A2P is enabled when we install in Murphy's account.

## The `contacts-sync` tool

Edge function `contacts-sync` (admin-gated: owner_admin/support_admin). Reconciles app parties (job customers, crew, supply houses, owner, office) with Uptiq contacts. Body options:
- `{ "mode": "link" }` **(default, read-only)** — finds each party in Uptiq by email/phone and stores the matching **contact id** on the app record. No writes to Uptiq. **This is the current, working mode.**
- `{ "mode": "upsert" }` — create/update contacts in Uptiq. **Blocked** until the Contacts write scope is added.
- `{ "dry_run": true }` — plan only, no Uptiq calls.
- `{ "limit": N }` — cap how many parties are processed (used to scope-check with one live call).

### Live link run — 2026-07-13 (read-only, all 19 reachable parties)
- **2 linked** — the real "Tyler" contacts that already exist in Uptiq.
- **~14 not in Uptiq** — the staging test-data parties (`@example.com` customers, seeded crew, seeded supply houses). Expected: those aren't real Uptiq contacts. On a real account (Murphy's), real customers/crew would link.
- A few lookups returned transient errors that cleared on retry (Uptiq rate-limit blips).

**Implication for CJ's "everything shows up in contacts" check:** on **staging** most parties are fake test data not present in Uptiq, so the link run mostly reports "not in Uptiq." The meaningful contacts test is on an account with **real** contacts — i.e., Murphy's Uptiq account after install. The `link` run is the tool to verify it: it reports exactly which app parties are (and aren't) present in Uptiq contacts.

## What's verified vs. pending

**Verified working (live):**
- Outbound **SMS** to Uptiq (9 sends).
- Outbound **Email** to Uptiq (2 sends).
- Contacts **read/link** (find existing contact by email/phone, store id).
- Messaging to any party that has a stored `uptiq_contact_id`.

**Pending / next steps:**
1. **Contacts write scope** (later) — to let the app auto-create contacts in Uptiq (`upsert` mode). Not needed now.
2. **A2P/10DLC registration** — in Murphy's Uptiq account, to deliver texts to real phones.
3. **Comprehensive live pass** — during the walkthrough, exercise every notification/email template end-to-end on real contacts (check-in, inspection notices, decisions, walkthrough, supply-house parts order, weekly/completion reports), and confirm each lands on the Uptiq side.
4. **Inbound SMS** (`LOG`/quick-log) — never wired in v2; enable + test if that flow is in scope.

## Files
- Provider (swap-point): `supabase/functions/_shared/uptiq.ts` (`upsertContact`, `findContacts`, `sendSms`, `sendEmail`, tags).
- Sync tool: `supabase/functions/contacts-sync/index.ts`.
- Send pipeline: `_shared/notifications.ts` (render) → `cron-drain-notifications` (send).
