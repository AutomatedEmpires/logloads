# LogLoads — Clerk Activation Runbook

## Founder gate
> **Create the dedicated LogLoads Clerk application and provide/authorize its
> production keys.**

## What the code already does (verified)
- `apps/web/app/layout.tsx` mounts `<ClerkProvider>` only when
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set.
- `apps/web/middleware.ts` runs `clerkMiddleware` and protects `/driver /fleet /host
  /admin` when Clerk is configured; otherwise falls back to the signed dev-session cookie.
- `apps/web/lib/session.ts`: `getSessionActor()` resolves the Clerk user →
  `findProfileByClerkId` → `SessionActor`. A signed-in Clerk user **without** a LogLoads
  profile is routed to `/onboarding` (not a sign-in loop) via `requireCockpitActor` +
  `getClerkUserId`.
- `apps/web/lib/session-actions.ts`: `completeOnboardingAction` reads `auth()`, and when
  Clerk is configured it requires a Clerk session and links the new profile to the Clerk
  user id (`createAccount({ clerkUserId })`).

### The guaranteed post-activation path
`Clerk user signs in` → session resolves → **no profile?** → `/onboarding` →
`completeOnboardingAction` provisions profile+org+membership linked to the Clerk id →
`homePathFor` sends them to their role cockpit. Provisioned users skip onboarding
(the onboarding page redirects an existing actor to `homePathFor`).

## Configuration (all that's needed)
1. Create a Clerk application named **LogLoads** (production instance).
2. **Clerk Organizations: NOT required.** LogLoads has its own org/membership model
   (created during onboarding). Clerk is used purely for user identity.
3. **Roles:** come from the app's membership model, not Clerk. No Clerk roles needed.
4. Set redirect URLs (both to `/onboarding` — provisioned users bounce home automatically):
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding`
5. **Webhook: NOT required.** Profiles are provisioned on-demand at onboarding. (Optional
   later: a `user.created` webhook to pre-provision; the app does not need it.)
6. Production domain: `logloads.com`. Add it as an allowed origin / satellite as Clerk
   requires once the host is live.
7. Store `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` in Doppler → host secrets.

## One-time founder platform-admin claim

Do not onboard the founder through a driver, fleet, or host path. Production
contains one fixed seed admin profile and the controlled claim binds only that
row to one verified Clerk identity.

1. Sign in to the dedicated LogLoads Clerk application and copy the founder's
   exact `user_...` id. Confirm the account has a verified primary email.
2. Set `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` to that one id. No second id,
   wildcard, seed placeholder, or alternate syntax is valid.
3. Compute the lowercase SHA-256 of this exact material (no trailing newline):
   `logloads-platform-admin-scope-v1\n<exact user id>`. Store it as
   `LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256`.
4. Set `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=enabled` and set
   `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT` to a short-lived future
   canonical ISO instant such as `2026-08-05T18:00:00.000Z`. Deploy those names
   without printing their values in logs.
5. While signed in as that exact identity, open `/admin/bootstrap` and choose
   **Claim founder access** once. The route requires same-origin JSON, shared
   rate limiting, the verified Clerk primary email, the exact persistent scope,
   and the unexpired temporary gate. It then performs one canonical CAS update.
6. Verify `/admin` opens and the canonical activity contains one
   `platform_admin_claimed` event for the fixed admin profile. The event stores
   only the scope digest and claim source, not the Clerk id or email.
7. Immediately set `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP=disabled`, remove
   `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT`, and redeploy. Keep the exact
   `LOGLOADS_PLATFORM_ADMIN_CLERK_IDS` and expected scope digest in place; those
   two persistent values continue to authorize the claimed founder.

The operation is idempotent for the same identity and digest. It refuses a
different identity, an already-linked non-admin profile, a second admin, a
replaced seed identity, a missing or changed claim record, or any client-selected
actor, role, or profile id.

## Supabase JWT integration — NOT required for launch
`current_clerk_user_id()` reads `auth.jwt() ->> 'sub'`, used only when authenticated
users query normalized Postgres tables directly. The app currently serves all data
through the server-only, service-role `operating_state` repository, so **no
Clerk↔Supabase JWT template is needed for launch.** Wire it only when browser/session
queries move onto RLS-scoped relational tables.

## Verification after activation
1. `curl https://logloads.com/api/health` → `integrations.auth: "clerk"`.
2. Sign up a fresh user → lands on `/onboarding` → complete a path → arrives at the
   correct cockpit.
3. Sign out, sign back in → goes straight to the cockpit (no onboarding).
4. Confirm `LOGLOADS_ENABLE_DEV_LOGIN` is unset (dev sign-in must be off in prod).
5. Confirm the claimed founder can open `/admin`, while a different Clerk user
   cannot, after the temporary bootstrap gate and expiry have been removed.
