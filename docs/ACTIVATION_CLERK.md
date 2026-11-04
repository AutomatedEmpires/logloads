# LogLoads — Clerk Identity Activation and Normalized-V2 Authorization

> **Status:** Last verified 2026-11-02.
> - §1–§3 are IMPLEMENTED: they describe the existing pilot integration in code at `4c9518e`.
> - §4 is TARGET.
>
> Do not activate a new environment, run the founder-admin claim, or migrate identities just by following
> this document. Each needs explicit, scoped authorization. Verify the live provider state first, read-only.

## 1. What Clerk does today (IMPLEMENTED)

Clerk is the identity provider. LogLoads organizations, memberships, and roles live inside LogLoads, **not**
in Clerk Organizations or Clerk roles.

- `apps/web/app/layout.tsx` mounts `<ClerkProvider>` only when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set.
- `apps/web/middleware.ts` runs `clerkMiddleware` and, when Clerk is configured, protects the pilot
  workspaces (`/driver`, `/fleet`, `/host`, `/admin`). Otherwise it falls back to the signed development
  session cookie.
- `apps/web/lib/session.ts` — `getSessionActor()` resolves the Clerk user to a LogLoads profile
  (`findProfileByClerkId`). A signed-in Clerk user **without** a profile goes to `/onboarding`, not a sign-in
  loop.
- `apps/web/lib/session-actions.ts` — when Clerk is configured, onboarding requires a Clerk session and links
  the new profile to the Clerk user ID.
- The `/v2` preview uses the same session: actions call `getSessionActor()`, and pages call
  `resolveV2Viewer()`. Both require an active organization ([`SECURITY.md`](./SECURITY.md) §3).

**Local development sessions** work only under the loopback and non-production safeguards
([`ENVIRONMENT.md`](./ENVIRONMENT.md) §3). `LOGLOADS_ENABLE_DEV_LOGIN` must never be set in production or on a
public hosted preview. Never mix one Clerk instance's keys with another environment's identities.

## 2. Configuration checklist (IMPLEMENTED pilot)

1. Use a dedicated **LogLoads** Clerk application, with separate development and production instances.
2. Clerk Organizations, Clerk roles, and a `user.created` webhook are **not required**. Profiles are
   provisioned at onboarding.
3. Redirects: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, and both
   fallback redirect URLs set to `/onboarding`. Already-provisioned users are sent home automatically.
4. Register `logloads.com` and any approved preview origins. Developer origins must not give hosted
   environments an identity shortcut.
5. Store `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (browser-visible) and `CLERK_SECRET_KEY` (server-only) through
   the approved Doppler-to-host path.
6. Test: new user, sign-out and sign-in, removed membership, multi-organization switching, and direct-URL
   access without authorization.

## 3. One-time founder platform-admin claim (IMPLEMENTED pilot, sensitive)

The pilot has one fixed seed admin profile. A controlled claim binds that row to exactly one verified Clerk
identity. **Running it is a production operation and needs the founder's explicit authorization.**

1. Sign in to the LogLoads Clerk application and copy the founder's exact `user_...` ID. Confirm the account
   has a verified primary email.
2. Set `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` to that one ID. A second ID, a wildcard, the seed placeholder, or
   any alternate syntax is invalid and fails closed.
3. Compute the lowercase SHA-256 of `logloads-platform-admin-scope-v1`, one newline, and the exact user ID
   (no trailing newline). Store it as `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`.
4. Set `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=enabled`, and set `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT` to
   a short-lived future ISO instant. Deploy without printing either value.
5. Signed in as that identity, open `/admin/bootstrap` and choose **Claim founder access** once. The route
   requires:
   - same-origin JSON;
   - shared rate limits;
   - the verified primary email;
   - the exact persistent scope;
   - the unexpired temporary gate.

   It then performs one canonical compare-and-swap update.
6. Verify that `/admin` opens and that one `platform_admin_claimed` audit event exists. The event stores only
   the scope digest and the claim source.
7. **Immediately** set the bootstrap gate back to `disabled`, remove its expiry, and redeploy. Keep the
   persistent ID and digest: they continue to authorize the founder.

The claim is idempotent for the same identity. It refuses a different identity, a second admin, a replaced
seed identity, and any client-selected actor or profile. Never copy a seed placeholder, broaden the
allowlist, leave the temporary gate active, or log the digest or ID.

**Verification after activation:**

- `/api/health` reports `integrations.auth: "clerk"`.
- A fresh sign-up lands on `/onboarding`.
- A returning user skips onboarding.
- `LOGLOADS_ENABLE_DEV_LOGIN` is unset.
- Only the claimed founder can open `/admin`.

## 4. Normalized V2: the Clerk → Supabase boundary (TARGET, not live)

The pilot does **not** use Clerk JWTs against Supabase. All data is served through the server-only,
service-role `operating_state` repository, so no Clerk-to-Supabase integration is configured or needed today.
The pilot schema's `current_clerk_user_id()` helper reads `auth.jwt() ->> 'sub'` and is unused on the live
request path.

Gemini's schema (`architecture/normalized-v2/`; validated copy on `test/normalized-v2-postgres17-ci`) designs
`trusted_identity_issuers`, `identity_links`, `app_users`, and strict claim inspection
([`SECURITY.md`](./SECURITY.md) §4). Its SQL-level claim inspection is **VERIFIED with simulated claims**
([`CI.md`](./CI.md) §3). None of it is operational until real-token verification succeeds
on a disposable database and an application integration exists.

Required proof before the application relies on normalized RLS:

1. Configure Supabase's third-party auth integration for the **correct** Clerk environment, starting with
   development. Supabase validates signature, issuer, JWKS, and expiry at its API gateway. SQL claim checks
   with simulated claims cannot substitute for that cryptographic verification.
   The development setup steps and the one-command check are [`SECURITY.md`](./SECURITY.md) §5.1.
2. Require explicit, valid identity and role claims. Never fall back from a missing role to an authorized
   role. Treat user-editable metadata as untrusted.
3. Link a verified `(issuer, subject)` to exactly one application user. Disabled or suspended users must fail
   closed. Never link identities by matching email alone.
4. Test anon, authenticated, unrelated tenant, multi-organization switching, removed membership, private
   landing disclosure, and platform-admin separation.
5. Review `SECURITY DEFINER` functions, `search_path`, grants, and Data API schema exposure.
6. Prove the exact access path the app will use. A service-role connection bypasses RLS. Never claim RLS
   protection on that path.
7. Reconcile historical identity mapping without creating duplicate application users or moving tenant
   records to a different Clerk identity.

Production key entry, identity migration, and enabling the integration are founder actions. None of them
activates paid plans.
