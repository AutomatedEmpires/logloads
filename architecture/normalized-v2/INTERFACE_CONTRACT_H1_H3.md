# Interface contract for the V2 adapter — H1, H2, H3 (+ F3, F4)

**For:** Codex / Agent 2 (owners of `apps/web/lib/marketplace-v2/*`, `packages/contracts/src/marketplace-*.ts`, V2 UI and server actions).
**From:** Agent 1 (database). Nothing in those files was changed by Agent 1; this document is the handoff.
**Database side:** `architecture/normalized-v2/06`, `11`, `12` on PR #123. Verified on PostgreSQL 17 and on a Supabase local stack (CI job `supabase-local-stack`).

## 0. How every call is made

* PostgREST RPC, schema `marketplace` (`Content-Profile: marketplace` / `Accept-Profile: marketplace`), **with the signed-in user's JWT** (Clerk session token via Supabase third-party auth). Never with the service key: `service_role` holds no EXECUTE on any user RPC and gets `42501`.
* The project's API settings must expose the `marketplace` schema (`api.schemas` / "Exposed schemas").
* The token must carry `role = authenticated`, `iss` = an enabled row in `marketplace.trusted_identity_issuers`, `aud` = that row's `expected_audience`, `sub` = the Clerk user id, and a future `exp`. Otherwise the database resolves no user and every user RPC returns `42501`.
* Errors arrive as PostgREST JSON `{ code, message, details, hint }`. **Branch on `code` (SQLSTATE), never on message text.** Messages are written for people and may be shown, but they can change.

| `code` | Meaning | Adapter / UI handling |
|---|---|---|
| `23514` | A business rule refused the request (validation, state) | Show `message` next to the form; do not retry |
| `42501` | Not allowed (role, organization, moderation hold) | Forbidden state; do not retry |
| `P0002` | Not found (or draft already published) | Not-found / stale-page state |
| `22023` | Malformed input (adapter bug) | Log; generic error |
| `PGRST301`/`PGRST303` | Token invalid / expired (refused by PostgREST before the database) | Refresh the session, then retry once |

## H1. Publishing requires an explicit availability attestation (V2-DEC-03) and stated pay (V2-DEC-02)

**Port change (required):**

```ts
publishJob(
  viewer: MarketplaceV2Viewer,
  draft: MarketplaceJobDraft,
  attestation: { attestAvailable: true }   // the poster ticked "This opportunity is currently available"
): Promise<{ jobId: string }>
```

The UI must collect the attestation as an explicit, unticked-by-default control at publish time; never default it to true, never persist it across publishes. Passing `false`/omitting it is refused by the database.

**RPC:** `publish_job_posting`

| Draft field | RPC argument | Notes |
|---|---|---|
| `landingId` | `p_landing_id` | must be one of `authoringLandings(viewer)` |
| `title` | `p_title` | 3–140 chars |
| `equipment` | `p_equipment_codes` | ≥ 1 code |
| `trucksRequested` | `p_trucks_requested` | required to publish (1–9999) |
| `trucksPerDay` | `p_trucks_per_day` | ≤ `trucksRequested` |
| `payUnit` | `p_pay_unit` | **required to publish** |
| `payAmount` (dollars) | `p_pay_amount_cents` | `Math.round(payAmount * 100)`; must be > 0 unless `payUnit = 'negotiable'` (then omit and send `p_pay_note` ≥ 3 chars) |
| `payNote` | `p_pay_note` | |
| `workStartsOn` / `durationDays` | `p_work_starts_on` / `p_duration_days` | duration requires a start date |
| `estLoadsPerTruckPerDay`, `estDailyLoads`, `estTonsPerLoad`, `destinationLabel`, `estOneWayMiles`, `publicRoadNotes`, `description`, `product` | same names, `p_` + snake_case | |
| — | `p_attest_available` | **`true` from the attestation argument** |
| server draft id (if H4 adopted) | `p_draft_job_id` | publishes that draft in place |

