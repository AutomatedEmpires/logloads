# LogLoads — Clerk Identity Activation and Normalized-V2 Authorization

> **Status:** Existing Clerk integration and future Supabase RLS trust boundary. Do not activate a new public environment, provision founder admin, or migrate user identities solely by following this document. Verify current provider state and code first.

## What Clerk does today

Clerk is the application identity provider. In the current pilot, `apps/web/app/layout.tsx` conditionally mounts the Clerk provider, `apps/web/middleware.ts` protects authenticated paths when configured, and `apps/web/lib/session.ts` resolves Clerk user IDs to existing LogLoads application profiles. Organization memberships and roles live inside LogLoads, **not Clerk Organizations**. A new valid Clerk user without an app profile should be directed through authorized onboarding; an existing member should resolve to the correct workspace.

Local signed development sessions are permitted only under the documented nonproduction/loopback safeguards. `LOGLOADS_ENABLE_DEV_LOGIN` must not be enabled in real production. An application or session configured with keys for one Clerk instance must not be silently combined with another environment's identities.

## Environment and setup checklist

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — browser-visible, environment-specific.
- `CLERK_SECRET_KEY` — server-only, environment-specific.
- Document sign-in/sign-up routes and post-auth onboarding redirects in the verified Clerk configuration, not merely as aspirational values.
- Confirm `logloads.com` and any preview origins are correctly registered, and that developer origins do not grant hosted identity shortcuts.
- Confirm new user, sign-out/sign-in, removed membership, multi-organization switching and unauthorized direct URL access.

## Existing founder-admin claim — conditional historical path

The pilot may still use `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS`, `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`, and the temporary `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP` / `_EXPIRES_AT` claim gate. These are sensitive administrative controls. Never copy a seed placeholder, broaden the allowlist, invent a founder identity, leave temporary gates active or expose scoped hashes/secrets in logs. The full legacy workflow remains in Git history and earlier runbook versions; any new claim requires a separately scoped operator authorization.

## Normalized V2: Clerk → Supabase boundary (TARGET, not live)

Gemini's proposed `marketplace.trusted_identity_issuers`, `identity_links`, `app_users` and RLS functions are **not operational** until the prototype runs successfully in disposable PostgreSQL and an integration path is implemented.

Required proof before the application relies on normalized RLS:

1. Configure the supported Supabase third-party authentication integration for the *correct* Clerk environment. Supabase validates token signature, trusted issuer/JWKS, expiry and any required audience at its API boundary. SQL claim checks cannot substitute for cryptographic verification.
2. Require explicit valid identity/role claims; **never** fall back from an absent role claim to an authorized role. Treat user-controlled metadata as untrusted for permissions.
3. Link a verified `(issuer, subject)` to exactly the intended application user and confirm disabled/suspended users fail closed. Enforce organization memberships and scoped landing/hauler permissions in the database.
4. Test anon vs authenticated vs unrelated tenant, multi-org switching, removed membership, service-role/server access, private landing disclosure, and platform-admin separation.
5. Review `SECURITY DEFINER` functions, search paths, grants and Supabase Data API schema exposure; use minimal RPCs and negative tests.
6. Prove the exact access path used by the app: if server actions connect with service-role credentials, they may bypass user RLS unless the request is deliberately scoped through a verified auth context. Never claim RLS protection on that bypassing path.
7. Reconcile historical identity mapping; do not create duplicate app users or transfer tenant records to a new Clerk identity by matching email alone.

## Verification and rollout

Run safe sign-up/onboarding tests in a dedicated Clerk development tenancy with isolated data. Confirm app profile creation, role-scoped landing/hauler access, organization switching, sign-out and denial after membership removal. Record commit SHA and exact environments. Production key entry or migration requires explicit human action, and does not activate marketplace paid plans by itself.
