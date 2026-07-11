# LogLoads — Resend Activation Runbook

Outbound email is wired and key-gated (`apps/web/lib/notify.ts`). It **fails open
honestly**: without `RESEND_API_KEY`, delivery is skipped and the in-app record remains
the source of truth — the code never reports a false success.

## Founder gate
> **Create/authorize a Resend account, add a `logloads.com` sending domain with DNS
> verification, and provide the API key.**

## What the code does
- `deliverEmail({ to, subject, text })` POSTs to `https://api.resend.com/emails` with a
  4s timeout; returns `false` (never throws) on any failure. No retry (fire-and-forget).
- `isEmailDeliveryEnabled()` gates callers on `RESEND_API_KEY`.
- **From identity:** `LOGLOADS_EMAIL_FROM` (default `LogLoads <onboarding@resend.dev>` —
  replace with a `logloads.com` sender at activation).
- **Support/reply identity:** `LOGLOADS_EMAIL_REPLY_TO` defaults to the existing
  `support@logloads.com` mailbox.
- **Current email-triggering event:** contact-form inquiries
  (`apps/web/lib/contact-actions.ts`) → emails `LOGLOADS_CONTACT_EMAIL`
  (default `support@logloads.com`) AND writes an in-app notification to the
  platform admin. The in-app record is always written regardless of email outcome.

## Configuration
1. Create Resend account (or reuse the family account).
2. Add sending domain: recommended **`send.logloads.com`** (subdomain isolates
   deliverability reputation from the apex).
3. Add the DNS records Resend provides (SPF/DKIM/DMARC) at the `logloads.com` DNS
   provider; wait for verification.
4. Create an API key; store `RESEND_API_KEY` in Doppler → host.
5. Set `LOGLOADS_EMAIL_FROM="LogLoads <noreply@send.logloads.com>"`, keep
   `LOGLOADS_EMAIL_REPLY_TO=support@logloads.com`, and confirm
   `LOGLOADS_CONTACT_EMAIL=support@logloads.com`.

## Activation path (once account + DNS exist)
`create domain` → `add DNS` → `verify` → `set RESEND_API_KEY + LOGLOADS_EMAIL_FROM` →
`deploy` → submit the `/contact` form on production → confirm the email arrives in the
operations inbox and the in-app admin notification is written.

## Verification
- `curl https://logloads.com/api/health` → `integrations.email: true`.
- Submit `/contact` with a test message → email delivered to `LOGLOADS_CONTACT_EMAIL`;
  the admin's in-app notifications show the inquiry.
- Confirm fail-open: with the key temporarily unset, the contact form still succeeds
  (in-app record written) and shows no false "email sent" claim.

## Recipients to confirm with the founder
- Operations/contact inbox (`LOGLOADS_CONTACT_EMAIL`).
- Future operating emails (assignment confirmations, notices) are not yet wired to
  email — they live as in-app notifications. When those are promoted to email, they use
  the same `deliverEmail` path and the recipient is the affected user's profile email.
