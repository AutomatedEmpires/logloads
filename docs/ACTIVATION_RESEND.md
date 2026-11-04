# LogLoads — Resend Email Activation and Delivery Policy

> **Status:** Revised 2026-11-01.
> - §1–§3 are IMPLEMENTED: the existing, key-gated email integration in code at `15892b7`.
> - §4 is TARGET.
>
> This document authorizes no campaign, broadcast, production key, or DNS change. The earlier Resend account
> was deleted for the fresh start; creating the new one (domain, DNS, keys per environment) is
> [`INTEGRATIONS.md`](./INTEGRATIONS.md) §7.

## 1. What the code does today (IMPLEMENTED)

Outbound email lives in `apps/web/lib/notify.ts`. It **fails open honestly**: without `RESEND_API_KEY`,
delivery is skipped and the in-app record remains the source of truth. The code never reports a false
success.

- `deliverEmail({ to, subject, text })` POSTs to Resend with an 8-second timeout. It returns `false` on any
  failure and never throws. It does not retry.
- `isEmailDeliveryEnabled()` gates callers on `RESEND_API_KEY`.
- **From:** `RESEND_FROM`, then the compatibility `LOGLOADS_EMAIL_FROM`, then the default
  `LogLoads <notifications@logloads.com>`. The default applies to `notify.ts` only: the billing outbox has no
  default, so without `RESEND_FROM` or `LOGLOADS_EMAIL_FROM` its email stays queued.
- **Reply-to:** `RESEND_REPLY_TO`, then `SUPPORT_EMAIL`, then the compatibility `LOGLOADS_EMAIL_REPLY_TO`,
  then `support@logloads.com`.
- **Contact form** (`apps/web/lib/contact-actions.ts`) emails `LOGLOADS_CONTACT_EMAIL` and always writes an
  in-app platform-admin notification, whatever the email outcome.
- **Historical billing notifications** (`apps/web/lib/billing-notification-email.ts`) form a transactional
  outbox. Sends happen only when the relevant historical collection gate is enabled. Those gates stay disabled
  ([`ENV_CONTRACT.md`](./ENV_CONTRACT.md)).
- The `/v2` preview sends **no email**. Interest and reply notifications are in-app only, or not yet built.

An in-app notification, an API `200`, or `integrations.email=true` is not proof of delivery. Check Resend's
delivery events.

## 2. Sender configuration (IMPLEMENTED)

- `RESEND_API_KEY` — a server secret with **Sending** access restricted to the verified `logloads.com`
  domain. Never substitute a shared, cross-account, or unrestricted key.
- Canonical identities in every environment:

  ```dotenv
  RESEND_FROM="LogLoads <notifications@logloads.com>"
  RESEND_REPLY_TO="support@logloads.com"
  SUPPORT_EMAIL="support@logloads.com"
  LOGLOADS_CONTACT_EMAIL="support@logloads.com"
  ```

- `LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` are compatibility fallbacks, not the canonical
  controls.

Never put a raw key, a personal address, a private landing contact, or a recipient list into code, logs, test
reports, or Git.

## 3. Controlled activation and test (IMPLEMENTED pilot path)

1. Confirm domain ownership, DKIM/SPF, sending-key scope, and the recipient identities.
2. Keep the production `RESEND_API_KEY` absent until the founder explicitly authorizes it. Development and
   Preview may use a domain-scoped key with **controlled test recipients**.
3. Run `pnpm --filter @logloads/web exec vitest run lib/notify.test.ts`. It verifies the exact sender/reply
   payload and the no-key/no-fetch behavior.
4. After authorized activation, submit `/contact` and confirm two things: the email arrives at
   `LOGLOADS_CONTACT_EMAIL`, and the in-app admin notification exists.
5. Record the environment, exact SHA, recipient *category* (not the address), the Resend event status, and
   cleanup.

## 4. Future V2 email types (TARGET — not live because listed)

- Opted-in **targeted job invitations** to hauler businesses, with relevance, unsubscribe/mute, and frequency
  limits.
- "Interest received" and "interest replied" notices to the right business participants.
- Saved-search digests and job-change alerts, only with explicit preference and frequency controls.
- Account, security, and other necessary transactional notices, kept legally distinct from marketing.

**Invitation billing is stricter than ordinary notices.** An undelivered invitation must never permanently
consume an included credit. Before paid invitations launch, define "delivered", and test atomic reservation,
per-recipient caps, retry idempotency, and a single refund on failure.

Templates must never carry gate codes, non-public coordinates, credentials, or private correspondence. They
must not imply the recipient is hired, contracted, or dispatched. Public broadcasts, imported recipient lists,
and marketing campaigns need founder approval, lawful consent, and unsubscribe controls. Assignment and trip
emails are historical concepts and are not V2 requirements.
