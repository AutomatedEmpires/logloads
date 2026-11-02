# LogLoads — Resend Email Activation and Delivery Policy

> **Status:** Current conditional email integration; V2 marketplace notification design remains pending. No public email campaigns or transactional blasts are authorized by this document.

## Existing behavior

The current application has an email transport in `apps/web/lib/notify.ts` using Resend when `RESEND_API_KEY` is available. The previous documented contact-form action writes an in-app platform-admin record and may attempt delivery to the configured contact mailbox. An in-app notification is not evidence of successful email delivery. Check code, return values and actual Resend delivery events before asserting an email was sent.

The existing delivery helper can report a failed/skipped attempt without breaking the business mutation. For V2, that is acceptable for non-critical notifications if the UI accurately describes status. **Targeted invitation billing is different:** an undelivered invitation cannot permanently consume an included invitation credit. Delivery receipt, timeout/retry, idempotency and quota reversal must be formally tested before paid invitations launch.

## Sender and configuration

- `RESEND_API_KEY` — server secret scoped, when supported, to verified `logloads.com` sending rights only.
- `RESEND_FROM` — intended sender identity, for example `LogLoads <notifications@logloads.com>`, after domain verification.
- `RESEND_REPLY_TO` and `SUPPORT_EMAIL` — approved monitored support mailbox.
- `LOGLOADS_CONTACT_EMAIL` — approved inbound contact recipient.
- `LOGLOADS_EMAIL_FROM`, `LOGLOADS_EMAIL_REPLY_TO` — compatibility fallbacks where the code still supports them.

Never add a raw email key, personal address, private landing contact, or unredacted recipient list to code, logs, test reports or Git. Do not substitute a key from another project or domain. Provider access and permitted sending volume depend on the actual Resend account settings, not this document.

## Future V2 email types — not live merely because listed

- Hauler opted-in targeted job invitations, including equipment/region relevance and unsubscribe/mute preferences.
- Inquiry received / inquiry responded notifications to the correct business participants.
- Saved-search digests and job-change alerts only with explicit preference and frequency controls.
- Account verification, security and necessary transactional notifications with appropriate legal/consent distinction.

Do not send precise gate codes, nonpublic site coordinates, credentials or private correspondence in a generic email template. Avoid implying that a recipient is contracted, hired or dispatched.

## Controlled activation and test

1. Verify domain ownership, DKIM/SPF as applicable, sending-key scope, and recipient identity.
2. Use **controlled test recipients** in nonproduction and confirm actual delivery plus bounce/failure behavior; don't trigger public broadcasts.
3. Verify from/reply-to values and suppression/unsubscribe semantics. Inspect provider status rather than treating `integrations.email=true` as delivered proof.
4. For future invitation dispatch, demonstrate atomic reservation, per-recipient frequency cap, accepted-delivery definition, retry idempotency, failure refund and explicit customer status.
5. Require approval before adding production keys, changing DNS, activating customer-facing sends or running any marketing campaign.

Record environment, exact SHA, recipient category (not full address), channel, actual Resend event status and cleanup. Existing assignment/trip email concepts are historical and are not V2 product requirements.
