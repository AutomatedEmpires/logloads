# LogLoads — Production Environment Contract

Machine-readable source: [`ops/production-env-contract.json`](../ops/production-env-contract.json).
Values live in **Doppler (logloads project)** and the host secret store. Never commit
real values; the Supabase service-role key and all `*_SECRET`/`*_KEY` secrets are
server-only (never `NEXT_PUBLIC_`).

## Required to boot in production
| Variable | Secret | Absent behavior |
|---|---|---|
| `LOGLOADS_SESSION_SECRET` | yes | **throws at startup** (fail-closed) |
| `LOGLOADS_STATE_FILE` (`/data/logloads-state.json`) | no | defaults to `.data/` — loses state on ephemeral FS |
| `NEXT_PUBLIC_APP_URL` (`https://logloads.com`) | no | absolute links/redirects wrong |

## Required for public auth (Clerk gate)
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — without them the app runs on
dev-session auth, which is **not acceptable for public launch**.

## Feature-gated (activate when set; app healthy without them)
| Group | Variables |
|---|---|
| Durability mirror | `SUPABASE_URL` (live: `https://fdzohbiiyzgvjzfsjyxo.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY` (server-only) |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FLEET`, `STRIPE_PRICE_HOST` |
| Email | `RESEND_API_KEY`, `LOGLOADS_EMAIL_FROM`, `LOGLOADS_CONTACT_EMAIL` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Errors | `SENTRY_DSN` |
| Maps | `NEXT_PUBLIC_MAPBOX_TOKEN` (else keyless MapLibre) |

## Must NOT be set in production
- `LOGLOADS_ENABLE_DEV_LOGIN` — staging only; enables credential-free sign-in.

## Present in `.env.example` but unused by code
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — checkout uses Stripe hosted Checkout (no client Stripe.js).
- `DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF` — schema/tooling reference only; runtime does not read them. (The anon key is intentionally NOT used at runtime; the mirror is service-role only.)
