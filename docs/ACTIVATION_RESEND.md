# LogLoads — Resend Activation Runbook

Outbound email is wired and key-gated (`apps/web/lib/notify.ts`). It **fails open
honestly**: without `RESEND_API_KEY`, delivery is skipped and the in-app record remains
the source of truth — the code never reports a false success.

## Founder gate
> **Activate only with a Resend API key whose Sending access is restricted to the
> verified `logloads.com` domain. Send as `LogLoads <notifications@logloads.com>` and
> route replies to `support@logloads.com`. Do not substitute a shared, cross-account,
> or unrestricted key.**

Keep the Production `RESEND_API_KEY` absent until this identity change is merged and
the production activation is explicitly authorized. Development and Preview may use
the domain-scoped key for pre-production verification.

## What the code does
- `deliverEmail({ to, subject, text })` POSTs to `https://api.resend.com/emails` with a
  8s timeout; returns `false` (never throws) on any failure. No retry (fire-and-forget).
- `isEmailDeliveryEnabled()` gates callers on `RESEND_API_KEY`.
- **From identity:** `RESEND_FROM`, then legacy `LOGLOADS_EMAIL_FROM`, then the safe
  default `LogLoads <notifications@logloads.com>`.
- **Support/reply identity:** `RESEND_REPLY_TO`, then `SUPPORT_EMAIL`, then legacy
  `LOGLOADS_EMAIL_REPLY_TO`, then the safe default `support@logloads.com`.
- **Current email-triggering event:** contact-form inquiries
  (`apps/web/lib/contact-actions.ts`) → emails `LOGLOADS_CONTACT_EMAIL`
  (default `support@logloads.com`) AND writes an in-app notification to the
  platform admin. The in-app record is always written regardless of email outcome.

## Configuration
1. Confirm `logloads.com` remains verified in Resend. If verification is absent, stop;
   do not switch to another product's domain or sender.
2. Confirm the API key has **Sending** access restricted only to `logloads.com`. Store
   `RESEND_API_KEY` through the approved Doppler-to-host path; never expose it to the
   browser or commit it.
3. Keep the canonical identity values aligned in every environment:

   ```dotenv
   RESEND_FROM="LogLoads <notifications@logloads.com>"
   RESEND_REPLY_TO="support@logloads.com"
   SUPPORT_EMAIL="support@logloads.com"
   LOGLOADS_CONTACT_EMAIL="support@logloads.com"
   ```

   `LOGLOADS_EMAIL_FROM` and `LOGLOADS_EMAIL_REPLY_TO` remain compatibility fallbacks,
   not the canonical controls.

## Activation path
`merge the identity fix` → `confirm domain-scoped key + canonical identities` →
`authorize Production RESEND_API_KEY` → `deploy` → `submit the /contact form` →
`confirm email delivery + the in-app admin notification`.

This activates coordination notifications only. It does not make LogLoads a freight
broker, payment handler, or authority for money-moving communication.

## Verification
- `curl https://logloads.com/api/health` → `integrations.email: true`.
- Submit `/contact` with a test message → email delivered to `LOGLOADS_CONTACT_EMAIL`;
  the admin's in-app notifications show the inquiry.
- Run `corepack pnpm --filter @logloads/web exec vitest run lib/notify.test.ts` to verify
  the exact sender/reply payload and the no-key/no-fetch behavior. Do not remove a
  Production credential solely to exercise the fail-open path.

## Recipients to confirm with the founder
- Operations/contact inbox (`LOGLOADS_CONTACT_EMAIL`).
- Future operating emails (assignment confirmations, notices) are not yet wired to
  email — they live as in-app notifications. When those are promoted to email, they use
  the same `deliverEmail` path and the recipient is the affected user's profile email.
