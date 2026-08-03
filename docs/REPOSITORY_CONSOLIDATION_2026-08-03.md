# LogLoads — repository recovery and consolidation record

**Recorded:** 2026-08-03  
**Scope:** repository and artifact recovery only; no branch, tag, stash, provider
resource, production data, or non-repository artifact was deleted or moved.

This record captures the evidence used to resume development from one canonical
source of truth. It is not production-activation evidence. Commercial authority
is the newest entry in [`DECISIONS.md`](DECISIONS.md): `percentage_v1` for new
activity, frozen `legacy_percentage` obligations preserved, and
`subscription_v1` historical/read-only.

## Canonical repository

- Canonical checkout: resolve with `ae path logloads`.
- Remote: `git@github.com:AutomatedEmpires/logloads.git`
- Reconciled `origin/main`:
  `498fd94582efe6222f8900642694f00971cc4a68`
- The local `main` ref was three commits behind `origin/main` during discovery;
  it was not used as recovery authority or mutated during this pass.
- Only one Git worktree was present. No second Windows or Claude source clone
  was found. The managed LogLoads worktree directory was empty.

The recovered `origin/main` sequence is:

1. `ac6174e` — PR #70
2. `0e98786` — PR #71
3. `25d6e6b` — PR #74
4. `b71d584` — PR #75
5. `498fd94` — PR #73

Squash ancestry was verified by effective patch identity, not branch ancestry
alone. PR #74 head `dd36cc84` matches squash `25d6e6b`; PR #75 head `acc39922`
matches squash `b71d584`; and PR #73 head `79d53308` matches squash `498fd94`.
Those heads are preserved merge remnants, not missing application work.

## Preserved unfinished work

### Percentage-v1 enrollment slice

- Branch: `fable/wave-c-five-percent`
- Local and remote head:
  `0a31d36ffbef00a5812e81709921fab3b77ea1ac`
- State: preserved recovery source; its legitimate agreement-enrollment ideas
  were selectively rebuilt in the production-restoration release rather than
  merged wholesale.

The branch added an early billing-enrollment service, exposed
`acceptPercentageBillingAgreement`, and updated a publish refusal. It was not a
complete production slice: the API/server-action/UI path and direct enrollment
coverage were absent. The recovered release now supplies those paths plus the
exact pilot allowlist/fingerprint boundary and one-movement/one-obligation
guard. Retain the old branch as provenance, but do not merge it into current
`main`.

### Open PR #76 — admin and team controls

- Branch/head: `fable/wave-a1-admin-and-team` at
  `853d1c4dba0380b2c287c624ef69c951ee54c6cf`
- Hosted checks were green and GitHub reported it mergeable during discovery.
- It remained blocked: no independent approval and eight current unresolved
  review threads.
- Material blockers include revoked admins retaining contact PII, changing a
  member to `driver` without provisioning a driver profile, and suspended
  drivers retaining private assignment access. Seed-admin allowlisting, role
  validation, and owner-selection behavior also require resolution.

### Open PR #77 — mill administration

- Branch/head: `fable/wave-a2-mills` at
  `33d068db1af087781da77a7a335b6b950e531571`
- Hosted checks were green and GitHub reported it mergeable during discovery.
- It remained blocked: no independent approval and four current unresolved
  review threads.
- Material blockers include globally nonunique mill codes, duplicate detection
  that ignores state, an incorrect auth-test path, and latitude/longitude naming
  drift.

The dropped stash object `2020d953d1853f148b4eb214ae8e8a6f65c518a2`
(`wave-a2-mills WIP`) is fully represented by PR #77's branch, with the branch
also carrying the corrected Supabase Storage comment and tests. Its paired index
object `3692dbd` contains no additional change. Nothing needs to be transplanted
from those objects.

## Local-only preservation reference

- Tag: `preserve/uncommitted-20260722T191612Z`
- Target: `6f74d389999f7c4d1652bc3f930f80700644590f`
- Disposition: retain until a separately authorized cleanup. It preserves an
  early featured-truck implementation whose user-visible behavior and tests are
  already superseded on current `main`; no transplant is currently required.

Other remote topic branches reviewed during recovery were closed, merged by
squash, explicitly non-building WIP later corrected, or replaced by newer PRs.
They are not alternate sources of production truth. They remain untouched so a
future cleanup can be reviewed independently.

## Non-repository artifacts

| Artifact | Classification | Disposition |
|---|---|---|
| Preserved local tool configuration | 112-byte LogLoads tool metadata | Archive only; not application source. Retain until separately authorized cleanup. |
| Agent CLI cache and transcript data | Local runtime cache | Cache only; not source. Eligible for later cleanup, but untouched here. |
| Windows Vercel link/runtime artifact | Four-file deployment-link artifact | Not source. Quarantine or remove in a separate secret-hygiene cleanup after confirming it is no longer needed. Environment values were not read or reported. |
| Windows Codex task directories for LogLoads | Runtime logs and handoffs with no `.git` directory | Preserve as evidence or clean later; never integrate as source. |
| Preserved LogLoads test-evidence bundle | Twelve test-evidence files | Retain as test evidence; not a checkout. |

## Consolidation rules from this recovery

1. Work only from the canonical checkout under an acquired `ae` lease.
2. Compare old squash branches by patch/tree content before assuming they carry
   missing work.
3. Preserve `0a31d36` and resolve PR #76/#77 review blockers before integration;
   do not combine those streams blindly.
4. Keep Supabase Storage as the sole current media provider. Historical
   Cloudinary literals are stored-data compatibility only and must not regain a
   runtime, dependency, credential, or delivery path.
5. Keep `LOGLOADS_FEE_COLLECTION` as the sole current commercial collection
   gate. `LOGLOADS_SUBSCRIPTION_COLLECTION` and
   `LOGLOADS_DISPATCH_SELF_SERVE` remain disabled historical safety gates.
6. Defer all branch/tag/cache/artifact deletion to a separate, explicit cleanup
   after the recovered implementation is merged, remotely verified, and backed
   up.
