# LogLoads docs

Start with [`AGENTS.md`](../AGENTS.md), then [HANDOFF.md](./HANDOFF.md).

## Orientation

| Doc | Read it for |
|---|---|
| [HANDOFF.md](./HANDOFF.md) | Current state, ranked open work, traps |
| [WORKFLOW.md](./WORKFLOW.md) | Branch → validate → PR, review checklist, CI workflows |
| [DECISIONS.md](./DECISIONS.md) | Dated, append-only decision log (newest first) |
| [PROVIDERS.md](./PROVIDERS.md) | Every third-party service, its gate and its code |

## Architecture

| Doc | Covers |
|---|---|
| [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Package responsibilities and runtime shape |
| [DATA_MODEL.md](./DATA_MODEL.md) | Canonical entities |
| [API_CONTRACTS.md](./API_CONTRACTS.md) | HTTP routes and their contracts |
| [SECURITY.md](./SECURITY.md) | Database security posture, RLS, grants |

## Operations

| Doc | Covers |
|---|---|
| [ENV_CONTRACT.md](./ENV_CONTRACT.md) | Production variables: required, optional, absent behavior |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Local development, local Supabase, sessions, rate limiting |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Vercel runtime contract, preview gates, rollback |
| [RECOVERY.md](./RECOVERY.md) | Backing up and restoring `operating_state` |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | PostHog and Sentry |
| [ACTIVATION_CLERK.md](./ACTIVATION_CLERK.md) · [ACTIVATION_RESEND.md](./ACTIVATION_RESEND.md) · [ACTIVATION_STRIPE.md](./ACTIVATION_STRIPE.md) | Provider activation runbooks |

## Product

| Doc | Covers |
|---|---|
| [PILOT_LAUNCH.md](./PILOT_LAUNCH.md) | Public Pilot Center, assisted rehearsal, live founding pilot |

## Archive

[archive/](./archive/) holds superseded handoffs, audits, the historical
subscription contract, and the percentage-model design spec. They are kept as
evidence; when they conflict with current docs, current docs win.