Returns the job id (uuid). An identical active job at the same landing returns the existing id (safe to retry). The publisher and the server time are recorded as the first confirmation.

**Contract change (required):** the publish path must validate pay as required. Today `marketplaceJobDraftSchema` allows `payUnit` and `payAmount` to be absent; the database refuses that with `23514`. Split into a lenient *draft* schema and a strict *publish* schema (pay required; negotiable needs a note and no amount).

**Reconfirm** (`reconfirmJob(viewer, jobId)` → `reconfirm_job_posting(p_job_id)`) is unchanged: the call itself is the attestation. It is refused for a legacy posting without pay (F2, `23514`).

## F3. Re-activation is its own attested operation (new port method)

The database no longer lets a status change put a paused, filled, closed or expired posting back on the marketplace. Add:

```ts
setJobStatus(viewer, jobId, status: "paused" | "filled" | "closed" | "expired"): Promise<void>  // set_job_posting_status
reactivateJob(viewer, jobId, attestation: { attestAvailable: true }): Promise<{ confirmedAt: string }>  // reactivate_job_posting(p_job_id, p_attest_available)
```

* `set_job_posting_status(..., 'active')` on a non-active posting now returns `23514`; use `reactivateJob`.
* `reactivateJob` refusals: no/false attestation, already active, expired (re-publish instead), no valid pay → `23514`; moderation hold or not the organization's desk → `42501`. Show the message; for `42501` on a held posting, explain that a moderator must review it.
* Same UI rule as H1: an explicit "still available" confirmation each time.

## H2. Coordinates are server-authoritative — never re-round

* `list_marketplace_jobs` / `get_marketplace_job` return `origin_lat` / `origin_lng` already on the public 0.10° grid (V2-DEC-01), or `null` when the landing has no public point. Map them straight to `origin.approximatePoint = { lat, lng }` (or `null`).
* **Do not round, snap, jitter or re-derive them in the browser or the adapter.** The server rounds half *away from zero* (47.65 → 47.7, −117.45 → −117.5, ±0.05 → ±0.1); JavaScript `Math.round(x * 10) / 10` gives 47.6 and −117.4 for the same inputs, so any client rounding silently moves pins.
* Any test that asserts a grid must use the server's values. (`mapping.test.ts` asserts a 0.02° grid for the *pilot* adapter; the V2 adapter must not reuse it.)
* Distances (`distance_miles`) are computed by the server from the grid point; display them as given.

## H3. A `replied` response always carries a message

`respondToInterest(viewer, input)` → `respond_to_interest`:

| Input | RPC argument |
|---|---|
| `interestId` | `p_interest_id` |
| `decision` (`viewed` \| `replied` \| `declined`) | `p_status` |
| `replyId` (client-generated uuid, stable across retries) | `p_reply_id` |
| `body` | `p_body` |
| share private access details (landing chooses) | `p_share_private_details` |

* `replied` without a non-blank `body` → `23514` ("A reply needs a message"). `respondToInterestInputSchema` already enforces this client-side; keep the two in step.
* Re-sending the same `replyId` is a no-op (exactly one message), so the adapter may retry a `replied` call after a timeout with the same id.

## F4 / H4. Drafts (optional server-side drafts)

If drafts should survive across devices, add `saveDraft(viewer, partialDraft): Promise<{ draftId }>` → `save_job_posting_draft`. Drafts may now omit truck demand, pay and equipment (F4); the database no longer invents a truck count. The *draft* schema should therefore make `trucksRequested` optional, while the *publish* schema keeps it required. Publishing a saved draft passes `p_draft_job_id`.

## Not for the adapter

* Billing webhooks go to `apply_billing_provider_event` from the **server-side webhook handler** with the service key — see `PHASE3_REVIEW.md` §R4 for the handler contract. No browser or user-token path calls it.
* Admin RPCs (`admin_moderate_job_posting`, `admin_release_job_moderation_hold`, `admin_list_billing_provider_events`, legacy import) are for the admin console only.
