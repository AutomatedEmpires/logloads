# LogLoads — Clerk Activation Runbook

The code path is complete and the sign-in loop is fixed. This reduces Clerk to **one
founder action**.

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
