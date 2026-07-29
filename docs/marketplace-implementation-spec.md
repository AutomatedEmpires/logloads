# LogLoads — marketplace realignment: implementation spec

> **Legacy percentage model.** This document preserves the implementation and
> audit contract for assignments committed under `legacy_percentage`. It is not
> the commercial model for new activity after the founder's 2026-07-28
> subscription-v1 decision. Do not delete it or use it to enroll a new
> organization. See `docs/SUBSCRIPTION_BILLING_V1.md`.

Generated 2026-07-24 by a 9-agent pass: four architecture sections designed in parallel, each attacked by an independent adversarial reviewer, then assembled.

Designed against the locked decisions: timber-specific; load value = flat host-stated driver pay; flat 5% platform fee billed to the host on top of driver pay on completed loads only, plus a monthly minimum; strictly non-custodial; no free host tier; no brokerage.

> The final assembly agent exceeded its output limit and returned only its tail. The per-section designs and adversarial reviews below are complete and are the authoritative artifact; the partial assembly is included last for its scheduling detail.

---

## Contents

1. LogLoads — Permissions & Canonical Vocabulary Specification
2. LogLoads Marketplace — State Machines & Billing Edge Cases
3. Scheduling Integrity — Implementation Spec
4. LogLoads Marketplace — Data Model Specification
5. Adversarial Review — Scheduling Integrity Spec
6. Adversarial review — Permissions & Vocabulary spec
7. Adversarial review — LogLoads Marketplace Data Model Specification
8. Adversarial review — LogLoads Marketplace state machines & billing
9. 3.9 Cancel-then-take

---

# 1. LogLoads — Permissions & Canonical Vocabulary Specification

# LogLoads — Permissions & Canonical Vocabulary Specification
**Scope:** load series + slots, non-custodial payment record (Phase 0), platform fee ledger. Timber vocabulary preserved throughout.

---

## 1. Permission model — extension of the existing 9-role matrix

### 1.1 New organization actions

Add to `ORGANIZATION_ACTIONS` in `/home/jackson/automatedempires/ventures/logloads/packages/contracts/src/permissions.ts`. Six new actions; **no existing action is renamed or removed.**

| New action | Meaning |
|---|---|
| `manage_load_slots` | Add, edit, or cancel individual slots on an already-published load series |
| `record_payment_sent` | Mark that the host has sent driver pay for a completed haul |
| `confirm_payment_received` | Mark that the payee actually received the money (necessary, never sufficient — see §1.4) |
| `raise_payment_dispute` | Open or respond to a **payment dispute** on a haul payment record |
| `view_fee_ledger` | Read platform fee lines, invoices, credits, and the monthly minimum |
| `adjust_fee_ledger` | Issue a credit or adjustment against a LogLoads invoice (platform organizations only) |

**Deliberately NOT new actions — reuse:**
- Post a load series → `publish_load` (a series *is* a load posting; `seriesSize > 1`).
- Request a slot → `request_assignment`.
- Accept/decline a slot request → `assign_capacity`.
- Cancel a slot as host → `assign_capacity`; cancel own assignment as driver → `request_assignment`.
- Read driver pay on a listing → no action; driver pay is part of the public listing body.

### 1.2 Role → action grants

Append to `ORGANIZATION_ROLE_ACTIONS` in `permissions.ts`. `owner` receives all actions via the existing `ORGANIZATION_ACTIONS` spread.

| Role | `manage_load_slots` | `record_payment_sent` | `confirm_payment_received` | `raise_payment_dispute` | `view_fee_ledger` | `adjust_fee_ledger` |
|---|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅¹ | ✅ | ✅ | ✅² |
| admin | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| dispatcher | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| driver | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| fleet_manager | ❌ | ❌ | ✅¹ | ✅ | ❌ | ❌ |
| landing_manager | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| destination_manager | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| billing | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| viewer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ Holding the action is **necessary and not sufficient.** `confirm_payment_received` additionally requires the payee-binding assertion in §1.4. A host owner holds the action and always fails the binding — that is the design, not a leak.
² `adjust_fee_ledger` additionally requires `organization.type === "platform"`. No customer organization has a platform-type org, so no customer owner can ever hold it in practice.

**Rationale, consistent with the existing dispatcher comment in `permissions.ts`:** dispatchers run the work, not the money. `manage_load_slots` is operating work, so dispatchers get it. Everything touching cents stays with `owner`, `admin`, `billing`. `destination_manager` receives nothing new — mills receive timber, they do not pay drivers or shape series.

**`viewer` maps to no cockpit.** It gains no new action. Beyond the action check, add an explicit refusal (§2, refusal R-VIEWER) so that a `viewer` calling any new API route gets a 403 even if a future action grant is fat-fingered.

### 1.3 Invitable roles

`INVITABLE_ROLES_BY_ORGANIZATION_TYPE` in `permissions.ts` is unchanged. `billing` remains host-side only, which is why `record_payment_sent` on the hauling side resolves to `owner`/`admin` only.

### 1.4 The payee-binding assertion (the load-bearing guard)

Founder decision 4 says only the driver may mark "received". Real fleets pay employee drivers through the carrier, so the rule is expressed as **payee binding**, not role alone:

```
assertPayeeMayConfirm(state, actor, haulPayment):
  preference = driverPayoutPreferences[haulPayment.driverProfileId]
  if preference.payeeType === "driver":
      require actor.userId === driverProfile.userId          // the driver personally, nobody else
  if preference.payeeType === "organization":
      require actor.organizationId === preference.payeeOrganizationId
      require organizationRoleCan(actor.role, "confirm_payment_received")   // owner | fleet_manager | driver
  always: require actor.organizationId !== haulPayment.hostOrganizationId
  always: require actor.organization.type !== "platform"
```

The last two lines are unconditional and must each have a test that fails if the line is deleted. They are the entire mechanical content of "the host cannot mark its own payment received" and "LogLoads staff cannot settle a payment record."

### 1.5 Guard conventions

Every new service follows the established pattern from `packages/services/src/operating-network.ts:290-317`:

```ts
const context = getActiveOrganizationContext(state, actorUserId, organizationId)
assertOrganizationAction(context, "record_payment_sent")   // role gate
assertCondition(<ownership/state/identity predicate>, "<refusal message>")
```

New service modules:
- `packages/services/src/load-series.ts` — series publish, slot edit, slot cancel
- `packages/services/src/haul-payment.ts` — payout preference, mark sent, confirm received, payment dispute
- `packages/services/src/platform-fees.ts` — fee line minting, invoices, adjustments/credits

New snapshot collections (each needs `??= []` in `upgradeStateSnapshot` **and** a key in `seedDatabaseState`, since `REQUIRED_TABLES = Object.keys(seedDatabaseState)` — one atomic change): `loadSlots`, `driverPayoutPreferences`, `haulPayments`, `haulPaymentEvents`, `platformFeeLines`, `platformInvoices`, `platformInvoiceAdjustments`.

---

## 2. Capability table

For each capability: required role, service-level guard, and what the **service** must refuse even when the UI hides it. Every refusal below is an `assertCondition` in a service — API routes bypass the UI, so no gate may live in a component or a server action.

Refusal codes reused across rows:
- **R-VIEWER** — actor's role is `viewer`: refuse every write, and refuse every read in §2.7/§2.8.
- **R-CROSSORG** — the target record's organization is not the actor's organization: refuse as *not found*, never as *forbidden* (matches the existing convention at `operating-network.ts:1326`).
- **R-DEMO** — demo personas may not mutate money records (`apps/web/lib/demo-mode.ts`).

### 2.1 Post a load series
- **Role:** `publish_load` → owner, admin, dispatcher, landing_manager
- **Service:** `load-series.ts › publishLoadSeries(state, input)`; extends the existing publish path in `packages/services/src/loads.ts` / `loads-publish.ts`
- **Server-side refusals:**
  - `seriesSize` outside 1..60 → refuse.
  - `slotsPerDay` outside 1..12, or `slotsPerDay × dayCount !== seriesSize` → refuse. A series whose arithmetic does not close cannot be published.
  - `driverPayCents` missing, ≤ 0, or > 2,000,000 ($20,000) → refuse. **A series with no stated driver pay is unpublishable** — there is no "TBD", no "negotiated", no inherited rate-card fallback.
  - Slot windows that fall outside the landing's `slotWindowMinutes` operating window → refuse. This is the first read of `landing.slotWindowMinutes`, which is currently stored and read by nothing; `loads.ts`'s hard-coded 13:00–21:00Z window is deleted in the same PR.
  - Two slots on the same series whose windows overlap for the same landing → refuse.
  - Publishing against a landing or destination the actor's organization does not own → R-CROSSORG.
  - R-VIEWER, R-DEMO.

### 2.2 Edit a slot
- **Role:** `manage_load_slots` → owner, admin, dispatcher, landing_manager
- **Service:** `load-series.ts › updateLoadSlot(state, input)`
- **Server-side refusals:**
  - Slot has an accepted assignment whose trip has advanced past `checked_in` → refuse. Times and pay stop being editable once a driver is physically on the landing.
  - Any change to `driverPayCents` on a slot with an accepted assignment → **always refuse**, at any trip status. Pay is what the driver accepted; changing it is a new slot, not an edit.
  - Slot has reached billable completion → refuse all edits.
  - Editing a slot into an overlap with a sibling slot on the same series → refuse.
  - Editing a slot belonging to another organization's series → R-CROSSORG.
  - Editing the parent series' `driverPayCents` never cascades to slots with accepted assignments; the service must write pay onto the slot at acceptance time so the driver's number is immutable.
  - R-VIEWER, R-DEMO.

### 2.3 Request a slot (driver side)
- **Role:** `request_assignment` → owner, admin, dispatcher, driver, fleet_manager
- **Service:** the existing request path in `packages/services/src/operating-network.ts` / `assignments.ts`, re-scoped to slots
- **Server-side refusals:**
  - **The one-assignment-per-driver rule at `operating-network.ts:748-753` must be re-scoped from per-posting to per-slot.** Today it refuses a second request on the same `loadPostingId`; that would make a series bookable exactly once. New predicate: refuse when an active assignment exists for the same `(loadSlotId, driverProfileId)`. Requesting three different slots on one series is legal and is the point of the feature.
  - Refuse when the driver already has an accepted assignment on a **different** slot whose window overlaps this slot's window. The conflict check that exists only inside `claimDirectOffer` (`operating-network.ts:~2889-2907`, currently untested) is extracted into a shared `assertNoScheduleConflict(state, driverProfileId, window)` and called from **every** booking path: request, approve, direct offer claim, and cockpit accept. `matching.ts:101-123` presently *claims* an overlap it never computes — it is rewired to call the same function or the claim is deleted.
  - Refuse when `futureOpenSlots` is empty for the requested slot — and the caller must name a `loadSlotId`. Every surface currently books `futureOpenSlots[0]`; a series with a slot picker cannot keep an implicit first-slot default. `apps/web/lib/cockpit-actions.ts:110-117`, which auto-mints a covering availability window, is deleted: the service must refuse a request the driver has no availability for rather than inventing availability.
  - Refuse when the slot is cancelled, expired, or already filled.
  - R-VIEWER, R-DEMO.

### 2.4 Accept a slot request (host side)
- **Role:** `assign_capacity` → owner, admin, dispatcher, fleet_manager, landing_manager
- **Service:** the existing approve path, plus `load-series.ts › fillLoadSlot`
- **Server-side refusals:**
  - **At-most-one accepted assignment per slot**, asserted against a deterministic id `assignment:${loadSlotId}` before insert. This is the entire defence against double-booking a slot — the snapshot has no unique index. It needs a test that fails if the assertion is removed.
  - Refuse acceptance that would create a driver schedule conflict (same shared function as §2.3) — the driver's own request does not waive the check, because the host's other slots may have filled in between.
  - Refuse acceptance of a request against a slot on a series owned by another organization → R-CROSSORG.
  - At acceptance, the service **copies** `driverPayCents` from the slot onto the assignment. Downstream money reads the assignment copy, never the live series.
  - R-VIEWER, R-DEMO.

### 2.5 Mark payment sent
- **Role:** `record_payment_sent` → owner, admin, billing
- **Service:** `haul-payment.ts › markHaulPaymentSent(state, input)`
- **Server-side refusals:**
  - Refuse unless `trip.completionStatus === "confirmed"` (delivery accepted, per `haul-completion.ts:191-216`). You cannot pay for a haul you have not accepted.
  - Refuse unless the actor's organization is the **host** organization on the assignment. A carrier marking its own pay sent is nonsense → R-CROSSORG.
  - Refuse when the payment record is already `sent`, `received_confirmed`, or `disputed`. Deterministic id `haulPayment:${assignmentId}` + at-most-one assertion; re-posting is idempotent, not additive.
  - Refuse when `amountSentCents` differs from the assignment's `driverPayCents` **without** a non-empty `varianceReason` (min 10 chars, max 500). Silent short-pay is not recordable.
  - Refuse `dispatcher` explicitly even if the role matrix is later loosened — assert on the action, and add a test asserting `organizationRoleCan("dispatcher", "record_payment_sent") === false`.
  - Refuse any attempt to set `receivedConfirmedAt` in the same call. Marking sent may never write the received fields.
  - R-VIEWER, R-DEMO.

### 2.6 Confirm payment received
- **Role:** `confirm_payment_received` → owner, driver, fleet_manager — **plus** the payee-binding assertion of §1.4
- **Service:** `haul-payment.ts › confirmHaulPaymentReceived(state, input)`
- **Server-side refusals:**
  - Refuse when the actor is a member of the host organization, at any role including `owner`. Unconditional.
  - Refuse when the actor's organization type is `platform`. LogLoads staff can never settle a payment record — support tooling gets a read view and nothing else.
  - Refuse when the actor is not the bound payee (§1.4), even inside the correct carrier organization. An `admin` of the carrier is not the payee.
  - Refuse unless the payment status is `sent` or `disputed`. A driver cannot confirm money the host never claims to have sent.
  - `amountReceivedCents` is required and must be > 0. If it differs from `amountSentCents`, the record stores both and sets `divergence: true` — this is the detectable posted-vs-confirmed divergence required by founder decision 9. Never overwrite the posted figure.
  - Refuse any `actorUserId` override supplied in the request body — the actor comes from the session via `apps/web/lib/api-actor.ts › requireApiActor()`, never from the payload.
  - R-VIEWER, R-DEMO.

### 2.7 Dispute
Two distinct disputes; they never share a service, a status field, or a word (§3.4).

**(a) Delivery dispute** — host contests the driver's delivered figures.
- **Role:** `assign_capacity` (the accepting side)
- **Service:** existing `packages/services/src/haul-completion.ts › applyHaulCompletionDispute` (line 230)
- **Refusals:** unchanged — only a `submitted` completion may be disputed; reason 1..500 chars.

**(b) Payment dispute** — either side contests whether or how much money arrived.
- **Role:** `raise_payment_dispute` → owner, admin, billing (host side); owner, driver, fleet_manager (payee side)
- **Service:** `haul-payment.ts › raiseHaulPaymentDispute(state, input)`
- **Server-side refusals:**
  - Refuse unless the actor's organization is either the host organization or the payee organization on that payment. Third parties cannot dispute → R-CROSSORG.
  - Refuse a payment dispute before the payment record exists (`status === "pending"` with nothing marked sent). Nothing to dispute yet; the driver's remedy at that point is the unpaid-haul view, not a dispute.
  - Refuse an empty reason; 10..1000 chars.
  - A payment dispute **does not** reverse a fee line already invoiced, and **does not** roll back delivery acceptance. It sets `haulPayment.status = "disputed"` and appends a `haulPaymentEvent`. Any credit is a separate `adjust_fee_ledger` act (§2.9).
  - Refuse dispute after `received_confirmed` **unless** the actor is the payee (a driver who confirmed and then had the ACH reversed must be able to reopen; a host cannot un-owe money the driver said arrived).
  - R-VIEWER, R-DEMO.

### 2.8 Cancel with reason
- **Role:** host-side `assign_capacity`; driver-side `request_assignment` and only for the actor's own assignment
- **Service:** extends `operating-network.ts › cancelAssignmentWithPolicy` (line 1200), plus `load-series.ts › cancelLoadSlot`
- **Server-side refusals:**
  - `reason` required, 10..500 chars, from a closed `cancellationReason` enum plus free text. An empty or one-word reason is refused server-side — the UI's required field is not the gate.
  - Refuse cancellation after billable completion (§3.3). A completed, fee-generating haul cannot be cancelled away; the correction path is a credit (§2.9).
  - Refuse a host cancellation once the trip is past `loaded` — at that point the timber is on the truck and the outcome is a delivery exception, not a cancellation.
  - Cancelling one slot **never** cascades to sibling slots. Cancelling a parent series cancels only slots with no accepted assignment; slots with drivers must be cancelled individually, each with its own reason, each notifying its own driver.
  - Driver cancelling another driver's assignment → R-CROSSORG.
  - R-VIEWER, R-DEMO.

### 2.9 View fees/invoices, and adjust an invoice

**View** — `view_fee_ledger` → owner, admin, billing.
- **Service:** `platform-fees.ts › listFeeLines / getInvoice`
- **Refusals:**
  - Refuse for `dispatcher`, `driver`, `fleet_manager`, `landing_manager`, `destination_manager`, `viewer` (R-VIEWER).
  - **The driver-facing serializer must never include `platformFeeCents`, `invoiceId`, or any fee field.** Enforce with a serializer that whitelists fields, plus a test asserting the driver payload of a completed haul contains no key matching `/fee|invoice|platform_?fee/i`. A driver who can see the host's fee will read it as a deduction from their pay, and the entire founder promise (decision 3) is "never deducted from driver pay".
  - Refuse reading another organization's invoice → R-CROSSORG.

**Adjust** — `adjust_fee_ledger` → owner of a `platform`-type organization only.
- **Service:** `platform-fees.ts › issueInvoiceAdjustment`
- **Refusals:**
  - Refuse unless `organization.type === "platform"`. Assert the org type, not just the role.
  - Refuse editing or deleting an existing fee line. Adjustments are append-only rows; the original line is immutable.
  - Refuse an adjustment that would drive the invoice total below zero.
  - Refuse any adjustment whose target is a driver payment record. **LogLoads can credit its own fee; it can never adjust what a host owes a driver.** This is the non-custodial line drawn in code.
  - Require `reason` 10..500 chars and a `linkedDisputeId` when the adjustment answers a payment dispute.
  - Deterministic id `adjustment:${invoiceId}:${reasonKey}:${feeLineId}` with an at-most-one assertion, so a retried support click cannot double-credit. Test must fail if the assertion is removed.

---

## 3. Canonical vocabulary

One term per concept. Everything in the "Never" column is a lint failure — add a banned-vocabulary check to `tools/check-guardrails.mjs` scanning `apps/web/**/*.tsx`, `apps/web/lib/**/*.ts`, and `packages/ui/**`.

### 3.1 The work objects

| Concept | Code identifier | User-visible term | Definition shown to users | Never say |
|---|---|---|---|---|
| Load series | `loadSeries` (a `loadPosting` with `seriesSize > 1`) | **load series** | "Six loads on the same route, posted together." | batch, bundle, multi-load, recurring load, campaign |
| Slot | `loadSlot` | **slot** | "One load on the series, with its own day and time window." | seat, spot, opening, shift, booking, job |
| Carrier capacity (existing `truckSlots`) | `truckSlots` (code unchanged) | **capacity block** | "A window when this truck is available." | slot — reserved for load series |
| Assignment | `assignment` | **assignment** | "A driver accepted onto one slot." | booking, reservation, order, gig |
| Trip | `tripsV2` | **trip** | "The haul itself, from assigned through completed." | run, job, delivery (as a record noun) |
| Haul | — | **haul** | Allowed in prose and marketing only ("your hauls this week"). Never a record label, column header, or status. | — |

`slot` is the founder's word (decision 7) and belongs to the load side. The existing carrier-side `truckSlots` keeps its code identifier but every user-visible string becomes **capacity block** in the same PR — two things called "slot" on one screen is the fastest way to a mis-booking.

### 3.2 Money

| Concept | Code identifier | User-visible term | Sentence definition | Never say |
|---|---|---|---|---|
| Driver pay | `driverPayCents` | **driver pay** | "The flat amount the host pays the driver for this load." | rate, load rate, price, offer, earnings, compensation, payout amount, per-ton, per-mile |
| Rate card | existing `rates` / `rateType` / `fuelSurchargeCents` | **rate card** | "Your company's standing price list. It is not what a driver is paid for a load." | driver pay, load pay, driver rate |
| Platform fee | `platformFeeCents` | **platform fee** | "LogLoads' 5% service fee, charged to the host on top of driver pay." | commission, take rate, cut, margin, **brokerage fee**, broker fee, load fee |
| Monthly minimum | `monthlyMinimumCents` | **monthly minimum** | "The least you pay LogLoads in a month, whatever your load count." | base fee, subscription (reserved for the existing Stripe subscription) |
| Invoice | `platformInvoice` | **invoice** | "What LogLoads charges you this month: platform fees plus any minimum." | bill, statement, settlement |
| Credit | `platformInvoiceAdjustment` (negative) | **credit** | "A reduction of a LogLoads fee already invoiced to you." | refund, reversal, rebate, chargeback |
| Payout details | `driverPayoutPreference` | **payout details** | "How the driver wants to be paid, and by whom." | wallet, account balance, payment method on file |

**Banned outright, product-wide:** wallet, balance, escrow, funds held, payout balance, we pay you, we release payment, settle your funds. Each implies custody. Add every one of these to the guardrail lint. `brokerage fee` and `broker fee` are banned for a second reason — founder decision 5 and the published Terms disclaim brokering (`apps/web/lib/v3-shared.ts:351`), and one fee label undoes both.

### 3.3 Billable completion

**Code identifier:** `billableCompletedAt`, `billableReason`, `feeBaseCents`.
**User-visible term:** **billable completion**. Host-facing definition, shown on the invoice and in the fee explainer:

> "A load becomes billable when the host has accepted delivery **and** the driver has confirmed the payment they received — or, if the driver never confirms and never disputes, 30 days after delivery was accepted."

Two reasons, both recorded:
- `payment_confirmed` — `trip.status === "completed"` ∧ `trip.completionStatus === "confirmed"` ∧ `haulPayment.status === "received_confirmed"`. `feeBaseCents = min(driverPayCents, amountReceivedCents)`; a lower confirmed amount records `divergence: true`.
- `confirmation_lapsed` — delivery accepted, 30 days elapsed, payment neither confirmed nor disputed. `feeBaseCents = driverPayCents`. This closes the fee-avoidance hole where a host asks a driver to stay quiet.

Requested, accepted, in-progress, cancelled, and disputed hauls generate **no fee line** (decision 8). A payment dispute freezes fee minting for that haul until it resolves. Never use the bare word "completed" in billing copy — `trip.status === "completed"` is a physical fact and is not billable on its own (see the existing warning at `packages/contracts/src/production-network.ts:354`).

### 3.4 Delivery accepted vs payment confirmed — the lexical firewall

These are two different events, days apart, decided by opposite parties. They must not share a verb, a noun, or a badge colour.

| | Delivery accepted | Payment confirmed |
|---|---|---|
| What it means | The host accepts the driver's account of what was delivered | The payee states the money actually arrived |
| Who does it | Host (`assign_capacity`) | Payee only (§1.4) |
| Field | `trip.completionStatus === "confirmed"` | `haulPayment.status === "received_confirmed"` |
| Verb in UI | **accept** / **accepted** | **confirm** / **confirmed** |
| Badge | "Delivery accepted" | "Payment confirmed" |
| Negative form | "Delivery disputed" | "Payment disputed" |

**Required rename before any payment UI ships:** `apps/web/components/v3/DriverPages.tsx:351` currently maps `confirmed: "Confirmed by the host"` and `apps/web/components/v3/DriverActions.tsx:909` renders "Delivery confirmed by the host." Both become **"Delivery accepted by the host"** / **"{n} {unit} accepted by the host."** in the same PR that introduces `haulPayment`. The lint rule: the string `confirmed by the host` may not exist anywhere in the tree, and `payment` may never appear within 40 characters of `accepted`.

### 3.5 Exceptions, incidents, disputes

| Concept | Code | User-visible term | Definition | Never say |
|---|---|---|---|---|
| Delivery exception | `HaulException` (`rejected_at_scale`, `access_blocked`, `equipment_failure`, `weather_hold`) | **delivery exception** | "Something stopped this haul from delivering normally." | incident, problem, issue, failure |
| Incident | new `tripIncidents` | **incident** | "A safety or equipment event on a trip: injury, rollover, road closure, DVIR defect." | exception, dispute |
| Delivery dispute | `trip.completionDisputeReason` | **delivery dispute** | "The host contests what the driver recorded as delivered." | dispute (bare), rejection, denial |
| Payment dispute | `haulPayment.disputeReason` | **payment dispute** | "One side says the money did not arrive, or the amount was wrong." | dispute (bare), claim, chargeback |

The bare word **dispute** is banned in user-visible copy — it must always carry `delivery` or `payment`. Also still banned repo-wide per existing doctrine: **audit trail** (use "record" or "activity"); note the stale comment at `packages/services/src/haul-completion.test.ts:965`.

---

## 4. The six mandatory payment disclosures

Ship as a single module, `packages/contracts/src/payment-disclosures.ts`, exporting one pure function per disclosure that takes a typed context and returns a string. Copy lives in contracts, never inline in a component — an honesty rule expressed as a private helper gets quietly reverted, and a test suite that only checks inputs will not notice.

Placeholders: `{pay}` driver pay formatted, `{fee}` 5% of driver pay, `{host}` host organization name, `{terms}` the host's stated payment window, `{method}` the payout method label, `{payee}` payee name.

Each disclosure is rendered at the moment named, not buried in a help page.

### D1 — How much
- **Driver** (slot detail, before requesting): "This load pays {pay}. That is the full amount — LogLoads takes nothing out of it."
- **Host** (publish form, live as the field changes): "Driver pay is {pay}. Our platform fee is 5% — {fee} — charged to you on top. It is never taken out of driver pay."

### D2 — Who pays
- **Driver:** "{host} pays you directly. LogLoads is not a party to this payment and never handles the money."
- **Host:** "You pay the driver directly. LogLoads does not collect, hold, or forward driver pay."

### D3 — When
- **Driver:** "{host} states payment {terms} after they accept delivery. That term is theirs, not a LogLoads guarantee."
- **Host:** "You told drivers you pay {terms} after accepting delivery. This term appears on every slot in this series."

### D4 — How
- **Driver:** "{host} will pay you by {method}, using the payout details on your profile. Keep them current — LogLoads cannot route a payment for you."
- **Host:** "Pay by {method} to the payout details {payee} provided, from your own account. LogLoads has no payment rails in this."

### D5 — Initiated / confirmed
- **Driver:** "{host} marks the payment sent. Only you can mark it received — nobody at {host}, and nobody at LogLoads, can mark it for you."
- **Host:** "You mark the payment sent. Only {payee} can mark it received; marking sent does not close the record, and LogLoads will not confirm it for you."

### D6 — Disputed
- **Driver:** "If the money never arrives, or the amount is wrong, open a payment dispute. LogLoads records both accounts and can produce the record — LogLoads cannot recover the money for you."
- **Host:** "If {payee} opens a payment dispute, both accounts go on the record and the load stops generating a platform fee until it resolves. LogLoads records the disagreement; it does not decide it."

### The non-custodial disclaimer

One string, `PAYMENT_CUSTODY_DISCLAIMER`, rendered verbatim on: the driver payout-details screen, the host payment screen, the payment-record view for both sides, and the Terms section in `apps/web/lib/v3-shared.ts`.

> "LogLoads never holds, moves, or has access to driver pay. Hosts pay drivers directly, by whatever method the two of them agree on. What you see here is a record both sides keep — it is not a payment, a guarantee of payment, or an account holding funds. LogLoads charges hosts a platform fee for completed loads; that is the only money LogLoads collects, and it is collected from hosts, never from drivers."

Second disclaimer, kept where it already lives and kept true (founder decision 5): the Terms section at `apps/web/lib/v3-shared.ts:351` and both footers must continue to state that LogLoads is not a party to the haul and does not broker freight. Nothing in the payment record, the fee ledger, or the invoice may describe LogLoads as arranging, procuring, or guaranteeing transportation.

---

## 5. What must ship in the same PR

Per founder decisions 6 and the doctrine that no UI may claim a capability with no code path:

1. `apps/web/lib/plans.ts:43` `priceLine: "Free launch pilot"` is replaced by the real host price in the **same** PR as the first host charge. Not before, not after.
2. The `confirmed by the host` → `accepted by the host` rename (`DriverPages.tsx:351`, `DriverActions.tsx:909`) ships with the first `haulPayment` write.
3. `POST /api/truck-slots` (`apps/web/app/api/truck-slots/route.ts:18-27`) is fixed in the slot PR: it currently takes `payload.organizationId` from the body with no permission check, no ownership check, and no capacity update. Add `assertOrganizationAction(context, "assign_capacity")` inside `createTruckSlot`, not in the route — routes are bypassable.
4. `landing.slotWindowMinutes` starts being read, and the hard-coded 13:00–21:00Z window in `packages/services/src/loads.ts` is deleted.
5. `cockpit-actions.ts:110-117` auto-minting an availability window is deleted.
6. Guardrail lint additions in `tools/check-guardrails.mjs`: banned custody words, banned fee synonyms, bare "dispute", `confirmed by the host`, and `fee|invoice` keys in any driver-facing serializer.

Each at-most-one assertion (`assignment:${loadSlotId}`, `haulPayment:${assignmentId}`, fee line per trip, `adjustment:*`) gets a test that **fails when the assertion is deleted** — the snapshot has no CHECK, no FK, and no unique index, so these assertions plus their tests are the whole double-billing defence.

---

# 2. LogLoads Marketplace — State Machines & Billing Edge Cases

# LogLoads Marketplace — State Machines & Billing Edge Cases

**Spec status:** implementable. Every state, guard, and mutation below names the file it extends. Nothing here re-litigates the nine locked decisions; it implements them.

---

## 0. Model additions

### 0.1 New snapshot collections

Added to `LogLoadsDatabaseState` in `/home/jackson/automatedempires/ventures/logloads/packages/db/src/types.ts`, seeded as `[]` in `packages/db/src/seed-data.ts` (which is what makes them appear in `REQUIRED_TABLES`), and backfilled with `??= []` in `upgradeStateSnapshot` in `packages/db/src/snapshot.ts` — **one atomic change across all three**, or old snapshots fail `REQUIRED_TABLES` validation on the next read.

| Collection | Grain | Purpose |
|---|---|---|
| `feeEvents` | one per fee/reversal/credit/true-up | the only money ledger. Append-only. |
| `haulPayments` | one per **assignment** that incurred a pay obligation | Phase 0 record-only host→driver payment. |
| `payAdjustments` | one per proposed change to a frozen pay figure | driver must accept; unaccepted = no effect. |
| `driverPayoutPreferences` | one per driver profile | how the driver wants to be paid. Text only. No rails. |
| `billingPeriods` | one per (host org, month) | close/lock boundary; carries the minimum true-up. |
| `billingDisclosures` | one per (subject, clock, recipient) | proof a countdown was disclosed **before** it fired. |

### 0.2 New fields on existing entities

- `loadPosting.driverPayCents: number|null` — the host-stated flat driver pay (locked #2). Replaces `compensation`/`rates` **as the figure the driver reads**; `rates`/`compensationTerms` in `packages/contracts/src/operating-network.ts` stay as the company price-card and must no longer be rendered to drivers as pay.
- `loadPosting.seriesMode: "single" | "slotted"` — `slotted` is the load-series parent (locked #7).
- `truckSlot.driverPayCents: number|null` (per-slot override), `truckSlot.billingStatus`, `truckSlot.billableAt`, `truckSlot.notBillableReason` — added to `truckSlotSchema` in `packages/contracts/src/schemas.ts:259`.
- `truckSlot.capacity` **must be 1** when the parent posting is `slotted`. Assert it in `createTruckSlot` (`packages/services/src/truck-slots.ts:20`). One slot = one truckload = one driver = one billable load. This is what makes "one assignment per slot" and "one fee per load" trivially expressible; `reservedCount` becomes 0|1.
- `assignment.frozenDriverPayCents` + `assignment.payFrozenAt` — snapshotted at acceptance onto `assignmentSchema` (`packages/contracts/src/schemas.ts:302`). A later edit to the posting or slot **never** moves an accepted driver's pay.
- `assignment.cancellationCategory: "host_cancelled" | "driver_cancelled_early" | "driver_cancelled_late" | "replaced" | "no_show" | "load_cancelled"` — cheaper and more legible than new `AssignmentStatus` members.
- `trip.completionCounterQuantity` + `trip.completionDisputeDisclosedAt` — see (c).

### 0.3 Constants (`packages/contracts/src/billing-policy.ts`, new)

```
PLATFORM_FEE_BASIS_POINTS        = 500      // flat 5%, never tiered (locked #3)
MONTHLY_MINIMUM_CENTS            = 4900
DELIVERY_AUTO_CONFIRM_HOURS      = 72
DISPUTE_AUTO_RESOLVE_HOURS       = 336      // 14 days
PAYMENT_RECEIPT_AUTO_CONFIRM_HRS = 168      // 7 days after host marks sent
DEFAULT_PAYMENT_TERMS_DAYS       = 15
LATE_CANCELLATION_HOURS          = 72
FEE_RATE_CHANGE_NOTICE_DAYS      = 60
```

`feeCents = Math.round(finalDriverPayCents * PLATFORM_FEE_BASIS_POINTS / 10_000)`, charged **to the host, on top** — it is never subtracted from `finalDriverPayCents` anywhere in the codebase. A test must assert that the driver-facing pay figure and the fee figure are read from different fields and that no code path returns `pay - fee`.

### 0.4 No cron exists in this repo

`apps/web` has no `vercel.json` and no cron routes. Therefore **every timer in this spec is lazily derived, not swept.** The pattern already exists: `effectiveDirectOfferStatus(offer, at)` in `packages/services/src/operating-network.ts:351`. Implement:

```ts
effectiveCompletionStatus(state, trip, at)   // pending|submitted|confirmed|disputed
effectiveHaulPaymentStatus(state, payment, at)
effectiveSlotBillingStatus(state, slot, at)
```

Readers use the effective function. **Materialization** (writing the auto-confirmed status and the fee event) happens in an idempotent `materializeDueBillingTransitions(state, at)` invoked (a) at the top of every host/driver billing read path, and (b) from `POST /api/billing/materialize` guarded by a service token. Because materialization is derived from timestamps already in state, running it twice must produce byte-identical state — that is the whole idempotency contract.

---

## 1. Slot lifecycle (`truckSlot.status`)

Extends `truckSlotTransitions` in `packages/contracts/src/state-machines.ts:17`. Two new members added to `truckSlotStatusSchema` (`packages/contracts/src/enums.ts:40`): `delivered`, `expired`. The `Record<TruckSlotStatus, TruckSlotStatus[]>` map is exhaustive, so adding the members is compiler-forced — but note the known hole: the compiler flags `Record<>` maps and **not** `===`/`!==` comparisons. Grep every `slot.status ===` site by hand.

| From | To | Guard |
|---|---|---|
| `open` | `requested` | an assignment reached `requested` for this slot; `reservedCount < capacity`; `slot.endAt > now` (already at `operating-network.ts:770`) |
| `open` | `cancelled` | host cancels the slot; no active assignment exists |
| `open` | `expired` | `slot.endAt <= now` and `reservedCount === 0`. **Derived, materialized.** Idempotent. |
| `requested` | `reserved` | host approves (`approveCapacityRequest`, `operating-network.ts:829`) |
| `requested` | `open` | request declined/cancelled; `reservedCount` decremented to 0 |
| `requested` | `cancelled` | host cancels the slot; every pending request is declined first |
| `reserved` | `filled` | the accepted assignment's trip is created |
| `reserved` | `open` | assignment cancelled before the haul (**both** host and driver paths) |
| `reserved` | `cancelled` | host cancels the load/slot |
| `filled` | `delivered` | the trip reached `completed` (`progressTripStatus`, `operating-network.ts:1839`) — physical delivery only |
| `filled` | `open` | assignment cancelled pre-haul → **replacement path**, see (f) |
| `filled` | `cancelled` | forbidden after the driver submits a completion record — see (d3) |
| `delivered` | `completed` | `effectiveCompletionStatus === "confirmed"` **and** slot billing resolved to `billable` or `not_billable` |
| `delivered` | `open` | **forbidden.** A delivered slot is never re-listed. |
| `completed`, `cancelled`, `expired` | — | terminal |

`open → requested → reserved` still routes through `reserveTruckSlot`/`confirmTruckSlot`/`releaseTruckSlotReservation` in `packages/services/src/truck-slots.ts`. **Prerequisite bug:** `POST /api/truck-slots` has no org check, no permission check, and no capacity update. Slots now carry `driverPayCents`; an unauthenticated writer would be minting pay obligations and fee bases. That route must gate on `assertOrganizationAction(context, "publish_load")` and on `load.companyId === context.organizationId` in the **service**, not the route.

**Re-scoping the duplicate guard.** `operating-network.ts:748-753` currently refuses a second active assignment per (load, driver). Under load series that is wrong — one driver legitimately takes 3 slots on the same posting. Change the predicate to `assignment.truckSlotId === parsed.truckSlotId && activeAssignmentStatuses.has(...)`, and add a second, stronger invariant: **at most one non-terminal assignment per slot, ever.** Both need tests that fail if the guard is deleted.

---

## 2. Assignment lifecycle (`assignment.status`)

Members unchanged (`packages/contracts/src/enums.ts:47`). Two maps disagree today — `assignmentTransitions` in `packages/contracts/src/state-machines.ts:26` and `assignmentV2Transitions` in `packages/contracts/src/production-network.ts` (v2 allows `accepted → loading` and `requested → accepted`, v1 does not). **Delete `assignmentTransitions` and route `packages/services/src/assignments.ts` through the v2 map.** Two live state machines for one entity is how a guard gets bypassed.

| From | To | Guard | Money effect |
|---|---|---|---|
| — | `requested` | slot open, capacity remains, window not passed, equipment eligible, visibility, no other active assignment on the slot | none |
| `requested` | `offered`/`accepted` | host holds `assign_capacity` | **freeze `frozenDriverPayCents`** from `slot.driverPayCents ?? load.driverPayCents`; refuse if null. This is the fee base. |
| `requested`/`offered` | `declined` | host decision; releases the reservation | none |
| `accepted` | `checked_in` | trip progressed; pre-trip inspection passed (`operating-network.ts:1888`) | none |
| `checked_in` → `loading` → `hauled` | | mirrors trip status via `assignmentStatusByTripStatus` | none |
| `hauled` | `completed` | trip reached `completed`: completion record exists and required evidence attached (`operating-network.ts:1902-1918`) | creates the `haulPayment` obligation |
| any active | `cancelled` | `assertCancellationAuthority` (`operating-network.ts:1173`) **plus** the new pre-submission guard in (d3) | see (d)/(e) |
| `completed`, `cancelled`, `declined` | — | terminal |

`frozenDriverPayCents` is immutable after acceptance. The only legal mutation is an accepted `payAdjustment` (§7).

---

## 3. Payment status (`haulPayment.status`) — Phase 0, record-only

Non-custodial (locked #4): no balances, no transfers, no `application_fee_amount` anywhere in Phase 0 because there is no charge object.

Created exactly once, when `assignment.status → completed`, with deterministic id `feeId("payment", assignmentId)`.

| From | To | Who | Guard |
|---|---|---|---|
| — | `pending` | system | assignment reached `completed`; `frozenDriverPayCents > 0`; `dueAt = completedAt + DEFAULT_PAYMENT_TERMS_DAYS` |
| — | `not_required` | system | `finalDriverPayCents === 0` (failed delivery with no discretionary pay) — terminal, never billable |
| `pending` | `sent` | **host only** | host asserts it paid; records method + reference text. No rails, no verification. Sets `receiptAutoConfirmAt = sentAt + 168h` **only if** the driver disclosure was written. |
| `pending` | `overdue` | derived | `now > dueAt`. **Materialized, idempotent.** `overdue` is billable — non-payment must not suppress the fee. |
| `sent` | `received` | **driver only** | `assertCondition(actor is the assigned driver's user)`. Records `confirmedReceivedCents`. Never the host, never platform staff. |
| `sent` | `received` | system | auto-confirm at `receiptAutoConfirmAt`, **only if** `billingDisclosures` holds a delivered notice for this clock. Idempotent. |
| `sent`/`pending`/`overdue` | `disputed` | driver | reason required (≤500 chars); records `claimedReceivedCents` (may be 0) |
| `disputed` | `resolved` | host+driver agreement, or platform admin | sets `finalDriverPayCents`; carries `resolutionBasis` |
| `received`/`resolved` | — | terminal |
| `pending` | `voided` | system | the underlying assignment was cancelled pre-haul and no pay is owed |

**Vocabulary lock.** "Confirmed by the host" already means *delivery accepted* (`applyHaulCompletionConfirmation`, `packages/services/src/haul-completion.ts`). Payment fields are therefore named `paymentReceiptConfirmedAt`, `paymentReceiptConfirmedByUserId`, and the UI string is **"Driver confirmed receipt"** — never "confirmed", never "settled", never "paid out". `haulPayment` must never contain a field called `confirmedAt`.

**Divergence detection (locked #9).** `postedDriverPayCents` (host-authored), `finalDriverPayCents` (after any accepted adjustment), `confirmedReceivedCents` (driver-authored) are three separate stored columns. `finalDriverPayCents !== confirmedReceivedCents` sets `payment.divergent = true` and surfaces on the host and admin views. The fee base is `finalDriverPayCents` — the agreed obligation, not the driver's receipt claim — otherwise a driver could shrink the platform's fee by under-reporting, and a host could shrink it by paying short.

---

## 4. Fee / billing status (`truckSlot.billingStatus`)

One slot = one load = **at most one** `platform_fee` event, ever.

| From | To | Trigger / guard |
|---|---|---|
| `not_started` | `pending_agreement` | slot → `delivered` |
| `pending_agreement` | `billable` | **the billable predicate below** — this transition is the mutation that writes the fee |
| `pending_agreement` | `on_hold` | `haulPayment.status === "disputed"` OR `trip.completionStatus === "disputed"` |
| `pending_agreement` | `not_billable` | failed delivery (§ g), or slot cancelled before delivery |
| `on_hold` | `pending_agreement` | dispute resolved or auto-resolved |
| `billable` | `invoiced` | the containing `billingPeriod` closed |
| `invoiced` | `paid` | Stripe invoice webhook (`apps/web/app/api/billing/webhook/route.ts`, extending `applyBillingUpdate` in `packages/services/src/billing.ts`) |
| `billable`/`invoiced`/`paid` | `reversed` | admin reversal or completion reopen (§ h). Writes a `fee_reversal`; **never mutates the original event.** |
| `not_billable`, `reversed` | — | terminal |

---

## (a) When a load becomes BILLABLE — exact state, exact mutation

**Predicate** (`isBillableCompletion(state, slot, at)`, pure, in `packages/contracts/src/billing-policy.ts` so it is a contract and not a private helper — an honesty rule kept as a private helper gets silently reverted):

```
deliveryAgreed  = effectiveCompletionStatus(trip, at) === "confirmed"
                  && trip.status === "completed"
payFinalized    = payment.status ∈ { received, resolved, overdue }
billable        = deliveryAgreed && payFinalized && finalDriverPayCents > 0
```

`overdue` is deliberately included: locked #9 makes driver confirmation part of billable completion, but if a host could avoid the fee by simply never marking the payment sent, the fee would be optional by construction. Non-payment escalates the obligation; it does not extinguish it.

**Exact state:** `truckSlot.billingStatus` transitions `pending_agreement → billable`.

**Exact mutation** — a single function, the only writer of `platform_fee` events:

```ts
// packages/services/src/platform-fees.ts
export function accruePlatformFee(state, slot, at): FeeEvent | null {
  if (slot.billingStatus !== "pending_agreement") return null
  if (!isBillableCompletion(state, slot, at)) return null

  const id = feeId("platform_fee", slot.id)          // deterministic, v5-style
  const existing = state.feeEvents.find(e => e.id === id)
  if (existing) return existing                       // idempotent re-entry

  assertCondition(
    !state.feeEvents.some(e =>
      e.truckSlotId === slot.id && e.kind === "platform_fee" && !e.reversedAt),
    "A platform fee already exists for this load"     // at-most-one, id-independent
  )

  const base = payment.finalDriverPayCents
  const event = feeEventSchema.parse({
    id, kind: "platform_fee", truckSlotId: slot.id, assignmentId: payment.assignmentId,
    hostOrganizationId: load.companyId,
    basisPoints: PLATFORM_FEE_BASIS_POINTS,
    baseCents: base,
    amountCents: Math.round(base * PLATFORM_FEE_BASIS_POINTS / 10_000),
    billingPeriodKey: periodKeyFor(load.companyId, at),  // the OPEN period at accrual time
    accruedAt: at, reversedAt: null
  })
  state.feeEvents.push(event)
  slot.billingStatus = "billable"
  slot.billableAt = at
  insertAuditEvent(state, null, "truck_slot", slot.id, "platform_fee_accrued", { feeEventId: id })
  return event
}
```

The money in this snapshot has **no database backstop** — no CHECK, no FK, no unique index. The deterministic id plus the `at-most-one` assertion are the entire double-billing defence, and **each needs its own test that fails when that specific guard is deleted.** Two tests, not one: the id check alone would let a reversal-then-reaccrual double-bill, and the assertion alone would let a concurrent retry through.

`accruePlatformFee` is called from exactly three places, all of which are re-entrant: `settleHaulCompletion` (confirm branch), the payment status writers, and `materializeDueBillingTransitions`.

---

## (b) Completion confirmation, the auto-confirm window, and why it is a billing lever

**Two confirmations, in order.**

1. **Delivery.** The driver submits (`submitHaulCompletion`, `operating-network.ts:2008`) → `completionStatus: "submitted"`. The host confirms or disputes (`settleHaulCompletion`, `operating-network.ts:2127`). Separation of duties is already enforced person-to-person, not org-to-org (`context.actorUserId !== trip.completionSubmittedByUserId`) — keep it.
2. **Payment receipt.** Only the driver may mark received (§3).

**Auto-confirm.** `deliveryAutoConfirmAt = billingDisclosures[delivery_auto_confirm].deliveredAt + 72h`.

The clock **starts at disclosure, not at submission**. If no disclosure record exists, `deliveryAutoConfirmAt` is `null` and auto-confirm never fires — the record sits `submitted` indefinitely and the fee never accrues. This is not a fallback; it is the rule. A countdown the host was never shown cannot be the thing that bills them.

The disclosure notification must state, in the host's own notification and on the host workspace card, all four facts:
- what the driver recorded (quantity/exception),
- the exact instant silence becomes confirmation,
- **the exact fee that will accrue** (`$X.XX, 5% of the $Y driver pay you posted`),
- the two ways to stop it: confirm, or dispute with a counter-figure.

**Why the window is a billing lever.** Auto-confirm converts host *silence* into a `confirmed` delivery, and `confirmed` is one of the two facts that mints a platform fee. That makes a passive non-action into a charge. Charging on silence is defensible **only** if the silence was informed, so the disclosure is a precondition of the transition, enforced in the service, not the UI. Concretely: `applyHaulCompletionConfirmation` gains a `source: "host" | "auto"` argument, and the `auto` branch asserts the disclosure row exists and `disclosedAt + 72h <= at`. A test must assert that deleting the disclosure row prevents auto-confirmation and prevents the fee.

**Auto-confirm is a distinct code path from `settleHaulCompletion`.** That function asserts `assertOrganizationAction(context, "assign_capacity")` and a non-null actor; auto-confirm has no actor. It calls `applyHaulCompletionConfirmation` directly with `actorUserId: null`, writes `completionConfirmedByUserId: null`, and writes an audit action of `haul_completion_auto_confirmed` — never `haul_completion_confirmed`. A record that reads as if a person confirmed it, when nobody did, is exactly the class of lie this codebase refuses.

---

## (c) Disputed completion

`applyHaulCompletionDispute` (`packages/services/src/haul-completion.ts`) today requires only a reason. **Extend it: the host must state a counter-figure** — `counterDeliveredQuantity`, or the explicit flag `counterAssertsNoDelivery: true`. A dispute with no counter-figure is a free, permanent fee-avoidance lever: the record cannot reach `confirmed`, so no fee ever accrues, and the driver's history never settles. Requiring a counter-figure makes the dispute a claim that can itself be adjudicated and timed out.

Dispute machine (on `trip.completionStatus`, unchanged members: `pending|submitted|confirmed|disputed`):

| From | To | Who | Guard |
|---|---|---|---|
| `submitted` | `disputed` | host | reason 1..500 chars **and** a counter-figure. Slot billing → `on_hold`. |
| `disputed` | `submitted` | driver | resubmission with changed content (existing unchanged-content short-circuit at `haul-completion.ts` stays; it is what makes device retries safe) |
| `disputed` | `confirmed` | **forbidden directly** — the existing assertion "Only a submitted haul can be confirmed" is correct and stays |
| `disputed` | `submitted` @ host counter-figure | system | **auto-resolve at `disputeDisclosedAt + 336h`** if the driver never answers: the host's counter-figure is written as the record, `completionResolution: "driver_did_not_answer"`, then confirmed by the same auto path as (b). Requires its own disclosure to the **driver**, same four facts, before it can fire. |

**Delivery disputes do not move the fee base.** Delivered quantity and driver pay are different facts: pay is the flat figure frozen at acceptance (locked #2). A host who believes the load was short cannot reduce pay by disputing quantity — they must propose a `payAdjustment` the driver accepts. This keeps the fee base stable through the entire dispute and removes the incentive to dispute for fee reduction.

If the host's counter asserts **no delivery occurred** and that resolves in the host's favour, the slot goes `not_billable` and the payment goes `not_required` — see (g).

---

## (d) Host cancels

**(d1) Before acceptance** (`assignment.status ∈ {requested, offered}`, or no assignment at all).
Slot → `cancelled` or back to `open`; every pending request is `declined` with `cancellationCategory: "load_cancelled"`. No payment record. No fee. `billingStatus` never leaves `not_started`. Idempotent: cancelling an already-cancelled slot returns the existing record unchanged.

**(d2) After acceptance, before the haul** (`accepted`..`loading`, `trip.completionStatus === "pending"`).
Permitted. `assignment.cancellationCategory = "host_cancelled"`, slot `filled → open` (re-listable) or `→ cancelled`. **No fee** — locked #8, no billable completion. **No automatic money to the driver**: LogLoads is not a contracting party (locked #5) and cannot create an obligation between two other parties. The host *may* voluntarily record a discretionary `haulPayment` (`kind: "discretionary"`, e.g. dead-head or show-up pay). A discretionary payment is **never fee-bearing** — it is not a completed load. A test must assert `accruePlatformFee` returns `null` for a slot whose only payment is discretionary. A host cancellation inside `LATE_CANCELLATION_HOURS` of `slot.startAt` writes a reliability mark on the host org, visible on the public host profile. Reliability marks, not money, are the enforcement mechanism at MVP.

**(d3) After the haul, before confirmation.** **Forbidden.**
`cancelAssignmentWithPolicy` (`operating-network.ts:1225-1231`) currently refuses only when `completionStatus === "confirmed"`, which leaves `submitted` and `disputed` cancellable — a host could erase a delivered haul and its fee after the driver had already recorded it. Tighten the guard to:

```ts
assertCondition(
  settledTrip === undefined || settledTrip.completionStatus === "pending",
  "The driver has recorded this delivery. Confirm it or dispute it — it cannot be cancelled."
)
```

Additionally refuse cancellation once `trip.status ∈ {at_destination, unloading, completed}` even while `completionStatus === "pending"`: the truck is at the mill. The host's paths from there are confirm, dispute, or (for a genuine no-delivery) let the driver record the exception. Both assertions need tests that fail on removal.

---

## (e) Driver cancels — inside and outside 72h

Same authority path (`assertCancellationAuthority` returns `side: "hauler"`), same terminal effects: slot returns to `open`, reservation released, capacity restored (`applyAssignmentCancellationEffects`).

| Timing | Category | Money | Consequence |
|---|---|---|---|
| `slot.startAt - now > 72h` | `driver_cancelled_early` | none | plain cancellation, host notified, slot re-listed |
| `slot.startAt - now <= 72h` | `driver_cancelled_late` | none | reliability mark on the driver profile and the hauling org; host notified with a **replace driver** action; the load is surfaced to the host's private network first |
| after `checked_in` with no delivery | `no_show` | none | as above, plus the slot's `notBillableReason` is recorded if it never gets re-filled |

**No money moves in any driver-cancellation case.** A late-cancellation penalty would require debiting a driver, which requires holding driver funds — categorically excluded by locked #4. The 72h line is a reliability threshold, not a fee threshold, and the product copy must say exactly that. `LATE_CANCELLATION_HOURS` is computed against `slot.startAt`, not against the haul window hardcoded at 13:00–21:00Z in `packages/services/src/loads.ts` — that hardcode, and the unread `landing.slotWindowMinutes`, are prerequisites for this to mean anything.

---

## (f) Replacement driver completes the load

**One slot, two assignments, one fee, one paid driver.** This is the reason the fee lives on the slot and the payment lives on the assignment.

1. Assignment A `cancelled` with category `driver_cancelled_late` / `replaced` / `host_cancelled`. Slot `filled → open`, `reservedCount → 0`, `billingStatus` stays `not_started`.
2. Assignment B is created against the **same slot id** (the re-scoped per-slot uniqueness guard permits it precisely because A is terminal).
3. B's `frozenDriverPayCents` is frozen **at B's acceptance**, from the slot/posting value current at that moment. If the host raised the pay to attract a replacement, B is paid the raised figure and the fee base is the raised figure. A's frozen figure is history and is never the base.
4. B delivers → `haulPayment` for **B only**.
5. `accruePlatformFee(slot)` runs once. `feeId("platform_fee", slot.id)` is keyed on the **slot**, so a second accrual attempt from A's lineage returns the existing event. **This is the single most important idempotency guarantee in the design** — keying the fee on the assignment would double-bill every replaced load.

**Who is billable:** the host, once, 5% of B's final pay.
**Who is paid:** B, in full, at B's frozen figure. A is paid nothing unless the host records a discretionary payment, which carries no fee.
If a discretionary payment to A exists *and* B completes, the slot still yields exactly one `platform_fee`, based on B. A test must assert `feeEvents.filter(e => e.truckSlotId === slot.id && e.kind === "platform_fee").length === 1` across the full replace-and-complete sequence.

---

## (g) Partial or failed delivery

Driven by `haulException.type` (`packages/contracts/src/production-network.ts`) and `deliveredQuantity.value`:

| Case | Delivery | Slot billing | Payment | Fee |
|---|---|---|---|---|
| `short_load`, qty > 0 | real delivery; evidence still required (`EXCEPTIONS_WITHOUT_EVIDENCE` in `haul-completion.ts` correctly excludes it) | `billable` | full frozen pay unless the driver accepts a `payAdjustment` | 5% of final pay |
| `wait_time` / `other`, qty > 0 | as above | `billable` | full | 5% of final |
| `rejected_at_scale`, qty 0 | no delivery | `not_billable`, reason `rejected_at_scale` | `not_required`, or discretionary | **none** |
| `access_blocked`, qty 0 | no delivery; host-side fault | `not_billable` | discretionary encouraged; host reliability mark | **none** |
| `equipment_failure`, qty 0 | no delivery; hauler-side fault | `not_billable` | none; driver reliability mark | **none** |
| `weather_hold`, qty 0 | no delivery; nobody's fault | `not_billable` | none | **none** |

A zero-quantity delivery already requires an exception (`applyHaulCompletionSubmission`: *"A zero delivery needs an exception explaining it"*) — that assertion is what makes this table enforceable, and it must keep its test.

`not_billable` is **terminal**. A slot that failed delivery is not re-listed as the same slot; the host publishes a new slot. Otherwise the same physical work could accrue a fee twice under two different completion records.

---

## (h) Credits and invoice corrections

**Rule: a closed invoice is never edited.** Corrections are new ledger entries in the currently open period. This is the same principle as the locked never-retroactive rate policy (#3).

`billingPeriod` machine:

| From | To | Guard |
|---|---|---|
| `open` | `closing` | period end reached; no `on_hold` slot remains whose `billableAt` would fall inside the period |
| `closing` | `closed` | `minimum_true_up` written: `max(0, MONTHLY_MINIMUM_CENTS - sum(platform_fee in period))`; Stripe invoice created |
| `closed` | — | terminal and immutable |

Correction kinds, all as new `feeEvent` rows:

- **`fee_reversal`** — the fee should never have accrued: auto-confirm fired without a disclosure row, a duplicate slipped a guard, a platform error. Sets `reversedAt` on the original **without altering `amountCents`**, and slot → `reversed`.
- **`manual_credit`** — goodwill or negotiated correction. Requires a platform-admin actor and a reason string; renders as a named line on the next invoice.
- **`minimum_true_up`** — written only at period close.

**Reversal inside a closed period** (the case that breaks naive implementations): the credit lands in the **current open** period, and its amount is

```
creditableCents = max(0, min(feeCents, closedPeriodFeeSubtotalCents - MONTHLY_MINIMUM_CENTS))
```

If the closed period billed the $49 floor rather than the fee sum, reversing a fee inside it yields **zero** credit — the host paid the floor, not that fee. Refunding it would hand back money never charged. Never recompute the closed period's true-up; that is the graduated-tier failure mode the flat-fee decision exists to avoid.

**Reopening a confirmed completion.** `applyHaulCompletionSubmission` currently tells the driver *"This haul is confirmed; ask the host to reopen it before changing the record"* — **a UI/message promising a capability with no code path, which the repo doctrine bans.** Either build it or change the string. Build it:

```
reopenHaulCompletion(state, { tripId, actorUserId, reason })
```
- allowed to the host within 24h of `completionConfirmedAt` **and** while `slot.billingStatus ∈ {pending_agreement, billable}` (i.e. before the period closes), or to a platform admin at any time;
- sets `completionStatus → "submitted"`, clears `completionConfirmedAt`/`ByUserId`;
- if a fee had accrued, writes the `fee_reversal` in the same mutation and moves the slot to `pending_agreement`;
- **forbidden** once `billingStatus === "invoiced"` — after invoicing, the only correction is `manual_credit`.

---

## 5. Transitions that MUST be idempotent

| # | Transition | Retry source | Why it must be idempotent |
|---|---|---|---|
| 1 | `pending_agreement → billable` (`accruePlatformFee`) | lazy materializer runs on every billing read; concurrent host + driver requests | double fee. No DB unique index exists — deterministic id + at-most-one assertion are the only defence. |
| 2 | auto-confirm delivery | materializer, multiple readers, CAS retry replay | double audit events, double notification, and it re-enters #1 |
| 3 | auto-confirm payment receipt | same | same |
| 4 | dispute auto-resolve | same | would overwrite a driver resubmission that landed in the same tick |
| 5 | `slot.status → expired` | materializer on every discovery read | flips a slot that got booked between read and write; the guard `reservedCount === 0` must be re-evaluated inside the CAS body, not before it |
| 6 | host marks payment `sent` | field device retry, double-tap | duplicate notification to the driver; second call must return the existing record unchanged (mirror the unchanged-content short-circuit already in `applyHaulCompletionSubmission`) |
| 7 | driver marks `received` | field device on bad signal — the primary Phase 0 field action | duplicate receipt confirmations; also re-enters #1 |
| 8 | `progressTripStatus → completed` | already guarded (`operating-network.ts:1864`) — **keep it**, it now guards a fee too | double `updateOpportunityCapacityAfterCompletion` and a duplicate `haulPayment` |
| 9 | `haulPayment` creation at `assignment → completed` | reachable from both `progressTripStatus` and the materializer | two obligations for one haul; use `feeId("payment", assignmentId)` and a find-first |
| 10 | Stripe invoice webhook → `invoiced`/`paid` | Stripe retries by design | `applyBillingUpdate` (`packages/services/src/billing.ts`) already dedupes on `metadata.eventId` — extend the same pattern to invoice events; the `eventId` check must run **before** any mutation, as it does today |
| 11 | period close / `minimum_true_up` | double-close from concurrent readers | a second $49 true-up. Deterministic id `feeId("minimum_true_up", periodKey)` + assert period is `closing`. |
| 12 | `fee_reversal` | admin double-click | double credit; deterministic id keyed on the reversed event id |
| 13 | slot `filled → open` on cancellation (`releaseTruckSlotReservation`, `truck-slots.ts:71`) | already `Math.max(0, ...)` — but a second call on a re-booked slot would release *someone else's* reservation | scope the release to the cancelling assignment id, not to the slot alone |

All thirteen run inside the CAS-retried snapshot mutation (`packages/db/src/snapshot.ts:405`), so the callback **replays** on conflict. Any of these that is not idempotent is not merely a duplicate-request bug — it is a bug that fires under normal concurrency.

---

## 6. Copy sweep that must ship in the same PR as the first host charge

Locked #6: `apps/web/lib/plans.ts` still advertises a Host "Free launch pilot". The fee-accrual PR is the PR that makes that false, so it is the PR that removes it. Same PR: the published Terms and both footers must keep the no-brokering disclaimer true (locked #5), and the fee disclosure ("5% of driver pay, charged to the host, never deducted from the driver") must appear on the load-publish form next to the `driverPayCents` input — where the host states the number the fee is computed from.

---

## 7. `payAdjustment` (referenced above, specified here)

| From | To | Who | Guard |
|---|---|---|---|
| — | `proposed` | host | assignment is accepted or later; states `proposedPayCents` and a reason |
| `proposed` | `accepted` | **driver only** | writes `assignment.frozenDriverPayCents = proposedPayCents`, `payment.finalDriverPayCents` follows |
| `proposed` | `rejected` | driver | original figure stands, unchanged |
| `proposed` | `withdrawn` | host | before driver response |
| `proposed` | `expired` | derived | 72h with no driver response → **the original figure stands**. Silence never reduces driver pay. |

Adjustments are **refused once `billingStatus ∈ {billable, invoiced, paid}`** — the fee base is locked at accrual. A post-accrual correction is a reversal plus a re-accrual, both explicit, both audited, never an in-place edit of `feeEvent.baseCents`.

---

# 3. Scheduling Integrity — Implementation Spec

# Scheduling Integrity — Implementation Spec

## 0. Where this lives

| Module | Purity | Contents |
|---|---|---|
| `packages/contracts/src/geo.ts` | pure | `haversineMiles(a,b)` — **moved out of** `apps/web/lib/economics.ts:35` (which becomes a re-export; one implementation only) |
| `packages/contracts/src/time-zones.ts` | pure | `zonedCivilToUtc`, `civilDateKey`, `formatSiteLocal` |
| `packages/contracts/src/scheduling.ts` | pure | occupancy interval, separation, conflict test, buffer policy, enforcement ladder |
| `packages/contracts/src/cancellation.ts` | pure | reason-code taxonomy + classification table |
| `packages/services/src/scheduling-integrity.ts` | reads snapshot | `buildOccupancy`, `checkCandidate`, `detectCancelThenTake`, `sweepSchedulingDeadlines`, `schedulingReliability` |

Doctrine hook: the honesty rules (excused/counted, enforcement thresholds) live in `contracts` as exported data, never as private helpers inside a service — the E&E lesson that an adversarial pass restored a bug while all tests passed applies directly here.

---

## 1. Snapshot shape changes (one atomic change)

New collection `schedulingIncidents`. Because `REQUIRED_TABLES = Object.keys(seedDatabaseState)` and `upgradeStateSnapshot` **casts rather than parses**, all three of these land in the same commit:

1. `packages/db/src/seed-data.ts` — `schedulingIncidents: []` in `seedDatabaseState`.
2. `upgradeStateSnapshot` — `snapshot.schedulingIncidents ??= []`.
3. Backfill in the same migrator:
   - every site (`landingSchema` / `millSchema`, both extend `siteBaseSchema` at `packages/contracts/src/schemas.ts:172-192`) gains `ianaTimeZone` (default `"America/Los_Angeles"`) and `operatingHoursLocal: { start: "06:00", end: "18:00" }`;
   - every `assignment` gains `cancellationReasonCode: string | null` (existing cancelled rows → `"legacy_unclassified"`, **never inferred from the free-text `cancellationReason`**) and `confirmationState: "unconfirmed" | "confirmed" | "not_required"`.

Money-side discipline carries over: there is no DB backstop, so **deterministic incident ids plus an at-most-one assertion are the entire defence against double-counting**, and each needs a test that fails if the guard is removed (§10).

---

## 2. Time model

**Storage is unchanged**: every instant is ISO-8601 UTC (`timestampSchema`). What is missing is the *civil* frame.

- `truckSlot.slotDate` (`z.string().date()`) is a **civil date in the pickup landing's zone**. `packages/services/src/truck-slots.ts:13` currently does `toDateKey(slot.startAt)`, which slices UTC and is wrong at the day boundary — replace with `civilDateKey(slot.startAt, landing.ianaTimeZone)`.
- `packages/services/src/loads.ts:33-37` hardcodes `13:00Z–21:00Z`. Replace: the loading window for a civil date is the landing's `operatingHoursLocal` resolved in `landing.ianaTimeZone` via `zonedCivilToUtc`.
- `zonedCivilToUtc` uses `Intl.DateTimeFormat` with `timeZone` + `formatToParts` to resolve the offset. **No new dependency, no hand-rolled offset arithmetic.**
- **DST rules (stated, not discovered):** a civil time that does not exist (spring forward) resolves *forward* to the next valid instant; a civil time that occurs twice (fall back) resolves to the **first** occurrence.
- **All conflict arithmetic is on UTC instants.** `slotDate` is never compared, sorted, or differenced in the algorithm.
- **Display**: `formatSiteLocal(instant, zone)` renders with an explicit abbreviation (`07:00 PDT`). Driver-facing pickup times render in the *landing's* zone, delivery times in the *mill's* zone, each labelled — never the browser's zone. A driver's phone can be two zones away from the block; a time shown in device-local is a missed load.

---

## 3. Occupancy interval

`slotWindowMinutes` (`packages/contracts/src/schemas.ts:182`, stored but read by nothing, seeded 30/20/15 at `packages/db/src/seed-data.ts:546,569,595`) is hereby **defined as the per-truck service duration at that site**. Those seed values are already consistent with a turn time; this gives the field its job.

```ts
interface Occupancy {
  assignmentId: string | null
  driverProfileId: string
  truckProfileId: string
  trailerProfileId: string | null
  startAt: string      // UTC instant
  endAt: string        // UTC instant
  originCoordinates: Coordinates      // pickup landing
  terminusCoordinates: Coordinates    // dropoff mill
}
```

For a candidate or existing assignment on slot `S`, load `L`, route `R` (`haulRouteSchema`, `packages/contracts/src/schemas.ts:199-213`):

```
loadedRunMinutes   = ceil(R.estimatedRunTimeMinutes * runTimeSafetyFactor)

occupancyStart = S.startAt - preTripMinutes
occupancyEnd   = S.endAt                       // NOT startAt — see below
               + landingServiceMinutes
               + loadedRunMinutes
               + millServiceMinutes
```

**Why `S.endAt` and not `S.startAt`:** the host may call the truck in at any point inside the slot window. A driver who books a 13:00–21:00 window has sold that whole window. Measuring from `startAt` would declare back-to-back bookings feasible that physically are not. This is deliberately pessimistic, and the lever is correct: **a host who wants tighter packing narrows the slot window.** Slot precision is the host's job, and `slotWindowMinutes` + `operatingHoursLocal` now let them do it.

`preTripMinutes` covers the DVIR walk-around, which already exists as `tripInspections` — the buffer and the inspection are the same real event.

---

## 4. Buffers — configurable, clamped

Resolution order: **platform default → company override → site override**, via a pure `resolveSchedulingBuffers(state, { companyId, landingId, millId })`.

| Key | Default | Clamp |
|---|---|---|
| `preTripMinutes` | 30 | 0–240 |
| `landingServiceMinutes` | `landing.slotWindowMinutes ?? 45` | 0–480 |
| `millServiceMinutes` | `mill.slotWindowMinutes ?? 30` | 0–480 |
| `interAssignmentBufferMinutes` | 30 | 0–240 |
| `deadheadAverageMph` | 45 | 10–70 |
| `roadCircuityFactor` | 1.30 | 1.0–2.0 |
| `deadheadMinimumMinutes` | 15 | 0–120 |
| `runTimeSafetyFactor` | 1.15 | 1.0–2.0 |

Clamps are enforced **in the zod schema**, because every one of these numbers is a way to defeat the conflict check by zeroing it. The overlap test itself (§6) is buffer-independent: with every buffer at 0, literal interval overlap still conflicts. That is negative control #6.

`runTimeSafetyFactor` is not padding-for-its-own-sake: a loaded log truck on a forest road runs behind the planned `estimatedRunTimeMinutes`, and a 1.0 factor makes every back-to-back booking look feasible.

---

## 5. Deadhead

Deadhead is **pairwise**, not baked into the interval — it depends on where the previous assignment ended and where the next one starts.

```
deadheadMinutes(prev, next) =
  max(deadheadMinimumMinutes,
      ceil(haversineMiles(prev.terminusCoordinates, next.originCoordinates)
           * roadCircuityFactor / deadheadAverageMph * 60))

separationMinutes(prev, next) = interAssignmentBufferMinutes + deadheadMinutes(prev, next)
```

`deadheadMinimumMinutes` applies even when mill and landing are the same point — fuel, scale, break. Straight-line haversine understates road miles badly in timber country, hence `roadCircuityFactor`.

**Explicit non-goal:** deadhead from/to the driver's home base is *not* part of the conflict check. The first and last legs of a driver's day are the driver's business. (`apps/web/lib/economics.ts:76` already uses home base for pay math; that stays separate.)

**Explicit non-goal:** hours-of-service. LogLoads is not an ELD. A rolling-24h occupancy total above 14h emits a **caution only**, never a block.

---

## 6. The overlap test

Order-free, and correct by construction — two bookings conflict exactly when **neither can follow the other**:

```ts
function feasibleInOrder(prev: Occupancy, next: Occupancy, b: Buffers): boolean {
  return minutesBetween(prev.endAt, next.startAt) >= separationMinutes(prev, next, b)
}

function conflicts(a: Occupancy, b: Occupancy, buf: Buffers): boolean {
  return !feasibleInOrder(a, b, buf) && !feasibleInOrder(b, a, buf)
}
```

Boundaries are half-open: a gap exactly equal to `separationMinutes` is feasible. Genuine interval overlap is subsumed (both orderings fail).

This replaces `packages/contracts/src/matching.ts:101-123` (`availabilityMatchesLoad`), which currently claims a schedule match it does not compute. That function takes a required `occupancy` argument, gains a `"conflict"` return member, and **may only return `"available"` when a window actually covers the computed interval**. Note the compiler-hole lesson from E&E: adding a union member flags `Record<>` maps but **not `!==` comparisons** — grep for `!== "available"` and `=== "available"` across `apps/web` by hand as part of this change.

---

## 7. Conflict dimensions

A booking claims a **resource set**: `{ driverProfileId, truckProfileId, trailerProfileId | null }`. The three dimensions are checked **independently**:

- **driver** — a driver with three trucks is still one human in one place. Swapping trucks does not launder a driver conflict.
- **truck** — a truck shared by two drivers is caught even though the driver ids differ.
- **trailer** — `null` claims nothing on this dimension; a load booked without a trailer produces no trailer conflict entry.

Multi-vehicle drivers and multi-driver trucks are therefore both handled by the same code with no special case — that independence *is* the feature, and #1/#2 in §10 are the controls.

**Availability is a fourth, asymmetric dimension:**

- An availability window with `status: "unavailable"` overlapping the occupancy interval → **hard conflict**, kind `declared_unavailable`. The driver said they were off.
- No window covering the interval → **caution, not a conflict.**
- **Never auto-create a window.** Delete the auto-mint at `apps/web/lib/cockpit-actions.ts:110-117` and the identical `upsertAvailabilityWindow` block inside `claimDirectOffer` (`packages/services/src/operating-network.ts` ~2870-2887). Silently minting a covering window is precisely the act that erases the signal the system exists to produce.

**Result shape** — structured, because the same value is thrown by the service and rendered by browse annotation:

```ts
type SchedulingConflict = {
  dimension: "driver" | "truck" | "trailer" | "availability"
  kind: "overlap" | "insufficient_transit" | "declared_unavailable"
  conflictingAssignmentId: string | null
  conflictingLabel: string          // see disclosure rule
  window: { startAt: string; endAt: string }
  requiredGapMinutes: number
  actualGapMinutes: number
}
type SchedulingCheck = { conflicts: SchedulingConflict[]; cautions: SchedulingCaution[] }
```

Blocking iff `conflicts.length > 0`. **Disclosure rule:** counterparty identity in `conflictingLabel` is only populated for actors who can already see that assignment. A host approving a driver from another org sees `"Committed elsewhere 06:30–15:10 PDT"` with times but no host, load title, or mill.

---

## 8. Where the check runs, and why it must be in the service

| Call site | File | Behaviour |
|---|---|---|
| Request | `requestCapacityWithPolicyInternal`, `packages/services/src/operating-network.ts:745-800` | **Enforce.** Runs *before* `updateOpportunityCapacityAfterRequest` — a conflict must consume no capacity and create no assignment. |
| Approve | `finalizeCapacityAssignment` | **Re-enforce.** State moved between request and approve; the driver may have been booked elsewhere meanwhile. On conflict, surface a decline-with-reason to the host. |
| Direct-offer claim | `claimDirectOffer`, `packages/services/src/operating-network.ts:2889-2907` | Delete the ad-hoc inline check; call the shared checker. The inline version has no tests today. |
| Slot creation | `packages/services/src/truck-slots.ts:20` + `apps/web/app/api/truck-slots/route.ts` | Add the missing org check, `manage_landing` permission check, and capacity update. The POST route currently passes raw `payload` into `createTruckSlot` with only `requireApiActor(payload.organizationId)`. |
| Browse annotation | `apps/web/lib/network.ts:740-760, 895-926`; `apps/web/lib/host-data.ts:142,335` | **Annotate only**, from the same pure function. Never a second implementation. |

**Why services, not UI:** `apps/web/app/api/assignments/request/route.ts`, `/api/direct-offers`, and `/api/truck-slots` accept JSON straight into the service layer. `cockpit-actions.ts` is *one* caller of several. A UI-side check is decoration.

**Concurrency:** the check must run **inside the same `mutateState` draft as the write**, not before it. State is one JSON snapshot row with CAS versioning; the CAS retry re-runs the whole mutator, so a check performed inside the mutator re-evaluates against the winning snapshot. A check performed before `mutateState` lets two concurrent requests both pass.

**Prerequisite — the slot picker.** Every surface currently books `futureOpenSlots[0]` (`apps/web/lib/network.ts:759,924`). Enforcing conflicts without a picker means "your one offered slot conflicts, tough." So `claimableSlotId` becomes:

```ts
claimableSlots: Array<{ id: string; startAt: string; endAt: string; check: SchedulingCheck }>
```

and the driver UI renders a picker with conflicting slots visible-but-disabled and the reason shown. **This ships in the same PR as enforcement.**

**Load series:** re-scope the one-assignment guard at `packages/services/src/operating-network.ts:748-753` from `loadPostingId` to `truckSlotId`. Same driver, two non-overlapping slots of the same series → allowed. Same driver, same slot twice → rejected even with capacity remaining.

---

## 9. Reliability layer

### 9.1 The 72-hour rule

`LOCK_IN_HOURS = 72`, measured from `now` to **`slot.startAt`** (the promise the driver made: be at the landing at X).

- A driver-initiated cancellation of an `accepted` / `checked_in` assignment inside 72h is a **late cancellation**. It is **never blocked** — blocking a cancel converts it into a no-show, which is strictly worse for the host. It is recorded.
- Every cancel path requires a `cancellationReasonCode`. Excused codes create an `excused_cancellation` incident instead of a `late_cancellation`.
- Symmetrically, host-initiated cancellation inside 72h creates `host_late_cancellation` against the organization.
- **Host material change**: altering route, driver pay, landing, or slot times inside 72h of `slot.startAt` creates a `host_material_change` incident and **auto-excuses any driver cancellation on that assignment for the following 24 hours (or until slot start)**, regardless of the code the driver picks.
- 72h also drives the confirmation ladder (§9.5).

### 9.2 Cancellation reason taxonomy

`packages/contracts/src/enums.ts`:

```ts
export const cancellationReasonCodeSchema = z.enum([
  // driver-side, excused — legitimate exceptions are FIRST-CLASS outcomes
  "equipment_breakdown", "accident", "driver_illness", "unsafe_conditions",
  // driver-side, counted
  "driver_schedule_conflict", "driver_took_other_work", "driver_no_reason_given",
  // host-side, excuses the driver
  "host_material_change", "host_cancelled_load", "host_landing_closed", "host_no_wood_ready",
  // neutral
  "mutual_reschedule", "duplicate_booking_cleanup", "platform_error",
  "expired_unconfirmed", "legacy_unclassified"
])
```

`packages/contracts/src/cancellation.ts` exports the classification table as data:

```ts
{ code, side: "driver"|"host"|"neutral", excused: boolean, requiresNote: boolean,
  countsToward: "driver_late"|"host_late"|null, releasesSlot: boolean, notifiesCounterparty: boolean }
```

`unsafe_conditions` is driver-side **and excused**: a driver refusing an icy grade is the behaviour the platform wants. `roadCondition` already exists on landings and routes — a landing whose `roadCondition` is `icy`/`snow`/`muddy` at cancel time is stamped into `incident.detail` as corroboration, never as a requirement.

Free-text `cancellationReason` (`schemas.ts:320`) is retained and still required for `requiresNote` codes. Evidence attachment reuses the existing Cloudinary trip-document path; `requiresEvidence` is `false` for every code at MVP but the field exists.

**Excused ≠ invisible.** An excused cancellation still increments `excusedCancellations`, so a driver with a breakdown every Friday is legible. A counter, not a penalty.

### 9.3 Cancel-then-take detection

Runs in the service, in both directions, on both events:

```ts
detectCancelThenTake(state, { driverProfileId, candidateOccupancy, at }): Signal | null
```

- **On a new booking** (request / claim): scan the driver's `cancelled` assignments with `cancelledAt` within `CANCEL_THEN_TAKE_LOOKBACK_HOURS = 168` whose reconstructed occupancy `conflicts()` with the candidate and whose reason code is **not excused** → incident `cancel_then_take`.
- **On a cancellation**: if the driver already holds an active assignment, booked *after* the one being cancelled, that conflicts with it → incident `take_then_cancel`.

Both directions are mandatory; implementing only one is the likely half-build (controls #28/#29). False positives are the risk that matters — cancelling for breakdown and taking unrelated work two days later must produce **nothing** (control #30).

Detection never blocks at MVP. It records.

### 9.4 Expiring offers

Today expiry is derived lazily at `packages/services/src/operating-network.ts:352` and never materialized: nothing notifies, nothing releases the slot hold.

- Add `sweepSchedulingDeadlines(state, at)` called at the **top of every `mutateState` mutator** in `apps/web/lib/services.ts`. No cron; deterministic; idempotent by status guard.
- The sweep sets `status: "expired"`, releases the reserved slot count exactly once (`releaseTruckSlotReservation`), notifies the host, emits `direct_offer_expired`.
- Creation guard is tightened: `operating-network.ts:2665` currently only requires `expiresAt > now`. It must also require `expiresAt < slot.startAt`.
- Default TTL by lead time, floored at `slot.startAt - 60min`:
  `>7d → 48h` · `72h–7d → 24h` · `<72h → 4h` · `<12h → 1h`.

### 9.5 Response and confirmation deadlines

- **Host response** to a driver request: `min(24h, 25% of lead time)`, floor 2h. On breach the sweep expires the request with `expired_unconfirmed`, restores capacity, notifies the driver, and records `host_slow_response`.
- **Driver confirmation** at T-72h and T-24h. Missing T-24h does **not** auto-cancel at MVP — a host with wood on the ground is worse off if the system destroys the booking. It sets `confirmationState: "unconfirmed"`, records `unconfirmed_at_deadline`, and surfaces on the host live board with a call affordance. Auto-cancel-on-unconfirmed is a ladder rung, off.

Vocabulary: **"Confirmed by the host" already means delivery accepted.** Scheduling confirmation uses `"Still good for this haul?"` / `"Haul confirmed for Tuesday"` — and payment confirmation (locked decision 4) uses neither.

### 9.6 Abuse-pattern counters

Append-only collection, never mutated:

```ts
schedulingIncidentSchema = z.object({
  id: z.string(),                    // deterministic, see below
  occurredAt: timestampSchema,
  subjectType: z.enum(["driver_profile", "organization"]),
  subjectId: uuidSchema,
  kind: schedulingIncidentKindSchema,
  assignmentId: uuidSchema,
  relatedAssignmentId: uuidSchema.nullable(),
  loadPostingId: uuidSchema, truckSlotId: uuidSchema,
  reasonCode: cancellationReasonCodeSchema.nullable(),
  leadTimeMinutes: z.number().int(),
  excused: z.boolean(),
  detail: z.record(z.unknown()).default({}),
  createdAt: timestampSchema
})

kind = "late_cancellation" | "excused_cancellation" | "cancel_then_take" | "take_then_cancel"
     | "no_show" | "unconfirmed_at_deadline" | "double_book_blocked"
     | "host_late_cancellation" | "host_material_change" | "host_slow_response"
```

**Deterministic id:** `incident:{kind}:{assignmentId}:{relatedAssignmentId ?? "none"}`, with an at-most-one assertion before insert. Same discipline the money path uses, for the same reason: no DB backstop, and these counts later gate access.

Counters are **derived, never stored**:

```ts
schedulingReliability(state, subjectId, { windowDays: 90, at }) → {
  acceptedInWindow, completedLoads, lateCancellations, excusedCancellations,
  cancelThenTakes, noShows, unconfirmedAtDeadline, lateCancellationRate: number | null
}
```

- Rate denominator = **accepted assignments whose slot start fell in the window** — not total assignments, or a driver who takes more work looks worse for taking more work.
- `lateCancellationRate` is `null` below 5 accepted assignments; counts only. This matches the existing reticence at `packages/contracts/src/recommendations.ts:72` (`ratedTrips < 2`).
- Surfaces on the existing `/host/reliability` and `/driver` reputation pages (`packages/contracts/src/reputation.ts`, `assistant.ts:107`).

### 9.7 Enforcement ladder — shipped OFF

```ts
export const DEFAULT_SCHEDULING_POLICY = {
  conflictCheck: "enforce",            // ON — this is prevention, not enforcement
  deadheadCheck: "enforce",            // ON
  cancellationTracking: "record",      // ON, record only
  enforcement: {
    warnDriverAtLateCancellations: null,
    restrictBookingAtLateCancellations: null,
    suspendAtNoShows: null,
    requireHostApprovalAtRate: null
  }
} as const
```

Every rung is implemented and unit-tested with **injected** thresholds. `evaluateEnforcement(counters, policy): EnforcementOutcome` is pure, and the only production caller passes `DEFAULT_SCHEDULING_POLICY`, in which every threshold is `null` = disabled.

Per the no-empty-promises contract, **no shipped UI string may threaten suspension or penalty while the ladder is off.** Driver copy is limited to: *"Hosts can see your on-time record."*

---

## 10. Negative-control tests

Each is written so that it **turns green if the guard it protects is deleted**.

**Conflict core** — `packages/contracts/src/scheduling.test.ts`
1. Same slot, same driver, **different trucks** → conflict on `driver`. (Green if the driver dimension is dropped.)
2. Same slot, **different drivers, same truck** → conflict on `truck`. Multi-vehicle drivers must not launder this.
3. Same slot, same driver+truck, one trailer `null` → driver+truck conflicts present, **no** `trailer` entry.
4. `next.start === prev.end + separation` exactly → **no** conflict (half-open boundary).
5. One minute earlier → `insufficient_transit`, with `actualGapMinutes === requiredGapMinutes - 1`.
6. **All buffers and deadhead set to 0** → literal interval overlap still conflicts. (The zero-the-config attack.)
7. Same-site pair still requires `deadheadMinimumMinutes`; a 120-mile pair's `requiredGapMinutes` reflects `roadCircuityFactor`.
8. `conflicts(a,b) === conflicts(b,a)` over a 200-pair generated table.
9. `cancelled` / `declined` / `completed` assignments contribute no conflict; `requested` and `offered` do. (Dropping `requested` from the active set lets a driver double-request.)
10. `status: "unavailable"` overlapping → `declared_unavailable`; missing window → caution only; and **`state.availabilityWindows.length` is unchanged** — the regression control for the deleted auto-mint.

**Service enforcement** — `packages/services/src/scheduling-integrity.test.ts`
11. `requestCapacityWithPolicy` called directly with a conflicting slot throws **and** leaves `remainingTruckloads` unchanged with no assignment row. (Half-write control.)
12. Request created while clear → second booking lands → **approve rejects.** (Request-time-only checking is the most likely regression.)
13. Deleting the inline block at `operating-network.ts:2889-2907` leaves the direct-offer test passing — proof the shared checker is actually wired.
14. Two **non-overlapping slots of the same load series**, same driver → both succeed. (Fails if the per-slot re-scope of `:748-753` is reverted to per-posting.)
15. Two assignments on the **same slot**, same driver → rejected even with capacity remaining.
16. `POST /api/truck-slots` from another org → 403; from a member lacking `manage_landing` → 403.
17. **Annotation ⟺ gate:** over 50 generated (driver, slot) pairs, `annotate()` reporting a conflict is true exactly when the service throws.

**Time zone**
18. Landing in `America/Los_Angeles`, slot at 23:30 local → `slotDate` is the **local** civil date. (Fails against `toDateKey(startAt)` at `truck-slots.ts:13`.)
19. Spring-forward 02:30 local resolves forward, does not throw, `startAt < endAt`.
20. Fall-back 01:30 local resolves to the **first** instant; two slots on that day do not collide.
21. Pickup and delivery in different zones render with their own abbreviations; a device on `America/New_York` still sees landing-local pickup times.

**72-hour rule and taxonomy**
22. Cancel at T-73h with `driver_schedule_conflict` → **no** `late_cancellation`.
23. Cancel at T-71h59m, same code → exactly one incident; a duplicate cancel call still yields **one** (deterministic id).
24. Cancel at T-1h with `equipment_breakdown` → `excused_cancellation` only; `lateCancellations` stays 0.
25. Host changes pay/route/slot inside 72h → `host_material_change` on the org, and a driver cancel in the next 24h is excused **whatever code they pick**.
26. Cancel with no `cancellationReasonCode` → schema rejection. Legacy nulls load as `legacy_unclassified` and never break a counter.
27. `reservedCount` decrements exactly once; a second cancel on an already-cancelled assignment does not decrement again.

**Cancel-then-take**
28. Cancel A unexcused → book overlapping B within 7 days → one `cancel_then_take` naming both.
29. Book B → cancel overlapping A → one `take_then_cancel`. (Both directions.)
30. Cancel A for `equipment_breakdown`, book non-overlapping B two days later → **no incident.** (False-positive control; without it, honest drivers get flagged.)
31. Same pattern 8 days later → outside lookback, no incident.

**Offers and deadlines**
32. Offer with `expiresAt >= slot.startAt` → rejected at creation.
33. Expired offer materializes once, releases its hold once, and a claim after expiry throws — including a claim arriving in the same mutation as the sweep.
34. Host non-response past deadline → request expires `expired_unconfirmed`, capacity restored, one `host_slow_response`; running the sweep twice yields one incident and one restore.
35. Missed T-24h confirmation → assignment stays `accepted`, `confirmationState: "unconfirmed"`, exactly one `unconfirmed_at_deadline`.

**Ladder off**
36. A driver with 99 `late_cancellation` and 20 `no_show` incidents can still request, claim, and be approved under `DEFAULT_SCHEDULING_POLICY`; `evaluateEnforcement` returns `{ outcome: "none" }`. **This is the control proving the ladder shipped off.**
37. With injected thresholds, each rung fires at its exact boundary and not one below.
38. Guardrail test: driver-facing scheduling copy contains no `suspend` / `penalt` / `ban` string.

**Counters**
39. A driver with 40 accepted / 2 cancelled has a **lower** rate than one with 4 accepted / 2 cancelled.
40. Below 5 accepted assignments the API returns `lateCancellationRate: null` — one incident cannot brand a new driver.

**Snapshot shape**
41. `upgradeStateSnapshot` on a pre-migration snapshot yields `schedulingIncidents: []` and an `ianaTimeZone` on every site; `REQUIRED_TABLES` contains `schedulingIncidents` (so `seedDatabaseState` must gain it in the same change).
42. A snapshot lacking the collection, then an immediate cancel, does not throw — the `??=` is present.

---

## 11. PR sequence (each green: typecheck / unit / lint / guardrails / e2e)

- **PR-A** — time zones + occupancy model. `geo.ts`, `time-zones.ts`, `scheduling.ts`, snapshot migration, slot generation from `operatingHoursLocal` replacing `loads.ts:33-37`. **Annotation only, no gating.**
- **PR-B** — conflict checker enforcing at request / approve / claim; auto-mint deleted; `:748-753` re-scoped per slot; **slot picker UI**; `/api/truck-slots` org + permission + capacity fix. The picker must ship here — enforcement without alternatives is a wall.
- **PR-C** — cancellation taxonomy, 72-hour rule, incidents, cancel-then-take, enforcement ladder implemented and **off**.
- **PR-D** — offer expiry sweep, response/confirmation deadlines, reliability surfacing on `/host/reliability`.

`main` auto-deploys to production; PR-B is the one that changes what a live driver can do, so its e2e must cover the picker-with-disabled-conflicting-slot path end to end.

---

# 4. LogLoads Marketplace — Data Model Specification

# LogLoads Marketplace — Data Model Specification

Scope: snapshot collections, zod contracts, and `upgradeStateSnapshot` backfill for load series/slots, driver pay, non-custodial payment records, platform fee accrual, invoicing, and cancellation incidents. Phase 0 (record-only) only. No Stripe Connect fields are specified — see §12.

---

## 0. Placement rules (apply to every section below)

| Concern | Where it lives | Why |
|---|---|---|
| Entity zod schemas + derived types | `packages/contracts/src/production-network.ts` (marketplace/ops entities) and `packages/contracts/src/schemas.ts` (core entities being extended in place) | matches existing split |
| Money arithmetic + billability predicates | **new** `packages/contracts/src/billing-model.ts` | Honesty rules must live in contracts, never as private service helpers. An adversarial pass that restores a bug inside a private helper passes every test; a contract function does not. |
| Enums | `packages/contracts/src/enums.ts` | existing home for `loadStatusSchema`, `truckSlotStatusSchema` |
| Collection registration | `packages/db/src/types.ts:42` (`LogLoadsDatabaseState`) **and** `packages/db/src/seed-data.ts:2699` (`seedDatabaseState`) | `REQUIRED_TABLES = Object.keys(seedDatabaseState)` (`packages/db/src/snapshot.ts:6`). A collection added to `types.ts` but not to `seedDatabaseState` is **never required** — a snapshot missing it silently passes validation. Both edits are one atomic change. |
| Backfill | `upgradeStateSnapshot`, `packages/db/src/snapshot.ts:52` | |

**The single most important constraint on everything below:** `upgradeStateSnapshot` **casts** (`return candidate as LogLoadsDatabaseState`), it does not parse. Every `z.*.default()` you write is dead on the load path. **Any new field on an existing entity must be explicitly defaulted inside `upgradeStateSnapshot`'s `.map()` for that collection, or every reader gets an `undefined` the types deny.** Adding the schema field and the migrator default are one atomic change, always in the same PR.

**Schema version.** Bump `OPERATING_STATE_SCHEMA_VERSION` (`packages/db/src/snapshot.ts:12`) from `2` to `3`. Rationale: money-bearing collections are the first ones where a rollback that silently drops rows would cause **re-billing** rather than data loss, so an operator must be able to read the persisted snapshot and tell whether it predates billing. The version bump is a marker only — the `??= []` guards remain the actual rollback-safe mechanism, because `upgradeStateSnapshot` spreads `{...value}` and therefore old code preserves unknown collections it cannot see.

---

## 1. Shared money primitive

**New, in `packages/contracts/src/schemas.ts`, immediately above `moneySchema` (line 46).**

```ts
/**
 * Integer US cents. Every money figure in the marketplace is this type.
 * .int() rejects 12.5; .max() rejects the 1e21 that .int() would otherwise
 * accept (Number.isInteger(1e21) === true) and that would survive JSON.
 */
export const centsSchema = z.number().int().nonnegative().max(100_000_000)

/** Adjustments and divergences may be negative. Same integer/ceiling rules. */
export const signedCentsSchema = z.number().int().min(-100_000_000).max(100_000_000)

/** 500 = 5.00%. Basis points, so the rate is exact and never a float ratio. */
export const basisPointsSchema = z.number().int().min(0).max(10_000)
```

**Decision: do NOT reuse `moneySchema` (`schemas.ts:46`) for any new field.** It nests `{amountCents, currency}` where `currency: z.string().length(3).default("USD")` accepts `"xyz"`, and it forces every arithmetic site to unwrap. `moneySchema` stays exactly where it is (`rateSchema.baseRate`, `schemas.ts:218`) as part of the company price card. New marketplace money is scalar `*Cents`. Currency is asserted once, on the invoice (§9).

---

## 2. Load series — REUSE `loadPosting`, do not add a series entity

**Decision: `loadPosting` IS the series parent. No `loadSeries` collection is created.**

Justification: `loadPosting` already carries `scheduleType`, `campaignStartDate`, `campaignEndDate`, `recurringSchedule`, and `dailyTruckCountNeeded` (`schemas.ts:228-256`); `opportunityCapacity` already aggregates at posting level (`production-network.ts:185`); every existing reader, route pack, message thread, and assignment is keyed on `loadPostingId`. Inserting a third level between posting and slot would force a re-resolve in every one of those readers for zero new expressive power. The series *plan* becomes an embedded object on the posting; the *units* are truck slots.

### 2.1 `loadPostingSchema` — EXTEND (`packages/contracts/src/schemas.ts:228`)

```ts
/** How a series minted its slots. Retained so a later plan edit is visibly a
 *  new version rather than a silent rewrite of slots drivers already read. */
export const loadSeriesPlanSchema = z.object({
  version: z.number().int().positive(),
  /** Local dates the series covers, ascending, no duplicates. */
  slotDates: z.array(z.string().date()).min(1).max(60),
  slotsPerDay: z.number().int().positive().max(24),
  /** Host-chosen loading window, local to the landing's timezone. */
  dayStartMinutes: z.number().int().min(0).max(1439),
  slotDurationMinutes: z.number().int().positive().max(720),
  /** Gap between consecutive slots on the same day. 0 = back-to-back. */
  slotGapMinutes: z.number().int().min(0).max(720),
  generatedAt: timestampSchema
})
  .refine((v) => new Set(v.slotDates).size === v.slotDates.length, {
    message: "Series dates must be unique", path: ["slotDates"]
  })

// added to loadPostingSchema:
  /**
   * The flat amount the HOST pays the driver for one load in this series, in
   * integer cents. This is the figure a driver reads. It is NOT derived from
   * rateId — that is a company price card and must never be shown to a driver.
   */
  driverPayCents: centsSchema.nullable(),
  /**
   * null for a single-window posting; set when the posting minted a series.
   * Series parents own their slots: totalSlots === count of series_unit slots.
   */
  seriesPlan: loadSeriesPlanSchema.nullable(),
```

`seriesPlan` supersedes `recurringSchedule` for slot generation. `recurringSchedule` is **not** removed (existing rows carry it) but nothing new may read it for minting. A publication guard must reject a posting that has both non-null.

**Publication gate (service-level, `packages/services/src/loads.ts`):** a posting may not leave `draft` with `driverPayCents === null`. Non-negotiable, and it must live in the service, not the publish form — API routes bypass UI.

**Backfill in `upgradeStateSnapshot`:**
```ts
if (Array.isArray(candidate.loadPostings)) {
  candidate.loadPostings = candidate.loadPostings.map((posting) => ({
    ...posting,
    driverPayCents: posting.driverPayCents ?? null,
    seriesPlan: posting.seriesPlan ?? null
  }))
}
```
**Do not derive `driverPayCents` from `rateId`.** A per-ton or negotiated rate card cannot be honestly collapsed into a flat driver-pay number, and writing a computed one would print a promise to a driver that no host ever made. Existing postings stay `null`, are readable, and simply cannot be republished until a host states a figure. A migration that invented these numbers would be the exact defect class this codebase refuses.

### 2.2 `landing.slotWindowMinutes` — now read

`slotWindowMinutes` is stored and read by nothing; `loads.ts` hardcodes a 13:00–21:00Z window. `loadSeriesPlanSchema.slotDurationMinutes` **defaults from `landing.slotWindowMinutes`** at plan construction time (in the service, not the schema) and is then frozen on the plan. The hardcoded 13:00–21:00Z window is deleted in the same PR. No schema change to `landingSchema`.

---

## 3. `truckSlot` — EXTEND into the billable unit (`packages/contracts/src/schemas.ts:259`)

**Decision: EXTEND `truckSlots`; do not replace it and do not add a parallel `loadSlots` collection.** A slot already carries `loadPostingId`, `landingId`, `slotDate`, `startAt`, `endAt`, `capacity`, `reservedCount`, `status`, and is already the FK target of `assignment.truckSlotId` (`schemas.ts:307`). Everything the series model needs is a superset of that.

The one genuine conflict is `capacity`: a series unit takes exactly one truck, but existing rows have `capacity > 1`. Resolve with a discriminator rather than a destructive rewrite.

```ts
/** enums.ts */
export const truckSlotKindSchema = z.enum([
  /** Legacy/ad-hoc: one loading window several trucks may share. Pre-marketplace. */
  "shared_window",
  /** One haul, one driver, one pay figure, one fee. The billable unit. */
  "series_unit"
])
```

```ts
// added to truckSlotSchema:
  kind: truckSlotKindSchema,
  /** 1-based position across the WHOLE series (6 loads => 1..6). Unique per posting. */
  seriesSequence: z.number().int().positive().nullable(),
  /** 1-based position within this slot's day (3/day => 1..3). */
  daySequence: z.number().int().positive().nullable(),
  /** The seriesPlan.version that minted this slot. */
  seriesPlanVersion: z.number().int().positive().nullable(),
  /**
   * Driver pay for THIS slot, frozen at mint from loadPosting.driverPayCents.
   * Per-slot because a host may pay more for the 5am run than the 2pm run, and
   * because editing the posting must never silently re-price a minted slot.
   * Host-editable ONLY while status === "open" and reservedCount === 0.
   */
  driverPayCents: centsSchema.nullable(),

// added refines:
  .refine((v) => v.kind !== "series_unit" || v.capacity === 1, {
    message: "A series slot carries exactly one truck", path: ["capacity"]
  })
  .refine((v) => v.kind !== "series_unit" || v.driverPayCents !== null, {
    message: "A series slot must state driver pay", path: ["driverPayCents"]
  })
  .refine((v) => v.kind !== "series_unit" ||
    (v.seriesSequence !== null && v.daySequence !== null && v.seriesPlanVersion !== null), {
    message: "A series slot must state its position in the series", path: ["seriesSequence"]
  })
```

**Backfill:**
```ts
if (Array.isArray(candidate.truckSlots)) {
  candidate.truckSlots = candidate.truckSlots.map((slot) => ({
    ...slot,
    daySequence: slot.daySequence ?? null,
    driverPayCents: slot.driverPayCents ?? null,
    kind: slot.kind ?? "shared_window",
    seriesPlanVersion: slot.seriesPlanVersion ?? null,
    seriesSequence: slot.seriesSequence ?? null
  }))
}
```
Every pre-existing slot becomes `shared_window` with null pay. `shared_window` slots are **never billable** (§8) — no fee can be accrued against a slot that never carried a stated driver-pay figure.

### 3.1 Invariants this creates

| Invariant | Enforced in |
|---|---|
| At most one **active** assignment per `series_unit` slot (`requested`/`offered`/`accepted`/`checked_in`/`loading`/`hauled`) | `packages/services/src/operating-network.ts` — the duplicate check at **748–753** is re-scoped from `loadPostingId + driverProfileId` to **`truckSlotId`**, and a second assertion added: no other active assignment holds this slot regardless of driver. Both assertions, not one — per-driver-per-posting must still exist for `shared_window` slots. |
| `opportunityCapacity.totalTruckloads === count(series_unit slots for posting)` | new refine is impossible (cross-entity); assert in `loads.ts` at mint and in a service test |
| `POST /api/truck-slots` must gain org check + `publish_load` permission check + capacity update | `apps/web/app/api/truck-slots` — **this route currently has none.** It now writes `driverPayCents`, a host-authored money figure. An unauthenticated writer could set any org's driver pay. This is a launch blocker for the slot PR, not a follow-up. |
| Slot booking must offer a picker | every surface currently books `futureOpenSlots[0]`; with `seriesSequence` there is a meaningful choice and the auto-pick becomes a lie about what the driver selected |

### 3.2 The scheduling-conflict check

The overlap check exists only inside `claimDirectOffer` (`operating-network.ts` ~2889–2907), has no tests; `matching.ts:101-123` claims an overlap it does not compute; `cockpit-actions.ts:110-117` auto-mints a covering availability window. Extract to `packages/contracts/src/billing-model.ts`'s sibling — **new** `packages/contracts/src/scheduling-model.ts` — as a pure `hasSlotConflict(existingSlots, candidate)`, called from **all three** paths. No new collection. The auto-minted availability window in `cockpit-actions.ts` is deleted: fabricating availability to satisfy a check is the check answering itself.

---

## 4. `assignment` — EXTEND to freeze the agreed pay (`packages/contracts/src/schemas.ts:302`)

```ts
  /**
   * The driver-pay figure as it stood when this assignment was accepted.
   * Frozen here, not read back through truckSlot, so a later host edit can
   * never rewrite what the driver agreed to. THIS is the fee basis (§8) and
   * the haulPayment amount (§7) — the slot's current value is never either.
   */
  acceptedDriverPayCents: centsSchema.nullable(),
  acceptedDriverPayAt: optionalTimestampSchema,
```

Written exactly once, by the service, at the `requested|offered → accepted` transition, copying `truckSlot.driverPayCents`. Never mutated afterward by any actor. Not in `termsSnapshot` — a money figure hidden in a `z.record(z.unknown())` cannot be typed, refined, or asserted on, which is the same reason `directOfferId` was pulled out of it (`schemas.ts:305-308`).

**Backfill:**
```ts
if (Array.isArray(candidate.assignments)) {
  candidate.assignments = candidate.assignments.map((assignment) => ({
    ...assignment,
    acceptedDriverPayAt: assignment.acceptedDriverPayAt ?? null,
    acceptedDriverPayCents: assignment.acceptedDriverPayCents ?? null,
    termsSnapshot: assignment.termsSnapshot ?? {}   // existing guard, keep
  }))
}
```
Assignments accepted before driver pay existed stay `null` and are permanently non-billable. Correct: no host ever agreed to a number on them.

---

## 5. `driverPayoutPreference` — NEW collection

**Reuses nothing.** No existing entity records how a person wants to be paid.

```ts
export const payoutMethodSchema = z.enum([
  "check", "ach_transfer", "zelle", "venmo", "cash_app", "cash", "other"
])

/**
 * How a driver asks to be paid, recorded so a host knows where to send money.
 * LogLoads is strictly non-custodial: this is an address book entry, not an
 * instrument. Full account/routing numbers are REFUSED here — a platform that
 * does not move money has no reason to hold them, and holding them converts a
 * record-keeping product into a data-breach liability.
 */
export const payoutHandleSchema = z.string().trim().min(1).max(120)
  .refine((v) => !/\d{9,}/.test(v.replace(/[\s-]/g, "")), {
    message: "Do not enter bank account or routing numbers. Describe how to reach you."
  })

export const driverPayoutPreferenceSchema = z.object({
  id: uuidSchema,
  driverProfileId: uuidSchema,
  /** The org this driver hauls under; the host pays whoever this resolves to. */
  organizationId: uuidSchema,
  /**
   * organization = pay the carrier (company driver).
   * driver = pay this person directly (owner-operator).
   * The driver chooses; the host is told, never asked to guess.
   */
  payee: z.enum(["organization", "driver"]),
  method: payoutMethodSchema,
  /** "Mail to Cedar Ridge Hauling, PO Box 12" / "Zelle 503-555-0142". */
  handle: payoutHandleSchema,
  instructions: z.string().trim().max(300).optional().nullable(),
  /** Superseded rows are retained, never deleted — same rule as route packs. */
  supersededAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
```

**Write authority.** Only the user who owns `driverProfileId` (`driverProfile.userId === actor.id`) may create or supersede. Not a role permission — an org `admin` must not be able to redirect a driver's pay to themselves. This is identity-gated, and the service asserts identity, not `organizationRoleCan`.

**Uniqueness.** At most one row per `driverProfileId` with `supersededAt === null`. Enforced by service assertion; there is no unique index in the snapshot.

**Backfill:** `candidate.driverPayoutPreferences ??= []`.

---

## 6. Payment vocabulary — a hard naming constraint

`tripSchemaV2.completionStatus` already uses `"confirmed"` and `completionConfirmedByUserId` to mean **the host accepted the delivery** (`production-network.ts:349-357`). Payment must not reuse that word in any field or status name. The enum below deliberately shares no member with `haulCompletionStatusSchema`.

---

## 7. `haulPayment` — NEW collection (record-only)

**Reuses nothing.** Trip completion records *what came off the truck*; nothing records *whether money moved*.

```ts
export const haulPaymentStatusSchema = z.enum([
  /** Nobody has said anything. Default at creation. */
  "awaiting_payment",
  /** The host states they sent it. A claim, not a receipt. */
  "marked_sent",
  /** The DRIVER states it arrived. Only this state is proof. */
  "receipt_confirmed",
  /** The driver contests the amount, the arrival, or both. */
  "receipt_disputed"
])

/**
 * Phase 0 rail. Single member on purpose: a one-member enum means no UI can
 * render a rail selector that resolves to a code path that does not exist.
 * Adding "stripe_connect_direct" is counsel-gated (§12).
 */
export const haulPaymentRailSchema = z.enum(["off_platform"])

export const haulPaymentSchema = z.object({
  /** Deterministic: see §7.2. Not random. */
  id: uuidSchema,
  truckSlotId: uuidSchema,
  tripId: uuidSchema,
  assignmentId: uuidSchema,
  loadPostingId: uuidSchema,
  /** Who owes. Resolved from loadPosting.companyId's organization at creation. */
  payerOrganizationId: uuidSchema,
  /** Who is owed. Resolved from the driver's payout preference at creation. */
  payeeOrganizationId: uuidSchema,
  payeeDriverProfileId: uuidSchema,
  rail: haulPaymentRailSchema,
  status: haulPaymentStatusSchema,

  /**
   * The agreed figure, copied from assignment.acceptedDriverPayCents. Frozen.
   * The platform fee is NEVER subtracted from this and no field on this record
   * is net-of-fee. The host pays the fee on top, separately, on an invoice.
   */
  amountCents: centsSchema,

  /** Host's claim. */
  method: payoutMethodSchema.nullable(),
  /** Cheque number, transfer memo. Never an account number — payoutHandleSchema rules apply. */
  reference: payoutHandleSchema.optional().nullable(),
  markedSentAt: optionalTimestampSchema,
  markedSentByUserId: uuidSchema.optional().nullable(),

  /** Driver's account of what actually arrived. */
  receiptConfirmedAt: optionalTimestampSchema,
  receiptConfirmedByUserId: uuidSchema.optional().nullable(),
  /**
   * What the driver says landed. May differ from amountCents. Recorded, never
   * reconciled away — divergence is the signal (locked decision 9).
   */
  receiptAmountCents: centsSchema.nullable(),

  disputedAt: optionalTimestampSchema,
  disputedByUserId: uuidSchema.optional().nullable(),
  disputeReason: z.enum([
    "not_received", "amount_short", "amount_over", "wrong_payee", "other"
  ]).nullable(),
  disputeNote: z.string().trim().max(500).optional().nullable(),
  disputeResolvedAt: optionalTimestampSchema,
  disputeResolution: z.enum([
    "paid_in_full", "adjusted_and_paid", "withdrawn", "unresolved"
  ]).nullable(),

  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
```

### 7.1 Write authority (field-level, enforced in the service)

| Fields | Who may write | Gate |
|---|---|---|
| creation, `amountCents`, `payerOrganizationId`, `payeeOrganizationId`, `payeeDriverProfileId`, `rail` | system only, on trip `completionStatus → confirmed` | no actor writes these; created by the completion service |
| `status: marked_sent`, `method`, `reference`, `markedSentAt/ByUserId` | a member of `payerOrganizationId` holding **`record_haul_payment`** (new action, §7.3) | `organizationRoleCan` |
| `status: receipt_confirmed`, `receiptConfirmedAt/ByUserId`, `receiptAmountCents` | **only** the user behind `payeeDriverProfileId` | identity assertion — `driverProfile.userId === actor.id`. Not a role permission. A host `owner` must not be able to confirm their own payment; that would make the confirmation worthless. |
| `status: receipt_disputed`, `disputedAt/ByUserId`, `disputeReason`, `disputeNote` | **only** the payee driver | same identity assertion |
| `disputeResolvedAt`, `disputeResolution` | platform org (`organizationType === "platform"`) with `view_audit_log`, **or** the driver choosing `withdrawn` | two paths, both asserted |
| `amountCents` after creation | **nobody, ever** | assert immutability; a test must prove it |

Legal transitions: `awaiting_payment → marked_sent → receipt_confirmed | receipt_disputed`; `receipt_disputed → receipt_confirmed` (on resolution) only. `receipt_confirmed` is terminal in the forward direction. Encode as a `haulPaymentTransitions` record next to `tripTransitions` (`production-network.ts:580`) with a `canTransitionHaulPaymentStatus` export.

### 7.2 Deterministic id

```ts
// packages/contracts/src/billing-model.ts
export function haulPaymentId(tripId: string): string   // uuid v5, namespace HAUL_PAYMENT_NS
export function platformFeeEventId(truckSlotId: string): string // uuid v5, namespace PLATFORM_FEE_NS
export function invoiceLineId(invoiceId: string, sourceId: string): string
```
Implemented with `createHash("sha256")` reshaped to a v5-formatted uuid (the repo already hashes with `node:crypto` — `packages/services/src/support-requests.ts:151`) so `uuidSchema` still validates. `createUuid()` (`packages/services/src/utils.ts:13`) is **not** used for any money record. The deterministic id is the primary double-write defence: the snapshot has no unique index, no CHECK, and no FK.

**One payment per trip, not per slot** — a slot whose first assignment was cancelled and re-assigned yields a new trip and legitimately a new payment record. The fee (§8) is keyed on the slot precisely because it must *not* be re-chargeable.

### 7.3 New permission action

Add `"record_haul_payment"` to `ORGANIZATION_ACTIONS` (`packages/contracts/src/permissions.ts:26`). Granted to: `owner`, `admin`, `billing`, `dispatcher`. **Not** `driver`, `viewer`, `landing_manager`, `destination_manager`. `packages/contracts/src/permissions.test.ts` enumerates the matrix — extend it, do not spot-check.

**Backfill:** `candidate.haulPayments ??= []`.

---

## 8. `platformFeeEvent` — NEW collection

**Reuses nothing.** `entitlementSchema` (`production-network.ts:484`) is a Stripe *subscription* record and stays exactly as-is; per-load fees are a different fact with a different lifecycle.

### 8.1 Billable completion (contract function, `billing-model.ts`)

```ts
/**
 * A load is billable when BOTH sides have closed it: the host accepted the
 * delivery AND the driver confirmed the money arrived. Requested, accepted,
 * cancelled, and delivered-but-unpaid loads generate nothing.
 */
export function billableCompletionAt(input: {
  slotKind: TruckSlotKind
  acceptedDriverPayCents: number | null
  tripCompletionStatus: HaulCompletionStatus
  tripCompletionConfirmedAt: string | null
  paymentStatus: HaulPaymentStatus
  receiptConfirmedAt: string | null
}): string | null
```
Returns the **later** of the two timestamps, or `null` when: `slotKind !== "series_unit"`, `acceptedDriverPayCents === null`, `tripCompletionStatus !== "confirmed"`, or `paymentStatus !== "receipt_confirmed"`. Pure, exported, unit-tested against every combination — not an inline `if` in the accrual service.

### 8.2 Schema

```ts
export const platformFeeEventStatusSchema = z.enum([
  "accrued",    // owed, not yet on an invoice
  "invoiced",   // attached to an invoiceLine
  "reversed"    // withdrawn; a credit carries the money back, the row stays
])

export const platformFeeEventSchema = z.object({
  /** platformFeeEventId(truckSlotId). Deterministic. This is the whole
   *  at-most-one defence — there is no unique index behind it. */
  id: uuidSchema,
  /** The billed host org. */
  organizationId: uuidSchema,
  loadPostingId: uuidSchema,
  truckSlotId: uuidSchema,
  assignmentId: uuidSchema,
  tripId: uuidSchema,
  haulPaymentId: uuidSchema,

  /** assignment.acceptedDriverPayCents. The posted figure the host committed
   *  to — NOT haulPayment.receiptAmountCents. A driver reporting a short
   *  payment must never silently reduce what the platform charges; that would
   *  make under-paying drivers cheaper for the host. */
  basisAmountCents: centsSchema,
  /** 500. Frozen at accrual: a rate change is never retroactive (decision 3). */
  feeRateBasisPoints: basisPointsSchema,
  /** computePlatformFeeCents(basisAmountCents, feeRateBasisPoints). Stored, not
   *  recomputed at read — a stored figure is what the host was told. */
  feeAmountCents: centsSchema,
  /** Identifies the published rate policy the frozen values came from. */
  ratePolicyVersion: z.string().min(1),

  /** receiptAmountCents - basisAmountCents when the driver's figure differs.
   *  Recorded for detection (decision 9). Never changes the fee. */
  payDivergenceCents: signedCentsSchema.nullable(),

  status: platformFeeEventStatusSchema,
  billableAt: timestampSchema,
  invoiceId: uuidSchema.nullable(),
  reversedAt: optionalTimestampSchema,
  reversalReason: z.enum([
    "billing_error", "duplicate_load", "platform_outage",
    "cancelled_after_completion", "goodwill"
  ]).nullable(),
  reversalCreditId: uuidSchema.nullable(),
  reversedByUserId: uuidSchema.optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((v) => v.status !== "reversed" ||
    (v.reversedAt !== null && v.reversalReason !== null && v.reversalCreditId !== null), {
    message: "A reversed fee must carry a reason and a credit", path: ["reversalCreditId"]
  })
  .refine((v) => v.status !== "invoiced" || v.invoiceId !== null, {
    message: "An invoiced fee must name its invoice", path: ["invoiceId"]
  })
```

### 8.3 Fee computation (`billing-model.ts`)

```ts
export const PLATFORM_FEE_BASIS_POINTS = 500          // flat 5%, not tiered
export const PLATFORM_MONTHLY_MINIMUM_CENTS = 4_900   // $49.00
export const PLATFORM_RATE_POLICY_VERSION = "2026-07-fee-v1"

/** Half-up on exact halves. $5.00 basis => 25c. $0.50 basis => 3c, not 2c. */
export function computePlatformFeeCents(basisCents: number, bp: number): number {
  if (!Number.isSafeInteger(basisCents) || basisCents < 0) throw new Error(...)
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10_000) throw new Error(...)
  return Math.round((basisCents * bp) / 10_000)
}
```
Flat, never graduated: the slot model makes load count host-controlled, so tiers are gameable by construction, and graduated tiers would re-rate other loads whenever one is reversed.

### 8.4 At-most-one-per-slot

Three layers, all required:
1. `id = platformFeeEventId(truckSlotId)` — a second accrual computes the same id.
2. Service assertion before push: `assertCondition(!state.platformFeeEvents.some((e) => e.id === id), ...)`.
3. Service assertion: no event with this `truckSlotId` in **any** status, including `reversed`. **A reversal is terminal for the slot** — a slot whose fee was reversed can never accrue again, even if the load is re-completed. Without this, "reverse and re-complete" is a double-bill.

**Backfill:** `candidate.platformFeeEvents ??= []`.

---

## 9. `invoice`, `invoiceLine`, `credit` — NEW collections

**Reuse nothing.** `entitlementSchema` holds `stripeSubscriptionId` and `currentPeriodEndsAt` for the recurring plan; the invoice is the per-period bill and carries its own `stripeInvoiceId`. Keep them separate — collapsing them would make a plan-status webhook capable of mutating a bill.

```ts
export const invoiceSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  /** Inclusive start, exclusive end. */
  periodStartAt: timestampSchema,
  periodEndAt: timestampSchema,
  status: z.enum(["draft", "open", "paid", "void", "uncollectible"]),
  currency: z.literal("USD"),

  /** Sum of platform_fee lines. */
  feeSubtotalCents: centsSchema,
  /** PLATFORM_MONTHLY_MINIMUM_CENTS, frozen on the invoice — never read live
   *  at render, or a rate change would silently restate an issued bill. */
  monthlyMinimumCents: centsSchema,
  /** max(0, monthlyMinimumCents - feeSubtotalCents). A top-up, never a floor
   *  applied by clamping the subtotal, so the host can see both numbers. */
  minimumAdjustmentCents: centsSchema,
  creditsAppliedCents: centsSchema,
  totalCents: centsSchema,

  ratePolicyVersion: z.string().min(1),
  stripeInvoiceId: z.string().optional().nullable(),
  issuedAt: optionalTimestampSchema,
  dueAt: optionalTimestampSchema,
  paidAt: optionalTimestampSchema,
  voidedAt: optionalTimestampSchema,
  voidReason: z.string().trim().max(300).optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((v) => v.totalCents ===
    v.feeSubtotalCents + v.minimumAdjustmentCents - v.creditsAppliedCents, {
    message: "Invoice total must equal its parts", path: ["totalCents"]
  })
  .refine((v) => v.minimumAdjustmentCents ===
    Math.max(0, v.monthlyMinimumCents - v.feeSubtotalCents), {
    message: "Minimum adjustment must be the stated top-up", path: ["minimumAdjustmentCents"]
  })
  .refine((v) => v.status !== "void" || (v.voidedAt !== null && v.voidReason !== null), {
    message: "A voided invoice must say why", path: ["voidReason"]
  })

export const invoiceLineSchema = z.object({
  /** invoiceLineId(invoiceId, platformFeeEventId ?? kind). Deterministic:
   *  the same fee can never appear twice on the same invoice. */
  id: uuidSchema,
  invoiceId: uuidSchema,
  organizationId: uuidSchema,
  kind: z.enum(["platform_fee", "monthly_minimum", "credit_applied", "adjustment"]),
  platformFeeEventId: uuidSchema.nullable(),
  creditId: uuidSchema.nullable(),
  /** Set on platform_fee lines so a host can trace a charge back to a haul. */
  truckSlotId: uuidSchema.nullable(),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive(),
  unitAmountCents: signedCentsSchema,
  /** quantity * unitAmountCents. Negative for credit_applied. */
  amountCents: signedCentsSchema,
  createdAt: timestampSchema
})
  .refine((v) => v.amountCents === v.quantity * v.unitAmountCents, {
    message: "Line amount must equal quantity times unit amount", path: ["amountCents"]
  })
  .refine((v) => v.kind !== "platform_fee" ||
    (v.platformFeeEventId !== null && v.truckSlotId !== null && v.unitAmountCents >= 0), {
    message: "A fee line must name its fee event and haul", path: ["platformFeeEventId"]
  })
  .refine((v) => v.kind !== "credit_applied" ||
    (v.creditId !== null && v.unitAmountCents <= 0), {
    message: "A credit line must name its credit and reduce the bill", path: ["creditId"]
  })

export const creditSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  reason: z.enum([
    "fee_reversal", "billing_error", "service_credit", "goodwill", "promotional"
  ]),
  /** For reason === "fee_reversal", equals the reversed feeAmountCents. */
  amountCents: centsSchema,
  /** amountCents minus everything already applied. Partial application is real:
   *  a $49 credit against a $12 invoice leaves $37 on the books. */
  remainingCents: centsSchema,
  sourcePlatformFeeEventId: uuidSchema.nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  issuedByUserId: uuidSchema.optional().nullable(),
  issuedAt: timestampSchema,
  expiresAt: optionalTimestampSchema,
  voidedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((v) => v.remainingCents <= v.amountCents, {
    message: "Remaining credit cannot exceed the credit issued", path: ["remainingCents"]
  })
  .refine((v) => v.reason !== "fee_reversal" || v.sourcePlatformFeeEventId !== null, {
    message: "A reversal credit must name the fee it reverses", path: ["sourcePlatformFeeEventId"]
  })
```

**Write authority.** Invoices, lines, and `fee_reversal` credits are written by the billing service only — no org role writes them. `service_credit`/`goodwill`/`promotional` credits require a platform-org actor with `manage_billing`. `paidAt`/`stripeInvoiceId` are written only by the Stripe webhook path in `packages/services/src/billing.ts`, reusing that file's existing `eventId` replay guard (`billing.ts:31`) — extend it to invoice events rather than writing a second idempotency mechanism.

**Backfill:** `candidate.invoices ??= []`, `candidate.invoiceLines ??= []`, `candidate.credits ??= []`.

---

## 10. `cancellationIncident` — NEW collection

**Reuses nothing; supersedes free text.** `assignment.cancellationReason` and `loadPosting.cancellationReason` are `z.string().nullable()` (`schemas.ts:253, 315`) written by `cancelAssignment` (`packages/services/src/assignments.ts:114-128`). Free text cannot be counted, attributed, or evidenced. **Both existing fields are retained** (they hold real historical text and are shown on old records), but every *new* cancellation writes a `cancellationIncident` and mirrors `incident.note` into the legacy string so existing readers keep working. The legacy fields are marked deprecated in a comment, not deleted.

```ts
export const cancellationReasonSchema = z.enum([
  // Environment — typically no-fault
  "weather", "road_conditions", "fire_or_safety_closure",
  // Host side
  "landing_not_ready", "loader_unavailable", "mill_closed_or_quota",
  "load_no_longer_needed", "host_rescheduled",
  // Hauler side
  "equipment_failure", "driver_unavailable", "driver_no_show", "hauler_rescheduled",
  // Either
  "safety_stop", "duplicate_booking", "other"
])

export const cancellationFaultSchema = z.enum([
  /** Default. Nobody has ruled. Never displayed as "no fault". */
  "unattributed",
  "host", "hauler", "no_fault", "shared"
])

export const cancellationIncidentSchema = z.object({
  id: uuidSchema,
  truckSlotId: uuidSchema,
  loadPostingId: uuidSchema,
  assignmentId: uuidSchema.nullable(),
  tripId: uuidSchema.nullable(),

  cancelledByUserId: uuidSchema,
  cancelledByOrganizationId: uuidSchema,
  /** Which side pressed the button. A FACT, distinct from fault. */
  actorSide: z.enum(["host", "hauler", "platform"]),

  reason: cancellationReasonSchema,
  note: z.string().trim().min(1).max(500),
  /** Where the haul had got to. Frozen — the trip may later be pruned. */
  tripStatusAtCancellation: tripStatusV2Schema.nullable(),
  assignmentStatusAtCancellation: assignmentStatusSchema,
  /** How close to the loading window. Negative = after it started. */
  minutesBeforeSlotStart: z.number().int(),

  evidence: z.array(z.object({
    kind: z.enum(["trip_document", "photo", "message_thread", "note"]),
    tripDocumentId: uuidSchema.nullable(),
    messageThreadId: uuidSchema.nullable(),
    note: z.string().trim().max(300).nullable()
  })).default([]),

  /** Platform-only ruling. Starts "unattributed" and stays there unless a
   *  reviewer rules. An unreviewed incident must never render as exoneration. */
  fault: cancellationFaultSchema,
  faultAttributedByUserId: uuidSchema.optional().nullable(),
  faultAttributedAt: optionalTimestampSchema,
  faultRationale: z.string().trim().max(500).optional().nullable(),

  disputedAt: optionalTimestampSchema,
  disputedByUserId: uuidSchema.optional().nullable(),
  disputeNote: z.string().trim().max(500).optional().nullable(),

  occurredAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((v) => v.fault === "unattributed" ||
    (v.faultAttributedByUserId !== null && v.faultAttributedAt !== null), {
    message: "An attributed fault must name who ruled and when", path: ["fault"]
  })
  .refine((v) => v.evidence.every((e) =>
    (e.kind === "trip_document" && e.tripDocumentId !== null) ||
    (e.kind === "message_thread" && e.messageThreadId !== null) ||
    (e.kind === "photo" && e.tripDocumentId !== null) ||
    (e.kind === "note" && e.note !== null)), {
    message: "Every evidence item must reference what it points at", path: ["evidence"]
  })
```

**Write authority.** `reason`, `note`, `evidence`, `actorSide`, and all frozen status fields: the cancelling actor's org, at cancellation, once — immutable afterward. `fault*`: platform org only. `disputed*`: the non-cancelling party's org only.

**Billing relationship.** A cancellation **never** accrues a fee (locked decision 8). If a fee already accrued for the slot and a cancellation incident is later recorded against it, the service reverses the fee with `reversalReason: "cancelled_after_completion"` and issues a `fee_reversal` credit — it never deletes the fee event and never accrues a replacement (§8.4).

**Backfill:** `candidate.cancellationIncidents ??= []`. Do **not** synthesize incidents from existing `cancellationReason` strings: a free-text string has no actor side, no fault, no timing, and back-filling `"unattributed"` incidents from it would inflate every host's and hauler's cancellation history with records nobody wrote.

---

## 11. The complete `upgradeStateSnapshot` change

Insert **before** the `REQUIRED_TABLES.every(...)` check at `packages/db/src/snapshot.ts:135`, alongside the existing `supportRequests`/`tripReviews`/`tripInspections` guards:

```ts
// Marketplace billing (schema v3). Money-bearing collections: a snapshot that
// predates them must read as "no fee was ever charged", never as undefined.
candidate.driverPayoutPreferences ??= []
candidate.haulPayments ??= []
candidate.platformFeeEvents ??= []
candidate.invoices ??= []
candidate.invoiceLines ??= []
candidate.credits ??= []
candidate.cancellationIncidents ??= []
```
plus the three `.map()` blocks from §2.1, §3, §4.

Same-PR companion edits, all atomic with the above:
- `packages/db/src/types.ts:42` — seven new keys on `LogLoadsDatabaseState`, seven new type imports.
- `packages/db/src/seed-data.ts:2699` — seven new keys on `seedDatabaseState` (empty arrays are fine; `REQUIRED_TABLES` reads keys, not contents), and update the existing seed rows for `loadPostings`/`truckSlots`/`assignments` so the seed exercises at least one full series → payment → fee → invoice chain.
- `packages/contracts/src/index.ts` — export the new modules.
- `packages/db/src/snapshot.ts:12` — `OPERATING_STATE_SCHEMA_VERSION = 3`.

**`packages/db/src/snapshot.test.ts` must gain a test that loads a v2-shaped snapshot object with none of the seven keys present and asserts `upgradeStateSnapshot` returns non-null with all seven as `[]`.** Without it, a future collection added to `types.ts` and `seedDatabaseState` but forgotten in the migrator turns every existing snapshot into `null` — a total outage, because `REQUIRED_TABLES` then demands a key nothing writes.

---

## 12. Explicitly NOT in this model

- **No wallet, balance, escrow, or ledger-account entity.** LogLoads never holds driver funds. There is no collection whose sum represents money the platform is holding, and no field named `balance`.
- **No `applicationFeeAmount`, `transferId`, `destinationAccountId`, or `connectedAccountId` anywhere.** Stripe Connect is Phase 1 and counsel-gated. When it lands it is **direct charges only**; `application_fee_amount` must be zero on driver payments, and destination charges / separate-charges-and-transfers are forbidden. Adding any of these fields now would let a UI advertise rails that do not exist.
- **No brokering entity.** No carrier-authority, MC number, surety-bond, or contract-of-carriage field. LogLoads is not a contracting party at MVP and both footers plus the published Terms disclaim brokering.
- **No tier or volume-band field on `platformFeeEvent`.** The rate is flat by construction.
- **No genericised vocabulary.** `landing`, `mill`, `haulRoute`, `truckSlot`, `tripInspection`, `loadType: saw_logs | pulpwood | chips | biomass` all stay. This is a timber platform.

---

## 13. Integer-cents invariants and the tests that must fail if removed

Every field below is `centsSchema` or `signedCentsSchema` (§1). "Guard" names the specific thing that can be silently deleted; "test" names the file and the assertion that must go red the moment it is.

| # | Guard | Field(s) | Test that must fail if the guard is removed |
|---|---|---|---|
| 1 | `.int()` on `centsSchema` | all `*Cents` | `contracts/src/billing-model.test.ts` → `centsSchema.safeParse(12.5).success === false` and `.safeParse(1e21).success === false`. The `1e21` case is the one people drop: `Number.isInteger(1e21)` is `true`, so `.int()` alone passes it. |
| 2 | **Reflective sweep** — no float cents anywhere | every collection | **new** `db/src/cents-invariant.test.ts`: walk `seedDatabaseState` recursively; for every key matching `/Cents$/` assert `Number.isSafeInteger(value) \|\| value === null`. This is the only guard that automatically covers a collection somebody adds next quarter. Enumerate the whole snapshot, do not spot-check three tables. |
| 3 | Fee = 5% of the **posted** pay, not the confirmed receipt | `platformFeeEvent.basisAmountCents` | `services/src/platform-fee.test.ts`: driver confirms `receiptAmountCents: 40_000` against `acceptedDriverPayCents: 50_000`; assert `basisAmountCents === 50_000`, `feeAmountCents === 2_500`, `payDivergenceCents === -10_000`. If someone "helpfully" re-bases on the receipt, under-paying a driver gets the host a discount — this test catches it. |
| 4 | Rounding is half-up and stored | `computePlatformFeeCents` | `contracts/src/billing-model.test.ts` table: `(50, 500) → 3`, `(10, 500) → 1`, `(0, 500) → 0`, `(99, 500) → 5`, `(50_000, 500) → 2_500`. Asserts the exact function output, not a range. |
| 5 | Frozen rate — never retroactive | `feeRateBasisPoints`, `ratePolicyVersion` | `services/src/platform-fee.test.ts`: accrue at 500 bp, mutate `PLATFORM_FEE_BASIS_POINTS` to 700 via the policy constant, re-read the event; assert `feeRateBasisPoints === 500` and `feeAmountCents` unchanged. A test that recomputes from the live constant would pass either way — assert the **stored** value. |
| 6 | **At most one fee per slot, ever** | deterministic `platformFeeEventId` | `services/src/platform-fee.test.ts`: call the accrual service twice for the same `truckSlotId`; assert `state.platformFeeEvents.filter(e => e.truckSlotId === id).length === 1` **and** that the second call threw. Then: reverse the fee, re-complete the slot, call accrual again; assert still length 1 and still one `feeAmountCents` total. The snapshot has no unique index — this test *is* the index. |
| 7 | Fee is never deducted from driver pay | `haulPayment.amountCents` | `services/src/haul-payment.test.ts`: pay 50_000, fee 2_500; assert `haulPayment.amountCents === 50_000` exactly, and assert no key on the `HaulPayment` type matches `/net|Net|afterFee/`. The second assertion is what stops a future "netAmountCents" convenience field. |
| 8 | `amountCents` immutable after creation | `haulPayment.amountCents` | `services/src/haul-payment.test.ts`: mark sent, confirm receipt with a divergent `receiptAmountCents`, assert `amountCents` unchanged; then attempt a direct service update of `amountCents` and assert it throws. |
| 9 | Only the driver may confirm receipt | `receiptConfirmedByUserId` | `services/src/haul-payment.test.ts`: attempt `receipt_confirmed` as the host org's `owner` and assert it throws; as the payee driver and assert it succeeds. Assert the **refusal**, not only the happy path. |
| 10 | Non-billable states generate nothing | `billableCompletionAt` | `contracts/src/billing-model.test.ts`: assert `null` for each of — `shared_window` slot, `acceptedDriverPayCents === null`, trip `submitted`, trip `disputed`, payment `marked_sent`, payment `receipt_disputed`, cancelled assignment. Seven explicit cases, not one "unhappy path". |
| 11 | Invoice total equals its parts | `invoice.totalCents` | `services/src/invoicing.test.ts`: construct fee subtotal 1_200, minimum 4_900, credits 500; assert `minimumAdjustmentCents === 3_700` and `totalCents === 4_400`; then hand `invoiceSchema.parse` a hand-built object with `totalCents: 9_999` and assert it throws. The refine is only real if a test proves it rejects. |
| 12 | Minimum is a top-up, not a floor applied by clamping | `feeSubtotalCents`, `minimumAdjustmentCents` | `services/src/invoicing.test.ts`: fee subtotal 6_000 (> minimum); assert `minimumAdjustmentCents === 0` and `feeSubtotalCents === 6_000` — the subtotal must never be rewritten up to 4_900 or down to it. |
| 13 | The same fee cannot appear twice on one invoice | deterministic `invoiceLineId` | `services/src/invoicing.test.ts`: run the invoice builder twice over the same accrued fees; assert line count is stable and `feeSubtotalCents` did not double. |
| 14 | Line amount equals quantity × unit | `invoiceLine.amountCents` | `contracts/src/billing-model.test.ts`: `invoiceLineSchema.parse({quantity: 2, unitAmountCents: 500, amountCents: 900})` throws. |
| 15 | Credits cannot over-apply | `credit.remainingCents` | `services/src/invoicing.test.ts`: apply a 500-cent credit to two invoices; assert total applied === 500 and `remainingCents === 0`, and that the second application contributed 0 rather than another 500. |
| 16 | A reversal always produces a credit | `platformFeeEvent.reversalCreditId` | `services/src/platform-fee.test.ts`: reverse a fee; assert a `credit` exists with `reason: "fee_reversal"`, `sourcePlatformFeeEventId` set, and `amountCents === feeAmountCents`. Then assert `platformFeeEventSchema.parse` rejects a `status: "reversed"` row with `reversalCreditId: null`. |
| 17 | Series slot carries exactly one truck and a stated pay | `truckSlot` refines | `contracts/src/schemas.test.ts`: `truckSlotSchema.parse({kind: "series_unit", capacity: 2, ...})` throws; `{kind: "series_unit", driverPayCents: null}` throws; `{kind: "shared_window", capacity: 3, driverPayCents: null}` parses. |
| 18 | One active assignment per series slot | `operating-network.ts` duplicate check | `services/src/operating-network.test.ts`: two **different** drivers request the same `series_unit` slot; assert the second throws. The current check only compares `loadPostingId + driverProfileId`, so two different drivers pass it today — this test fails against `main` and is the proof the re-scope landed. |
| 19 | No payout preference stores an account number | `payoutHandleSchema` | `contracts/src/schemas.test.ts`: `payoutHandleSchema.safeParse("acct 123456789012").success === false`; `"Zelle 503-555-0142".success === true`. |
| 20 | Unreviewed cancellations are never exonerations | `cancellationIncident.fault` | `services/src/cancellation.test.ts`: create an incident, assert `fault === "unattributed"`, and assert the host/hauler reliability read-model counts it as *unreviewed* rather than folding it into a `no_fault` bucket. |
| 21 | Migrator defaults, not zod defaults | all §2–§4 extended fields | `db/src/snapshot.test.ts`: feed a v2-shaped snapshot (no `driverPayCents`, no `kind`, no `acceptedDriverPayCents`, none of the seven collections) and assert every one of those fields/collections is present with the specified default afterward. This is the test that catches the "I added `.default()` to the schema" mistake — `upgradeStateSnapshot` casts, so the zod default never runs. |

---

## 14. Copy sweep that must ship in the same PR as the first host charge

`apps/web/lib/plans.ts` still advertises a Host **"Free launch pilot"**. There is no free host tier (locked decision 6). The `plans.ts` copy change, the pricing page, and the Terms fee section land in the **same PR** as the first `platformFeeEvent` that reaches an invoice — never earlier (advertising a fee with no code path) and never later (charging against copy that promises free).

---

# 5. Adversarial Review — Scheduling Integrity Spec

# Adversarial Review — Scheduling Integrity Spec

Verdict up front: the conflict *algebra* (§6/§7) and the concurrency placement (§8) are the strongest parts of this document and I could not break them. The reliability layer (§9) has a hole big enough to invert its purpose, the buffer resolution (§4) hands the host a lever over the driver's safety margins, and three mutation paths bypass the checker entirely because §8's table only lists *booking* call sites. Findings ordered by severity.

---

## CRITICAL

### C1. The checker guards booking but not mutation — a host can create a conflict by editing
§8's call-site table lists request, approve, claim, slot creation, browse. It does **not** list: editing a load's route, editing a truck slot's `startAt`/`endAt`, editing a landing's coordinates or `slotWindowMinutes`, or the reschedule path implied by `mutual_reschedule` / `releasesSlot`.

**Failure:** Driver holds two legitimately non-overlapping assignments, A at 07:00 and B at 15:00. Host of A edits A's slot to 13:00–21:00 (or swaps A's route to a mill 90 miles further out). §9.1 records a `host_material_change` incident and opens a 24h excuse window — and that is *all* it does. The driver is now double-booked, the system knows it, and no code path re-evaluates. The driver either eats a late cancellation on B (excused only on A) or no-shows one of them. Under the load-series model this is routine: hosts will re-time slots constantly.

**Fix (minimal):** the checker is not a booking-time gate, it is an **invariant on the resource set**. Any mutator that changes `truckSlotId`, `slot.startAt/endAt`, `haulRouteId`, site coordinates, or `slotWindowMinutes` must re-run `checkCandidate` for every active assignment touched, inside the same draft. On conflict the *edit* is rejected with the conflicting assignment named to the editing host (they own one side, so disclosure is fine). Add a negative control: "host re-times slot A into slot B's window → edit rejected, both assignments intact."

### C2. `no_show` has no producer — the reliability layer penalizes the honest and is blind to the harm it exists to prevent
`no_show` appears in `schedulingIncidentKindSchema`, in `schedulingReliability`'s return shape, and in test 36 ("a driver with 20 `no_show` incidents"). Nothing in §9 creates one. There is no sweep rung for "slot start passed, assignment still `accepted`, no trip ever left `assigned`."

**Failure:** Two drivers. One cancels at T-60h with `driver_schedule_conflict` — nothing recorded, correct. One simply doesn't show; the host waits on a landing with a loader idling. The second driver's record is **cleaner** than a driver who cancelled at T-71h. The spec's own justification for never blocking a late cancel ("blocking a cancel converts it into a no-show, which is strictly worse for the host") is an argument that no-shows are the worst outcome — and it is the one outcome the system cannot see. Meanwhile §9.1 reliably records `host_late_cancellation` against the org, so the ledger is asymmetric against hosts.

Secondary: `/host/reliability` will render a no-show counter that is structurally always zero. That is a UI claim with no code path.

**Fix:** add a sweep rung. `slot.startAt + noShowGraceMinutes` (default 120, clamped) passed with assignment status `accepted`/`confirmed` and trip status still `assigned` → `no_show` incident, notify both sides, release the reservation. Grace must be generous and the incident must be *reversible by host attestation* ("driver was here, our loader was late") since the platform has no ground truth. Ship the counter only once the producer exists.

### C3. Fee base and driver pay are mutable after acceptance; the material-change window closes at slot start
Locked decision 9 makes `driverPayCents` host-authored and the fee base. §9.1 makes altering driver pay a material change **only inside 72h of `slot.startAt`**. The window therefore *ends at slot start* — from pickup through delivery, completion, and payment confirmation, the host can edit driver pay with no incident, no notice, no re-acceptance.

**Failure:** Host posts $500. Driver hauls. Host edits to $380 before marking payment sent. The driver's screen now says $380; the "posted-vs-confirmed divergence" detection required by locked decision 9 compares the driver's confirmation against a number that has already moved. Simultaneously the 5% fee base moves from $25 to $19 — the platform under-bills itself and the driver is short $120 with no record that the figure ever was $500. This is both the *stranded-unpaid* path and a *never-billed* path in one edit.

**Fix:** on acceptance, snapshot `agreedDriverPayCents` onto the **assignment** (not the posting) inside the accepting mutation. It is immutable thereafter. Fee base = `agreedDriverPayCents`. Any post-acceptance change is a new offer requiring driver re-acceptance, recorded. Extend the material-change window from "72h before slot start" to "acceptance through billable completion" for the pay field specifically.

### C4. Nothing forbids cancelling a completed assignment — the 5% fee is escapable
§9 defines cancellation from `accepted`/`checked_in`. The trip machine runs to `completed`, and locked decision 8 makes billable completion the fee trigger. No guard states that cancellation is refused once the assignment reaches billable completion.

**Failure:** Host approves, driver hauls, driver confirms receipt of pay, load is billable. Host cancels the assignment with `duplicate_booking_cleanup`. If billing derives from assignment status, the fee evaporates. If billing already fired, the completion record and the invoice now disagree with no reversal record. Either way this is a one-click fee escape available to every host, in a snapshot store with no DB CHECK to stop it.

**Fix:** billable completion is terminal for cancellation. Post-completion unwinding is a *reversal* with its own deterministic id, its own at-most-one assertion, and an explicit fee-reversal record — never a status rewrite. Negative control: "cancel a billable-complete assignment → rejected; reversal path produces exactly one reversal even when called twice."

---

## HIGH

### H1. Buffer overrides let the counterparty relax the driver's own safety check
§4 resolves platform → **company** → site, keyed `{companyId, landingId, millId}`. Every identifier there belongs to the host side. So the host who benefits from packing more loads onto one driver configures `preTripMinutes`, `interAssignmentBufferMinutes`, `runTimeSafetyFactor`, `deadheadAverageMph`, and `roadCircuityFactor` — the five numbers that decide whether that driver is physically able to make the second load. Under decision 3 the host pays 5% per completed load, so tighter packing is also *more* revenue for the platform, which is exactly the incentive alignment you don't want auditing itself.

Worse, §4's stated rationale is false as written: "Clamps are enforced in the zod schema, because every one of these numbers is a way to defeat the conflict check by zeroing it" — yet `preTripMinutes`, `interAssignmentBufferMinutes`, and `deadheadMinimumMinutes` all clamp to a **minimum of 0**. The clamps permit precisely the attack they claim to block. `deadheadAverageMph` max 70 on forest roads is the same lever from the other end.

**Fix:** split the table by whose risk it is. Site-service durations (`landingServiceMinutes`, `millServiceMinutes`) resolve from the site. Driver-protective values (`preTripMinutes`, `interAssignmentBufferMinutes`, `runTimeSafetyFactor`, `deadhead*`, `roadCircuityFactor`) resolve from platform default and the **driver's** profile/org only — a host override is ignored, and there is a test asserting a host override does not change the driver's `requiredGapMinutes`. Set real floors (`preTrip ≥ 15`, `interAssignment ≥ 15`, `deadheadMinimum ≥ 10`) or delete the sentence claiming the clamps prevent zeroing.

### H2. `occupancyEnd` anchored to `S.endAt` is a live capacity cliff on legacy slot data
§3 defends anchoring to `S.endAt` well *in principle*, and the lever ("hosts narrow the window") is the right one. But loads.ts hardcodes a 13:00–21:00Z window today, and PR-B enforces on whatever slots already exist. If existing slots span that full eight-hour window — the spec does not say, and it must — then on the day PR-B deploys, every driver is limited to **one load per day**, platform-wide, with no host action possible on already-created slots.

There is a second silent change stacked on it: §1 backfills `operatingHoursLocal: 06:00–18:00` onto every site, replacing a hardcoded 13:00–21:00Z (= 06:00–14:00 Pacific). That is 12 hours where there were 8 — every site's generated capacity changes on migration, in the same PR that starts enforcing.

**Fix:** answer the question in the spec (what is a slot's duration today?), and if slots are wide, PR-A must include a migration that subdivides legacy slots into `slotWindowMinutes`-length slots before PR-B enforces. Also decouple: the occupancy anchor should be `S.startAt + callInWindowMinutes` where `callInWindowMinutes` defaults to the slot length but is host-settable and clamped — this preserves your pessimism argument while giving hosts a lever that works on slots they've already created.

### H3. `landingServiceMinutes = landing.slotWindowMinutes` double-counts the slot
§3 defines `slotWindowMinutes` as "per-truck service duration at that site." §4 then sets `landingServiceMinutes` to that same field. §2 says slots are generated from `operatingHoursLocal`. If slot length is `slotWindowMinutes` — the natural reading — then `occupancyEnd = S.endAt + landingServiceMinutes` adds the loading time *after* the window in which the loading was supposed to happen. Every occupancy is one service-duration too long, permanently, and no test catches it because every test uses the same wrong constant on both sides.

**Fix:** pick one meaning and name it. Either `slotWindowMinutes` is the slot length and `landingServiceMinutes` is a separate defaulted field, or the occupancy anchor is `S.startAt` (see H2) and `slotWindowMinutes` is the service duration. Add a test that asserts an absolute `occupancyEnd` instant against a hand-computed value, not against a formula re-derived from the same inputs.

### H4. Backfilling `ianaTimeZone: "America/Los_Angeles"` onto every site is a plausible wrong answer
Sites carry coordinates (§5 haversines them). Backfilling every site to Pacific silently mis-times every non-Pacific site by 1–3 hours: a Georgia mill's 06:00 "local" opening generates slots at 09:00 local, and the *display* layer (§2) will confidently render "07:00 PDT" next to a landing in Idaho. This is the E&E absence-is-not-stated lesson exactly — a wrong-but-plausible default is worse than a null, because nothing ever prompts anyone to fix it.

**Fix:** derive from coordinates during backfill where the mapping is unambiguous; otherwise leave `ianaTimeZone` null, block slot *generation* (not reads) for that site, and surface a one-field host prompt. Test: a site with a null zone cannot generate slots and renders no local time string.

### H5. Deleting the availability auto-mint can empty every driver's board
§7 is right that auto-minting erases the signal. But today the auto-mint exists, which means **no driver has maintained availability windows** and there is no reason to think the data is populated. §6 then hardens `availabilityMatchesLoad` to only return `"available"` when a window actually covers the interval. If any browse filter, sort, or match ranking reads `=== "available"` — and the spec itself warns that `!==` comparisons will not be flagged by the compiler — every driver with zero windows disappears from matching on deploy day.

**Fix:** make "the driver has declared nothing at all" a distinct, explicitly-handled state, not the absence of a match. `"unconstrained"` returns as bookable-with-caution and is asserted by a test: *a driver with zero availability windows still appears in matching and can still complete a booking end to end.* Pair the manual `=== "available"` grep with a lint rule, because a grep does not survive the next PR.

### H6. `double_book_blocked` cannot be persisted through a throw
The block path in `requestCapacityWithPolicyInternal` throws (test 11: "throws **and** leaves `remainingTruckloads` unchanged with no assignment row"). A throw discards the draft. The incident written in that draft is discarded with it. `double_book_blocked` is therefore an incident kind that can never exist, and any surface counting it reads zero forever.

**Fix:** the block path returns a structured rejection rather than throwing, the mutator commits the incident and no assignment, and the route maps the rejection to a 409 with the `SchedulingCheck` payload. Test: a blocked request commits exactly one `double_book_blocked` incident *and* zero assignments, in one mutation.

---

## MEDIUM

### M1. `LOCK_IN_HOURS = 72` punishes drivers on short-lead timber loads
§9.4's own TTL ladder concedes that loads get booked at `<12h` lead time. Under a flat 72h rule, a driver who accepts a load 10 hours out and cancels **four minutes later** takes a `late_cancellation`. There is no grace period and no lead-time scaling. Combined with C2 (no-shows invisible), the system's clearest signal is "this driver corrected a mistake promptly."

**Fix:** two clauses. (a) No incident if cancelled within `CANCEL_GRACE_MINUTES` (60) of the assignment being created. (b) `lockInHours = min(72, 0.5 × leadTimeAtAcceptance)`. Tests at both boundaries.

### M2. Deterministic ids collapse repeatable events
`incident:{kind}:{assignmentId}:{relatedAssignmentId ?? "none"}` with an at-most-one assertion is correct for once-per-assignment events (`late_cancellation`, `host_slow_response`). It is wrong for three kinds:

- **`host_material_change`** — a host can change route, then pay, then slot times. Only the first records. The 24h auto-excuse window derives from `occurredAt`, so the second and third changes don't extend the driver's protection. And if the assertion *throws* rather than skipping, the host's second legitimate edit fails outright.
- **`unconfirmed_at_deadline`** — T-72h and T-24h misses collide into one id. Test 35 only exercises T-24h, so it passes either way.
- **`cancel_then_take` / `take_then_cancel`** — the `relatedAssignmentId` saves these; fine.

**Fix:** id includes a discriminator: `…:{changedField}:{occurredAtBucket}` for material change, `…:{deadlineLabel}` for confirmation. State explicitly that the assertion **skips** (idempotent no-op), never throws, since the sweep re-runs on every mutator and every CAS retry.

### M3. Neutral reason codes have undefined `excused`, and `mutual_reschedule` is a false-positive generator
§9.3 keys detection on "reason code is **not excused**." §9.2's classification table declares `side` and `excused` as separate axes but never states `excused` for the three neutral codes. If `mutual_reschedule` is `excused: false`, then the completely normal flow — host and driver agree to move a load, driver fills the freed window with other work — produces a `cancel_then_take` incident naming both. Same for `platform_error`.

**Fix:** the table must carry an explicit `excused` value for all sixteen codes, with a table-driven test asserting one row per code (enumerated coverage, not a spot check). Neutral ⇒ `excused: true` for detection purposes.

### M4. Test 39 passes under both readings of the rate denominator
"Rate denominator = accepted assignments whose slot start fell in the window" leaves open whether a *subsequently cancelled* assignment stays in the denominator. If it doesn't, a driver with 5 accepted who cancels 2 scores 2/3 = 67% instead of 2/5 = 40% — the cancellation is counted twice, once in the numerator and once by shrinking the denominator. Test 39 (40/2 vs 4/2) yields 5%/50% under one reading and 5.3%/100% under the other; the assertion "lower than" holds either way. It is not a control.

**Fix:** state "ever-accepted, including subsequently cancelled." Replace test 39 with an exact-value assertion.

### M5. `confirmationState` is a collision waiting to happen
Locked decision 4 puts payment confirmation (driver-only "received") on the same object graph; delivery acceptance already owns the phrase "confirmed by the host." §9.5 handles the *copy* correctly but names the field `confirmationState` — the most generic possible name — on the assignment, and never defines who sets `"not_required"` or when.

**Fix:** rename `scheduleConfirmationState`, define the `"not_required"` producer (or delete the member), and extend the §10 guardrail test beyond `suspend|penalt|ban`: no scheduling surface may render a bare "Confirmed" / "Confirm" without a qualifier, and no payment surface may read `scheduleConfirmationState`.

### M6. Host-response deadline can outlive the slot
§9.4 tightens direct offers to `expiresAt < slot.startAt`. §9.5 gives the host-response deadline a **2h floor** with no such ceiling. A driver requests a load 90 minutes out; the request expires 30 minutes *after* the slot started, and nothing forbids the host approving it at T+20. The driver is now assigned to a load that began without them, and it counts toward `acceptedInWindow`.

**Fix:** `responseDeadline = min(24h, max(2h, 0.25 × leadTime), slot.startAt - approvalCutoffMinutes)`. Approval is refused once `now > slot.startAt - approvalCutoffMinutes`. This is the same guard §9.4 already got right for offers; make it symmetric.

### M7. `reservedCount` is an unbacked integer with four writers
Claim, cancel, offer-expiry sweep, and request-expiry sweep all decrement or increment it, in a store with no unique index and no CHECK. Test 27 covers one double-decrement path. Under CAS retries and a sweep that now runs at the top of every mutator, that is not enough surface.

**Fix:** derive it, or — if it must stay stored — assert the invariant `reservedCount === count(active assignments on slot)` at the end of every mutator that touches a slot, with a test that fails if the assertion is removed. Same discipline the money path uses, for the same reason.

### M8. The sweep must live inside `mutateState`, not at the top of each mutator
§8 says "called at the top of every `mutateState` mutator in `apps/web/lib/services.ts`." That is a convention, not a guard: the next mutator anyone adds silently skips the sweep, and any service in `packages/services` that calls `mutateState` directly never sweeps at all. Also unstated: `at` must be captured **once per request and passed in**, or a CAS retry re-sweeps against a moved clock and can straddle a deadline boundary mid-transaction. And notifications emitted during a mutator that later loses the CAS race will have already been sent.

**Fix:** put the sweep inside the `mutateState` wrapper itself; add a guardrail test that greps for snapshot writes bypassing it. Make `at` a required parameter. Queue notifications into the draft and flush after commit.

---

## LOW

### L1. Test 13 is not a test
"Deleting the inline block at `operating-network.ts:2889-2907` leaves the direct-offer test passing" describes a manual mutation experiment, and after PR-B that block does not exist to delete. Replace with a behavioural control only the shared checker can satisfy: a direct-offer claim that conflicts on the **trailer** dimension (which the old inline check never computed) is rejected.

### L2. Cross-org disclosure still leaks
"Committed elsewhere 06:30–15:10 PDT" tells a competing host that this driver is working, for how long, and — in a market with a handful of mills — roughly where. Coarsen to a day-level label for cross-org viewers, or make precise times opt-in per driver.

### L3. Excused counters on a host-facing page are a penalty by another name
§9.2 says "Excused ≠ invisible… A counter, not a penalty." If `excusedCancellations` and `cancelThenTakes` render on `/host/reliability` beside an approve button, they are a penalty, and `cancel_then_take` is a heuristic with acknowledged false-positive modes (M3) shipping with zero measured precision. A driver whose truck broke down twice this quarter will be quietly declined.

**Fix:** at MVP, hosts see completion rate, on-time rate, and `lateCancellations` only. `excusedCancellations`, `cancelThenTakes`, and `takeThenCancels` are visible to the driver themselves and to admins. Revisit once the false-positive rate is measured.

### L4. Fee keying, stated so the next PR can't get it wrong
Re-scoping `:748-753` from posting to slot correctly makes the slot the unit of work — which makes the slot the tempting billing key. It must not be: a slot that is booked, cancelled, rebooked, and completed must bill **once**, keyed on the completed assignment id. Worth one sentence here so PR-C/the billing PR inherits it.

---

## Sound — no change needed

- **§6, the overlap test.** Order-free, boundary-correct, subsumes literal overlap, and the "neither can follow the other" formulation is genuinely hard to get wrong. Test 8's symmetry sweep is the right control.
- **§7, dimension independence.** Driver / truck / trailer checked separately with `null` claiming nothing is the correct shape, and it does make multi-vehicle drivers and multi-driver trucks fall out for free. Tests 1–3 are real negative controls.
- **§8, the check inside the same `mutateState` draft.** This is the single most important correctness decision in the document and it is right — under CAS, a pre-mutation check lets two concurrent requests both pass, and the retry semantics make an in-draft check self-healing. (See M8 for where it's installed, not whether.)
- **§2, all arithmetic on UTC instants, `slotDate` never compared.** Correct, and the explicit spring-forward/fall-back rules stated rather than discovered is exactly right. Rendering pickup in the landing's zone and delivery in the mill's is a real operational fix, not polish.
- **§9.1, never blocking a late cancellation.** The reasoning is correct and it is the humane answer.
- **§1, legacy cancelled rows → `legacy_unclassified`, never inferred from free text.** Right call, and the reason is right.
- **§9.7 + test 36.** Implementing every rung with injected thresholds and proving-by-test that the shipped policy is all-null is the correct shape for a shipped-off feature, and test 36 is a genuine control rather than a restatement.
- **Test 30** (breakdown + unrelated work later ⇒ no incident) and **test 17** (annotation ⟺ gate over generated pairs) are the two best tests in the document.
- **Non-custodial:** nothing in this spec creates a balance, a hold on funds, an escrow, or a fee deduction from driver pay. The money exposure here is C3/C4 — a mutable and escapable *fee base* — not custody.

---

## Sequencing consequence

C1, C2, H2, and H5 change what PR-B can safely be. As written, PR-B ships enforcement + auto-mint deletion + the `S.endAt` anchor onto un-migrated slot data, on a repo where `main` auto-deploys to production, with `conflictCheck: "enforce"` as the one high-blast-radius switch that has **no off rung** in `DEFAULT_SCHEDULING_POLICY`. Give it one: `conflictCheck: "warn" | "enforce"`, ship `"warn"` for one deploy alongside the picker, read the annotation-vs-would-have-blocked counts off real traffic, then flip in a one-line PR. The ladder already establishes the pattern; the highest-risk gate is the one currently exempt from it.

---

# 6. Adversarial review — Permissions & Vocabulary spec

# Adversarial review — Permissions & Vocabulary spec

Grounded against the repo at `/home/jackson/automatedempires/ventures/logloads`. Verified claims carry file:line.

---

## Critical — money and stranded drivers

### C1. The lapse bills a fee on a haul where the driver was never paid, and the driver's only remedy is explicitly refused
**Scenario.** Host accepts delivery. Host never marks payment sent, never pays. Driver tries to open a payment dispute → §2.7(b) refuses: *"Refuse a payment dispute before the payment record exists (`status === "pending"`)."* Day 30 arrives. §3.3 `confirmation_lapsed` fires ("payment neither confirmed nor disputed" — `pending` is neither), `feeBaseCents = driverPayCents`, LogLoads invoices the host 5% of money that never moved. The driver is unpaid, has no dispute record, and the product's only artifact says the load completed billably.

The stated rationale is inverted too: the lapse is justified as closing "the fee-avoidance hole where a host asks a driver to stay quiet" — but the same silence is indistinguishable from non-payment, and the design refuses the one signal that would tell them apart.

**Severity:** critical. It converts the flagship honesty feature into a fee on a stiffed driver.
**Minimal fix:** (a) allow a payment dispute from `pending` once `trip.completionStatus === "confirmed"` and the host's stated payment window has elapsed — the "unpaid haul" case is the *most* important dispute, not an excluded one; (b) split the lapse into two reasons: `confirmation_lapsed` (sent, unconfirmed, 30 days) is billable; `never_marked_sent` (30 days, never sent) is **not** billable and raises a host-side non-payment flag.

### C2. `disputed` is an absorbing state — no resolution transition exists anywhere in the spec
**Scenario.** Host marks sent, fat-fingers `$50` instead of `$500`. Driver disputes. Host now sends the real $500. §2.5 refuses `markHaulPaymentSent` because status is `disputed`. §2.6 lets the *driver* confirm from `disputed` — but if the driver has quit, changed phone, or simply stopped opening the app, there is no other exit. §3.3 says "a payment dispute freezes fee minting for that haul until it resolves," and no service, action, or state transition named in this document resolves it. `adjust_fee_ledger` credits an invoice — it does not close a haul payment.

The fee is frozen forever (never billed), and the record never closes.
**Severity:** critical (deadlock + permanent revenue leak).
**Minimal fix:** add `resolveHaulPaymentDispute` with an explicit outcome enum (`paid_as_recorded`, `amount_corrected`, `withdrawn`), payee-only or bilateral-agreement authority, plus a lapse timer on `disputed` itself. Every non-terminal money state needs a documented exit; enumerate them and assert reachability in a test.

### C3. Direct offers bypass slots, driver pay, and every disclosure
`directOfferSchema` (`packages/contracts/src/production-network.ts:499-511`) has **no pay field at all** — only `offeredTruckloads` and `termsSnapshot: z.record(z.unknown())` — and binds to `loadPostingId`, not a slot. `claimDirectOffer` mints an assignment directly.

**Scenario.** Host sends a direct offer on a 6-load series. Driver claims it. No `driverPayCents` exists to copy onto the assignment (§2.4), so D1–D6 render nothing or render `{pay}` as undefined, the driver accepts a haul with no stated pay, `feeBaseCents` is 0 or NaN, and the per-slot at-most-one assertion (`assignment:${loadSlotId}`) is never reached because there is no slot. Three of the doc's guarantees fail on one path the doc never mentions except in passing.
**Severity:** critical (unpriced hauls + fee leak + the honesty promise silently absent).
**Minimal fix:** direct offers must target a `loadSlotId` and carry a typed `driverPayCents`; refuse a claim on any offer without both; route claims through `fillLoadSlot` so they hit the same assertion. Explicitly ban pay in `termsSnapshot` — the schema's own comment at `schemas.ts:305-309` already makes this argument for `directOfferId`.

### C4. `assignment:${loadSlotId}` silently degenerates to `"assignment:undefined"`
`assignmentSchema.truckSlotId` is required and non-nullable (`packages/contracts/src/schemas.ts:311`); `loadSlotId` must be a new field, and the snapshot migrator **casts rather than parses**, so every pre-existing assignment row arrives with `loadSlotId === undefined`. The deterministic id template interpolates to the literal string `assignment:undefined` for all of them — and for every direct-offer assignment (C3).

Depending on which side of the assertion you land, this either (a) makes the second legacy assignment unbookable forever, or (b) collides distinct records into one key. Either way the document's stated *entire* double-booking defence is void on exactly the rows it can't see.
**Severity:** critical.
**Minimal fix:** never build a key from a possibly-undefined value. Compute the key only when `loadSlotId` is a non-empty string; refuse any booking or money operation on an assignment lacking one; add a backfill in `upgradeStateSnapshot` that binds every legacy assignment to a synthesized single-slot series. Test: a snapshot containing one legacy assignment must not permit a second insert under the same key.

### C5. The payee is resolved live at confirm time, and nothing gates who writes payout preferences
§1.4 reads `driverPayoutPreferences[haulPayment.driverProfileId]` at confirmation. §1.1 defines **no action** for creating or editing that preference, and no service-level rule appears in §2.

**Scenario.** Carrier admin edits the driver's payout preference to `payeeType: "organization", payeeOrganizationId: <own org>`. Now §1.4's organization branch is satisfied by the carrier owner, who confirms receipt. The driver never saw the money, cannot object, and the record says "payment confirmed." The doc's own load-bearing guard has been walked around without touching a single gate it names.

Note the doc already invented the right pattern for exactly this class of problem — §2.4 *copies* `driverPayCents` onto the assignment so "downstream money reads the assignment copy, never the live series" — and then fails to apply it to the payee.
**Severity:** critical.
**Minimal fix:** (a) snapshot `payeeType`, `payeeOrganizationId`, `payeeUserId` onto the `haulPayment` at creation/mark-sent; §1.4 asserts against the snapshot, not the live preference. (b) Only the driver's own `userId` may create or modify their payout preference; a preference change while any payment is `sent` or `disputed` does not retroactively rebind. (c) Test: flipping the preference after mark-sent must not change who may confirm.

### C6. A missing payout preference throws, then bills anyway
§1.4's pseudocode has no branch for `preference === undefined` — it dereferences `preference.payeeType`. Nothing in §2.4 requires a payout preference before a host may accept a driver onto a slot.

**Scenario.** Driver with no payout details accepts a slot, hauls, host marks sent. Every confirm attempt 500s on an undefined deref. Nobody can confirm. Day 30, `confirmation_lapsed` bills the host for a payment the system was structurally incapable of recording.
**Severity:** high.
**Minimal fix:** refuse slot request/acceptance when the driver has no payout preference (D4 already promises the host will pay "to the payout details {payee} provided" — that's a UI claim with no enforced backing); and `assertPayeeMayConfirm` refuses explicitly on a missing preference rather than throwing.

### C7. Breakdown, TONU, and cancel-at-the-landing leave the driver unpayable *on the record*
§2.5 refuses `markHaulPaymentSent` unless `trip.completionStatus === "confirmed"`.

**Scenario A.** Truck throws a driveline at `loading`. Trip never reaches completion. The host wants to pay the driver $150 for the deadhead and the day. There is no path: no completion record → no payment record → §2.7(b) refuses a dispute because no record exists. The driver's legitimate mechanical failure produces a cancellation with a reason string and nothing else.
**Scenario B.** Host cancels at 05:00 after the driver has driven 90 miles. Same dead end — kill fee / TONU is unrecordable.

This is precisely the "punishes a driver for a legitimate breakdown" case. It also quietly suits LogLoads: no completion, no fee, so there is no incentive pressure to fix it.
**Severity:** high.
**Minimal fix:** allow a `haulPayment` on a terminal *non-completed* assignment when the host records a `partial_haul` / `not_used` reason with a stated amount. It is non-billable (no fee), it is disputable, and it is visible to the driver. Cheap to add now; impossible to retrofit once hosts have learned to settle these off-platform.

---

## High — billing correctness

### H1. The monthly minimum is defined two contradictory ways in one document
§3.2 vocabulary: *"The least you pay LogLoads in a month, whatever your load count"* — a **floor**, `max(fees, 4900)`.
§3.2 invoice row: *"What LogLoads charges you this month: platform fees plus any minimum"* — **additive**, `fees + 4900`.

On a host with $500 of fees that is a $49 discrepancy every month, in the direction that favours LogLoads, in the section whose entire purpose is one term per concept.
**Severity:** high. **Fix:** state the arithmetic as a formula, not prose: `invoiceTotalCents = max(sum(feeLines), monthlyMinimumCents)`, with a test at fees below, equal to, and above the minimum.

### H2. The minimum is unreconciled with the existing Stripe subscription
The repo already has Stripe **subscription** billing + entitlements. §3.2 bans calling the minimum "subscription (reserved for the existing Stripe subscription)" — which concedes two ~$49-shaped monthly charges coexist and then declines to say how. Nothing in the doc says whether the minimum replaces the plan price, offsets it, or stacks on it.
**Severity:** high (double-charging hosts is the failure mode; it also collides with §5 item 1, replacing the "Free launch pilot" line).
**Fix:** one sentence naming which construct is the host's monthly charge and what the other becomes. If the subscription *is* the minimum, say so and make the fee ledger credit against it.

### H3. `confirmation_lapsed` has no minting trigger
There is no cron in this repo (no `vercel.json` cron entries; `apps/web/app/api` has no scheduled route). The established pattern for time-based transitions is **lazy-on-read without a write** — `operating-network.ts:352` computes `expired` at read time and never persists it.

So either (a) nobody ever mints the lapsed fee lines and they are never billed, or (b) minting happens during a read, which under a single CAS snapshot row means a driver opening a page writes a host's fee line, or (c) it is computed at invoice-render time — in which case a driver confirming on day 40 changes a base the doc calls immutable.
**Severity:** high (never-billed, or an unspecified write-on-read).
**Fix:** name the trigger. A single idempotent `sweepBillableCompletions` invoked from an authenticated admin/cron route, minting under the deterministic per-trip id, is the minimal answer.

### H4. Two billable reasons, one fee line, no precedence rule
Day 30: `confirmation_lapsed` mints at `feeBaseCents = driverPayCents`. Day 40: the driver confirms `amountReceivedCents = 40000` on a `50000` load. §3.3's `payment_confirmed` reason now computes `min(...) = 40000`. §5 says the deterministic id is "fee line per trip".

If the id is per-trip, the second mint is refused and the host is billed on the wrong base with no correction path. If the id includes the reason, the trip is billed **twice**. The doc does not say which.
**Severity:** high. **Fix:** one fee line per trip, keyed `feeLine:${tripId}`; a later confirmation does not mint a second line — it emits an `adjust_fee_ledger` credit for the delta with `linkedDisputeId`/`linkedTripId`. Test both orderings.

### H5. `feeBaseCents = min(driverPayCents, amountReceivedCents)` pays hosts to short-pay
A host that pays $400 on a $500 posted load owes 5% of $400, not $500. Divergence is flagged (decision 9 satisfied, technically) with no consequence anywhere. The fee formula is the only lever LogLoads controls, and it currently rewards the behaviour the divergence flag exists to detect.
**Severity:** medium-high. **Fix:** `feeBaseCents = driverPayCents` always (the host authored it; it is the fee base per decision 9), with divergence recorded and, on a resolved dispute that lowers the agreed figure, a credit. Never let the host reduce its own fee by paying the driver less.

---

## Medium — bypasses, conflations, capability-without-code

### M1. Drivers will see two different pay numbers, and the rate-card one isn't in the ship list
`apps/web/lib/network.ts:891` builds a driver-facing `payLabel: formatRateLabel(rate.baseRate, rate.rateType)`, plus `+ $x fuel` at :871; `apps/web/lib/host-data.ts:133,253` do the same. That is the rate card rendered as pay — the exact thing §3.2 bans ("rate, load rate, ... per-ton, per-mile" under driver pay). §5's same-PR list does **not** include migrating these.

Post-PR a driver sees "$38.00 per ton + $12.00 fuel" on the opportunity card and "$500" on the slot. **Severity:** medium-high (directly defeats decision 2). **Fix:** add `network.ts:891` / `host-data.ts:133,253` to the §5 list; `payLabel` reads the slot's `driverPayCents` or renders nothing.

### M2. R-DEMO is an app-layer gate in a document whose doctrine is "gates live in services"
`apps/web/lib/demo-mode.ts` exists; there are **zero** `demo` references anywhere in `packages/services/src`. Every refusal table in §2 lists R-DEMO, and R-DEMO as sourced lives outside the service boundary — the same mistake §2's preamble forbids ("API routes bypass the UI, so no gate may live in a component or a server action").
**Severity:** medium. **Fix:** a demo flag on the actor context, asserted inside `haul-payment.ts` / `platform-fees.ts`, with a test calling the service directly.

### M3. The vocabulary lint cannot see the most dangerous copy in the product
§3's scan globs are `apps/web/**/*.tsx`, `apps/web/lib/**/*.ts`, `packages/ui/**`. The disclosure module the doc mandates lives at `packages/contracts/src/payment-disclosures.ts` — **not scanned**. Neither is `packages/services/**`, so a service error message reading "insufficient wallet balance" ships clean, as does any banned fee synonym in a contract-level label.
**Severity:** medium (a guardrail with a hole where the risk is concentrated). **Fix:** add `packages/contracts/**` and `packages/services/**` to the scan; allowlist the two legitimate `subscription` uses rather than exempting whole packages.

### M4. `slotWindowMinutes` is a duration, not operating hours
Verified: `packages/contracts/src/schemas.ts:182` `z.number().int().positive()`; `packages/services/src/host-workspace.ts:45` `.max(480)`; seeds are `30, 20, 15, 20` (`packages/db/src/seed-data.ts:546,569,595,618`). It is the **length of a slot**, not a window of the day.

§2.1 refuses "slot windows that fall outside the landing's `slotWindowMinutes` operating window" and §5 deletes the hard-coded 13:00–21:00Z. After that PR there is **no operating-hours data on a landing at all** — the refusal is unimplementable and the replacement is a capability with no field.
**Severity:** medium. **Fix:** add `operatingWindowStartMinute` / `operatingWindowEndMinute` (+ timezone) to the landing in the same PR, and keep `slotWindowMinutes` as the slot duration it is. Do not delete the constant until the field exists and is populated.

### M5. `publish_load` has silently become a money-authoring permission
§1.1 deliberately reuses `publish_load` for series, and §2.1 makes `driverPayCents` a required publish field. `publish_load` is held by **dispatcher** and **landing_manager** (`permissions.ts:64-91`). So a dispatcher and a woods foreman can now author the figure that (a) a driver relies on and (b) LogLoads bills the host 5% of — while holding no `view_fee_ledger` and therefore unable to see the charges they generate. This directly contradicts the doc's own rationale ("Everything touching cents stays with `owner`, `admin`, `billing`") and the existing code comment at `permissions.ts:58-60`.
**Severity:** medium. **Fix:** either add `set_driver_pay` (owner/admin only; dispatcher publishes with pay inherited or blank-and-unpublishable), or state explicitly that reuse extends money authority to two operating roles and update the comment at `permissions.ts:58-60` so the file stops asserting something false.

### M6. The extracted conflict check is driver-scoped; the resource model is equipment-scoped
§2.3 specifies `assertNoScheduleConflict(state, driverProfileId, window)`. But `futureAvailabilitySchema` is keyed on `organizationId` + `equipmentCombinationId` (`production-network.ts:513-524`), and `assignmentSchema` carries `truckProfileId` and `trailerProfileId` (`schemas.ts:313-314`). A driver-only check lets a carrier book **two different drivers onto the same truck** for overlapping windows — a new double-booking hole opened by the fix for another one. Conversely, org-scoped availability means one availability window either blocks four legitimate drivers or the check is vacuous.
**Severity:** medium. **Fix:** the conflict predicate takes both `driverProfileId` and `truckProfileId` (and trailer, if set) and asserts non-overlap on each independently. Say which resource availability windows belong to.

### M7. §2.5's idempotency claim contradicts its own refusal, and there is no partial-payment model
"Refuse when the payment record is already `sent`" and "re-posting is idempotent, not additive" cannot both be true — refusing a retry returns an error to a host who reasonably believes the first call failed. Separately, one `amountSentCents` per assignment means a host paying half on Friday and half on the 15th cannot record it: the driver confirms less than posted, `divergence: true` fires falsely, and under H5's `min()` the fee is under-collected.
**Severity:** medium. **Fix:** an identical repost (same amount, same payee) returns the existing record with 200; a *different* amount is refused. Decide explicitly whether instalments are in scope for Phase 0 and say so.

### M8. Series arithmetic and landing overlap refuse legitimate timber operations
- `slotsPerDay × dayCount !== seriesSize → refuse` forbids 5 loads over 2 days at 3 then 2. Validate `slots.length === seriesSize` and `perDay ≤ slotsPerDay`.
- "Two slots on the same series whose windows overlap for the same landing → refuse" forbids a landing with two loaders running trucks simultaneously — common. There is no landing concurrency field; add one (`concurrentTruckCapacity`, default 1) and refuse only above it.

**Severity:** medium (usability, but the first thing a real host will hit).

### M9. D3's `{terms}` and D4's host-side `{method}` are UI claims with no code path
`{terms}` ("the host's stated payment window") appears in D3 for both sides and in the C1 fix above — and **no field anywhere in §1.5's new collections holds it**, and §2.1 does not require it at publish. It renders empty or invented.

D4's host copy renders `{method}` and "the payout details {payee} provided" — the host must read the payee's payout details, which is a cross-organization read with **no action defined** (`view_payout_details` doesn't exist) and which §2's R-CROSSORG would refuse as not-found by default. The doc's own convention blocks the disclosure the doc mandates.
**Severity:** medium. **Fix:** add `hostPaymentTermsDays` to the series, required at publish (it is load-bearing for C1's non-payment timer); add an explicit narrow read grant for the host to see the bound payee's method label on assignments it owns, and nothing else.

### M10. CAS retry semantics are unstated, and the guards depend on them
Every at-most-one assertion is correct only if, on a CAS version conflict, the service **re-reads the snapshot and re-runs the assertion**. If a retry replays a precomputed patch — or if the deterministic id and the "does it already exist" check are computed before the read that the write is versioned against — both concurrent callers pass the guard and both writes land in sequence.

Separately: fee minting must occur in the **same** CAS write as the transition that makes the haul billable. If it is a second call, a crash between them loses the fee with no reconciliation job (compounding H3).
**Severity:** medium. **Fix:** state both as required properties, with a test that simulates a version conflict and asserts the guard re-evaluates against the fresh snapshot.

### M11. The §3.4 lint rule is both evadable and self-firing
"`payment` may never appear within 40 characters of `accepted`" — D3's own driver copy reads *"{host} states payment {terms} after they accept delivery"*, which passes only because it says `accept`, not `accepted`. Broaden the stem and the rule fires on the disclosure module itself (which, per M3, isn't even scanned). A proximity regex is the wrong instrument here.
**Severity:** low-medium. **Fix:** keep the exact-string ban on `confirmed by the host` (that one is precise and valuable). Replace the proximity rule with a lint on *badge and status labels only* — a whitelist of permitted status strings per field — which is checkable and not evadable by inflection.

---

## Low

- **L1. `cancellationReason` enum is unspecified** and today the field is a free `z.string().optional().nullable()` (`schemas.ts:320`). It must include `equipment_failure`, `weather_hold`, `road_closure`, and any future reliability or ranking signal must exclude them by construction. A breakdown must not be recorded in the same bucket as a no-show.
- **L2. Deleting the auto-minted availability window** (`cockpit-actions.ts:110-117`) is right, and a driver availability path does exist (`apps/web/app/driver/profile/page.tsx`, `apps/web/app/api/availability/route.ts`) — so this is safe, provided the refusal message names that screen and existing drivers who have never set a window get a backfill or an onboarding prompt in the same PR. Otherwise every driver's first booking after deploy is a bare 400.
- **L3. Ban money in `termsSnapshot`.** Both `assignmentSchema` and `directOfferSchema` carry `termsSnapshot: z.record(z.unknown())`. Untyped, invisible to the field-whitelist serializer of §2.9 and to every lint. The codebase already argues this case for you at `schemas.ts:305-309`; make it a rule.
- **L4. §1.4's driver branch strands the record when a driver leaves.** `payeeType === "driver"` requires that exact `userId` forever. A driver who quits the carrier or loses their login can never confirm. Acceptable if C1's split lapse exists; otherwise it becomes a silent path to billing the host on an unconfirmable record.

---

## What is sound

- **The non-custodial line holds.** No wallet, escrow, balance, or transfer appears anywhere in the design; §2.9's "refuse any adjustment whose target is a driver payment record" and "refuse an adjustment that would drive the invoice total below zero" are the two right constraints, and the banned-word list in §3.2 is correctly scoped to custody implications rather than tone. Nothing in this spec puts LogLoads between the host and the driver's money, and nothing deducts the fee from driver pay (the §2.9 driver-serializer whitelist plus its negative-key test is the correct enforcement of decision 3 — keep the test, it is the kind that fails loudly when someone widens a serializer).
- **§1.2 footnote 2 is verified.** `organizationTypeForPath` (`packages/services/src/accounts.ts:138-147`) derives org type from a closed signup path enum (`host → landing_source`, `fleet → fleet`, else `carrier`), `INVITABLE_ROLES_BY_ORGANIZATION_TYPE.platform` is `[]` (`permissions.ts:117`), and I found no mutation path for `organization.type`. No customer can self-declare a platform org, so `adjust_fee_ledger` is genuinely unreachable for them. Still assert the org type in the service as specified — the role check alone grants it to every owner via the `ORGANIZATION_ACTIONS` spread.
- **§1.4's two unconditional lines** (`actor.organizationId !== hostOrganizationId`, `actor.organization.type !== "platform"`) with mandatory delete-the-line tests are exactly the right shape, and the "necessary but not sufficient" framing is the correct answer to the employee-driver case. The weakness is where the payee comes from (C5), not the assertion.
- **§3.4's lexical firewall** is the strongest part of the document. Two events, opposite parties, different verbs, different badges, and a hard rename of `confirmed by the host` before any payment UI ships — that is the right call and the right sequencing. Only the lint mechanism (M11) needs replacing, not the rule.
- **R-CROSSORG as not-found rather than forbidden**, matching `operating-network.ts:1326`, is correct and consistently applied.
- **Re-scoping one-assignment-per-driver from per-posting to per-slot** (`operating-network.ts:748-753`) is correctly identified as a blocking prerequisite; without it a series is bookable exactly once. Good catch by the author.

---

## The five I would gate the PR on

1. C1 — split the lapse; never bill a load the host never claimed to pay for, and let the unpaid driver dispute.
2. C2 — give `disputed` an exit.
3. C4 — never interpolate a possibly-undefined id into an at-most-one key.
4. C5 — snapshot the payee onto the payment; gate payout-preference writes to the driver.
5. H1/H2 — one formula for the invoice total, and one sentence reconciling the minimum with the existing subscription.

---

# 7. Adversarial review — LogLoads Marketplace Data Model Specification

# Adversarial review — LogLoads Marketplace Data Model Specification

Verified against `/home/jackson/automatedempires/ventures/logloads` at the paths cited. Findings are ordered by severity, not by section.

---

## CRITICAL

### C1. The schema-version bump to 3 is a one-way door that turns any rollback into a total production outage

**§0 is factually wrong about what the bump costs.** It claims "the version bump is a marker only — the `??= []` guards remain the actual rollback-safe mechanism, because `upgradeStateSnapshot` spreads `{...value}`." The spread reasoning is correct. The version reasoning is not.

`packages/db/src/snapshot.ts`, `parseRemoteRow`:

```ts
if (
  !state ||
  !Number.isSafeInteger(schemaVersion) ||
  schemaVersion < 1 ||
  schemaVersion > OPERATING_STATE_SCHEMA_VERSION ||   // <-- here
  ...
) {
  return null
}
```

and `updateRemoteOperatingState` stamps `schema_version: OPERATING_STATE_SCHEMA_VERSION` on **every PATCH**, unconditionally.

**Failure scenario.** Merge the billing PR → main auto-deploys → the first mutation of any kind (a driver checking in, a message, anything) rewrites the row with `schema_version: 3`. Something else in the release turns out to be broken and you roll back to the previous deploy. Old code has `OPERATING_STATE_SCHEMA_VERSION = 2`, so `parseRemoteRow` returns `null`, `loadRemoteOperatingState` throws `OperatingStateUnavailableError("Canonical operating state is invalid")`, and **every request in the application fails** — reads included. There is no downgrade path in the code. Recovery requires a manual `UPDATE operating_state SET schema_version = 2` against production Supabase.

The same fires during the rolling-deploy window: Vercel does not cut over atomically, so the first new-code write kills every still-warm old-code lambda.

**And the bump buys nothing.** The stated rationale — "an operator must be able to read the persisted snapshot and tell whether it predates billing" — is already answered by whether `platformFeeEvents` exists as a key.

**Severity: critical.** **Minimal fix:** do not bump. If you insist on a version marker, it must be a two-release sequence: (1) ship a release that widens the read ceiling — accept `schemaVersion > OPERATING_STATE_SCHEMA_VERSION` when `REQUIRED_TABLES` all validate, since the migrator already handles the additive case — let it reach 100%, *then* (2) bump in a later PR. Add a test that a snapshot at `CURRENT + 1` still loads.

---

### C2. `shared_window` is a permanent, un-closable fee-evasion channel

§3 makes `shared_window` slots **never billable**, and correctly refuses to rewrite legacy rows. But nothing anywhere in the spec forbids **minting new** `shared_window` slots. `truckSlotSchema.kind` has no `.default()`, so `kind` is an explicit caller-supplied field on every create.

**Failure scenario.** Host publishes a posting with `driverPayCents: 50_000` (satisfying the publication gate), then creates their capacity as `kind: "shared_window", capacity: 6` instead of six `series_unit` slots — through the API, or through any UI surface that hasn't been converted. Drivers book them, haul them, get paid off-platform. `billableCompletionAt` returns `null` on every one. The host runs their entire operation on LogLoads and pays $0 in per-load fees, forever, with no anomaly to detect because the loads look normal.

This is the cleanest revenue hole in the design and it is created by the discriminator that otherwise solves the legacy problem correctly.

**Severity: critical.** **Minimal fix:** `shared_window` becomes un-mintable. The create path (service, not route) asserts `kind === "series_unit"`; the only producer of `shared_window` is `upgradeStateSnapshot`. Test: `createTruckSlot({kind: "shared_window"})` throws, and the migrator still produces `shared_window` for a legacy row.

---

### C3. `POST /api/truck-slots` is worse than "no org check" — and this design makes it a money-write

The spec's §3.1 says the route "has no org check, no permission check." It has *an* org check, and that's the problem:

`apps/web/app/api/truck-slots/route.ts`:
```ts
const payload = await request.json()
await requireApiActor(payload.organizationId)
const slot = await mutateState((draft) => draft.createTruckSlot(payload))
```

`requireApiActor` validates that the caller is a member of **the organization the caller names in the body**. It never checks that `payload.loadPostingId` / `payload.landingId` belongs to that org. `createTruckSlot` (`packages/services/src/truck-slots.ts:20-34`) parses the input and pushes — no ownership assertion, no permission assertion, no capacity update.

**Failure scenario.** Any authenticated user of any org posts `{organizationId: <their own org>, loadPostingId: <a competitor's posting>, kind: "series_unit", driverPayCents: 100_000_000, capacity: 1, ...}`. They pass the actor check, they write a $1,000,000 driver-pay figure onto someone else's load, and a driver reads it as a real offer. Or they mint `shared_window` slots on their *own* posting per C2. Or they mint 500 slots to blow up the snapshot.

The spec correctly calls this a launch blocker but understates it: fixing "add an org check" is not enough, because an org check already exists and is being satisfied.

**Severity: critical.** **Minimal fix:** derive the organization from `loadPostingId → companyId` inside the service and assert the actor is a member of *that* org with `publish_load`; ignore `payload.organizationId` entirely. Test the refusal (member of org A creating a slot on org B's posting throws), not only the happy path.

---

### C4. The driver cannot record payment until the host says they sent it — deadlock, unpaid and unbilled

§7.1: "Legal transitions: `awaiting_payment → marked_sent → receipt_confirmed | receipt_disputed`."

**Failure scenario.** Host hands the driver a cheque at the landing, or Zelles them from their phone, and never touches the LogLoads app again. The `haulPayment` sits in `awaiting_payment`. The driver — who *was* paid, in full, and wants to say so — has no legal transition available. Only the host can move it to `marked_sent`. The record permanently says the driver was not paid, the driver cannot dispute (dispute is also only reachable from `marked_sent` under the stated transitions), and `billableCompletionAt` returns `null` so LogLoads earns nothing on a load that completed and was paid correctly.

Worse in the adversarial reading: **not pressing "sent" is a free-load button.** A host who never marks sent is never billed, and the driver's only recourse is a state the model does not offer them.

This also breaks the design's own stated principle — "ONLY the driver may mark 'received'" — by making the driver's word conditional on the host speaking first.

**Severity: critical.** **Minimal fix:** add `awaiting_payment → receipt_confirmed` and `awaiting_payment → receipt_disputed`, both driver-only. The driver's account is independently authoritative; `markedSentAt` staying null while `receiptConfirmedAt` is set is a fact worth recording, not a contradiction. Test both edges.

---

### C5. The host holds the only key to the entire money lifecycle, with no timeout and no escalation

Verified in `packages/services/src/haul-completion.ts`:
- `applyHaulCompletionConfirmation` asserts `trip.completionStatus === "submitted"` (line 201) and is host-driven.
- There is no auto-confirm, no expiry, no platform override, no timeout anywhere in the file.
- `applyHaulCompletionDispute` also only accepts `submitted`, and dispute is not terminal — the host can dispute indefinitely, driver resubmits, host disputes again.

The spec bolts the *entire* payment record onto `completionStatus → confirmed`: §7.1 says creation is "system only, on trip `completionStatus → confirmed`."

**Failure scenario.** Driver hauls the load. Driver submits the delivery record. Host does nothing — or disputes, forever. There is no `haulPayment` row at all, so the driver has **no object to dispute, no record that they are owed money, and no surface that says "you were not paid."** LogLoads accrues nothing. The host got the timber hauled for free and the platform's only evidence is a trip stuck in `submitted`.

The current codebase can tolerate this because nothing downstream depended on confirmation. This design makes host inaction the sole gate on the driver's pay record *and* on LogLoads' revenue simultaneously — the two parties who would notice are both disenfranchised by the same silence.

**Severity: critical.** **Minimal fix (Phase 0, record-only, no rails):** create the `haulPayment` at trip `completionStatus → submitted`, not `confirmed` — the driver has stated the haul happened, which is the honest trigger for "money is owed." Keep the fee gated on `confirmed` + `receipt_confirmed` (so a disputed delivery still bills nothing). Add a `hostResponseDueAt` on the trip and a driver-visible "awaiting host response since X" read model. Do **not** auto-confirm — that would fabricate a host agreement, exactly the defect class §2.1 correctly refuses elsewhere.

---

### C6. At-most-one *fee* per slot is defended three ways; at-most-one *billable completion* per slot is not defended at all

§7.2 states plainly: "One payment per trip, not per slot — a slot whose first assignment was cancelled and re-assigned yields a new trip and legitimately a new payment record." §8.4 states: at most one fee per slot, ever.

Nothing in the model proves at most one trip per slot can reach `completionStatus: "confirmed"` **and** `receipt_confirmed`.

**Failure scenario.** Slot S. Assignment A1 → trip T1 → delivered, confirmed, paid, receipt confirmed. Fee accrues, `id = platformFeeEventId(S)`. Later, through the release path (`releaseTruckSlotReservation`, `packages/services/src/truck-slots.ts:74-88`, which resets `status` to `"open"` when `reservedCount` hits 0) or any admin/reassign path, slot S takes assignment A2 → trip T2 → delivered, confirmed, paid, receipt confirmed. Two drivers paid on one slot. `platformFeeEventId(S)` collides → §8.4 layer 2 asserts and **throws**, or the accrual is skipped. LogLoads pays out twice and bills once, and the second driver's completion cannot even be closed.

This is the exact mirror of the double-bill the spec so carefully defends against, and it is under-billing plus a hard error rather than over-billing — which is why nobody will notice it.

**Severity: critical.** **Minimal fix:** pick one key and hold it. Either (a) the fee is per **trip** (`platformFeeEventId(tripId)`), matching the payment, with the "at most one per slot" invariant re-expressed as "at most one *billable completion* per slot" and asserted where completion is confirmed; or (b) keep per-slot and add a hard service assertion that a slot with any `confirmed` trip can never accept a new assignment. Test: two completed+paid trips on one slot must be impossible, or must produce two fees. Currently it produces two payouts and one exception.

---

### C7. Stripe invoice issuance and the CAS retry loop

`packages/db/src/snapshot.ts`, on `mutateRemoteOperatingState`:

> "Run a deterministic state-only mutation with optimistic retry. **The callback can run more than once and therefore must not perform email, analytics, or other external side effects.**"

The callback runs up to `maxAttempts: 4`. §9 says `stripeInvoiceId` is "written only by the Stripe webhook path" but never says where the *outbound* invoice creation call sits relative to the mutate closure, and `stripeInvoiceId` is `optional().nullable()` with no uniqueness and no "already issued" guard.

**Failure scenario.** Invoice issuance is implemented inside `mutateState((draft) => ...)` — the natural shape for every other service in this repo. A CAS conflict (likely: month-end billing runs while hosts are actively operating) triggers a retry. The closure runs again. **Two Stripe invoices are created for the same period and the host is charged twice.** The deterministic `invoiceLineId` does not help — it dedupes rows in the snapshot, not API calls to Stripe.

**Severity: critical.** **Minimal fix:** state it as a hard rule in the spec: the CAS closure computes and persists the invoice + lines only; the Stripe call happens **after** commit, in a separate step, keyed with `idempotency_key = invoice.id`, and a second issuance is refused by asserting `stripeInvoiceId === null` inside a subsequent closure. Test: a forced CAS conflict during an invoice run produces exactly one Stripe call.

---

## HIGH

### H1. §13 row 6 encodes the wrong behavior and makes accrual non-retryable

Row 6 requires "the second call **threw**." §8.4 layer 2 is an `assertCondition` inside the service, which runs inside the CAS closure against freshly cloned state on every attempt.

**Failure scenario.** Driver taps "I received it." Service: confirms receipt + accrues fee, in one closure. Another writer commits first; PATCH returns zero rows; `mutateRemoteOperatingState` reloads and re-runs the closure. On the second run, if the other writer's commit included the accrual (or an earlier partial run committed), the assertion fires and **the whole mutation throws** — taking the driver's receipt confirmation down with it. The driver gets a 500 on an action that should be idempotent, and retrying gives the same 500 forever.

More generally: any composite mutation containing "accrue the fee" becomes non-retryable the moment the fee exists.

**Severity: high.** **Minimal fix:** accrual is an idempotent upsert — if `platformFeeEventId(...)` already exists, return the existing event, do not throw. The invariant "exactly one fee per slot" is proven by the *count*, not by an exception. Rewrite row 6 to: call accrual twice, assert `filter(...).length === 1` **and** that the second call returned the same event id without error. Keep a separate throwing assertion only for the genuinely contradictory case (an existing event with a *different* `basisAmountCents`).

### H2. "A reversal is terminal for the slot" makes `billing_error` a permanent write-off

§8.4 layer 3 forbids re-accrual after reversal "in any status, including `reversed`." But `reversalReason` includes `"billing_error"` — LogLoads' own mistake.

**Failure scenario.** A bug bills $5,000 instead of $500. You reverse and issue a $5,000 credit. You fix the bug. You cannot now charge the correct $500: the slot is burned. The only route is a free-text `adjustment` line with no `truckSlotId` (the refine requires `truckSlotId` only on `platform_fee` lines), so the host receives a charge they cannot trace to a haul — which is precisely what §9's traceability comment exists to prevent.

**Severity: high.** **Minimal fix:** the guard becomes "at most one **non-reversed** event per slot." Give the event a `supersedesPlatformFeeEventId` and derive the id from `(truckSlotId, attempt)`. Test that a reverse-then-re-accrue produces exactly one *active* fee and that the sum of non-reversed `feeAmountCents` for the slot is charged exactly once — which still catches "reverse and re-complete."

### H3. `credit.remainingCents` is a decrementing counter with no application record

§9 has `credit.remainingCents` and `invoiceLine.creditId`, but no `creditApplication` entity and no rule that `remainingCents` is derived.

**Failure scenario.** The invoice builder runs, applies $500 of a $4,900 credit, writes the line (`invoiceLineId(invoiceId, creditId)` — deterministic, good) and sets `remainingCents: 4_400`. A cron double-fires, or an operator re-runs the builder for the same period. The line is deduped by id — but nothing dedupes the decrement, because the decrement is not keyed on anything. `remainingCents` drops to `3_900` with no second line to show for it. The host silently loses $500 of credit and the books do not balance against the lines.

§13 row 15 tests two *different* invoices; it does not test re-running the builder over the same one.

**Severity: high.** **Minimal fix:** make `remainingCents` derived — `amountCents - sum(invoiceLines where creditId === id)` — as an exported function in `billing-model.ts`, or add an explicit `creditApplication` row with a deterministic id. Add a test: run the builder twice over the same invoice, assert `remainingCents` is unchanged after the second run.

### H4. Nothing ties invoice header totals to the sum of its lines

`feeSubtotalCents` is documented as "Sum of platform_fee lines" — in a comment. Zod cannot express cross-entity refines, and the spec offers no substitute. The three refines on `invoiceSchema` only check the header against *itself*.

**Failure scenario.** A builder bug (or a partially-applied CAS retry) writes header `feeSubtotalCents: 4_900` while the lines sum to `12_000`. Every schema passes. Stripe charges the header. The host's PDF shows the lines. The two numbers disagree by $71 and nothing on the platform can tell you which is right. Also note the sign inversion: `creditsAppliedCents` is `centsSchema` (positive) on the header while `credit_applied` lines are negative — two representations, no bridge.

The spec's own §0 doctrine ("Honesty rules must live in contracts, never as private service helpers") is exactly the fix, and §9 doesn't apply it.

**Severity: high.** **Minimal fix:** `export function assertInvoiceBalances(invoice, lines)` in `billing-model.ts`, called before any invoice leaves `draft`, asserting subtotal/credits/total all reconcile against the lines with matching sign conventions. Test: hand it a header/line mismatch and assert it throws.

### H5. No platform organization exists — every dispute and every fault ruling is unresolvable by construction

Verified: `"platform"` appears **zero** times in `packages/db/src/seed-data.ts`, and `organizationType === "platform"` appears **zero** times anywhere under `packages/services/src` or `apps/web`. The type is in `ORGANIZATION_TYPES` (`permissions.ts:1-7`) and nothing else.

§7.1 gates `disputeResolvedAt`/`disputeResolution` on "platform org with `view_audit_log`." §10 gates all `fault*` fields on "platform org only."

**Failure scenario.** Driver disputes a short payment. The payment enters `receipt_disputed`. The only actor class permitted to resolve it does not exist: no seeded platform org, no code that recognises one, no admin surface. The dispute is permanently open. Same for every `cancellationIncident` — `fault` stays `"unattributed"` for the life of the platform, which means the reliability model §13 row 20 tests against has nothing but unreviewed records in it.

This is also a live "UI claim with no code path" risk: any Terms or help-centre line saying disputes are reviewed would be false on day one.

**Severity: high.** **Minimal fix:** either seed and wire a platform organization with the review surfaces in the same PR, or drop `disputeResolution`/`fault` from Phase 0 entirely and ship disputes as **record-and-surface-only** with copy that says exactly that ("recorded; LogLoads does not adjudicate payment disputes"). Do not ship the fields without the actor.

### H6. Cancellation disputes cannot be closed, and a legitimate breakdown is recorded as the worst class of cancellation

Two problems in §10:

1. `cancellationIncidentSchema` has `disputedAt` / `disputedByUserId` / `disputeNote` and **no** `disputeResolvedAt` / `disputeOutcome`. A driver who disputes a `fault: "hauler"` ruling has raised an objection that no field can ever answer. Compare `haulPaymentSchema`, which does have resolution fields — the asymmetry looks like an omission.
2. §13 row 20 asserts against "the host/hauler reliability read-model," which this spec never defines and which does not exist in the repo. Meanwhile the incident records `actorSide: "hauler"`, `reason: "equipment_failure"`, and `minutesBeforeSlotStart: -35` for a driver whose hydraulic line blew during loading. Every one of those fields reads as "this driver is unreliable" to any naive consumer, and `fault` will be `"unattributed"` forever (see H5).

**Failure scenario.** Driver's truck breaks down mid-loading — a genuine, blameless, timber-industry-normal event. They press cancel because that's the honest thing to do. The incident records them as the cancelling side, after the window started, with an equipment reason. Nobody ever rules on fault. Whatever the first reliability surface counts, it counts this. The driver is punished for reporting a breakdown, and the incentive is to ghost instead — which produces `driver_no_show`, which is worse for everyone.

**Severity: high.** **Minimal fix:** (a) add `disputeResolvedAt` / `disputeOutcome` (`upheld` / `overturned` / `withdrawn` / `unresolved`); (b) state as a contract rule in `billing-model.ts`'s sibling that **only** `fault === "hauler"` incidents ruled by a reviewer may count against a driver, and that `unattributed` is excluded from any score rather than merely "displayed as unreviewed"; (c) exclude `weather`, `road_conditions`, `fire_or_safety_closure`, `safety_stop`, and `equipment_failure` from adverse scoring absent a ruling. Test the exclusion, not the inclusion.

### H7. Payment creation depends on a payout preference that may not exist, at the worst possible moment

§7 makes `payeeOrganizationId` and `payeeDriverProfileId` required `uuidSchema` and says they are "resolved from the driver's payout preference at creation" — where creation fires on trip `completionStatus → confirmed`.

**Failure scenario.** Driver never set up a payout preference (there is no gate anywhere requiring it before accepting a load). Host confirms delivery. The service tries to resolve the payee, finds nothing, and either throws — **blocking the host from confirming a delivery that genuinely happened**, stranding the trip in `submitted` and re-creating C5 — or invents a payee, which is fabricated money routing.

Note `applyHaulCompletionConfirmation` today receives only `{actorUserId, trip}` and knows nothing about assignments, slots, orgs, or preferences; wiring all of that into the confirmation path is where this will break.

**Severity: high.** **Minimal fix:** resolve the payee at `marked_sent`, not at creation; make `payeeOrganizationId` nullable until then. Delivery confirmation must never be blocked by the driver's paperwork. Separately, gate *accepting an assignment* on having a payout preference, so the gap closes at the front instead of the back. Test: confirming a delivery for a driver with no payout preference succeeds and produces a payment in `awaiting_payment` with an unresolved payee.

### H8. The series model multiplies the single hottest row in the system by up to 1,440×

`loadSeriesPlanSchema` permits `slotDates` up to 60 × `slotsPerDay` up to 24 = **1,440 slots from one posting**. Every one is an object in the single `operating_state` JSON document, which is fetched, `JSON.parse`d, `structuredClone`d once per CAS attempt (up to 4), and PATCHed whole on every mutation in the entire application. On top of that, four money collections (`haulPayments`, `platformFeeEvents`, `invoiceLines`, `credits`) that grow monotonically and can never be pruned for retention reasons.

**Failure scenario.** Three hosts run month-long series. The snapshot crosses several megabytes. Every request pays parse + clone + serialize on it. CAS conflicts go from rare to routine; `maxAttempts: 4` starts throwing `OperatingStateConflictError` to real users, and a conflict during a fee accrual or invoice run is a user-visible 500 on money. There is no measurement of the current snapshot size anywhere in this spec.

**Severity: high.** **Minimal fix:** measure the current snapshot size and state a budget. Cap the MVP series far lower (14 days × 6/day = 84) and record the cap as a deliberate ceiling, not an oversight. State an archival plan for the billing collections *before* the first invoice, since retention rules will forbid deleting them later.

### H9. `payoutHandleSchema` rejects its own documented passing example

```ts
.refine((v) => !/\d{9,}/.test(v.replace(/[\s-]/g, "")), ...)
```

§13 row 19 asserts `"Zelle 503-555-0142"` parses successfully. Strip `[\s-]` → `"Zelle5035550142"` → contains 10 consecutive digits → **the refine fails**. A bare US phone number is the single most common Zelle/Venmo handle in existence, and this guard refuses all of them with the message "Do not enter bank account or routing numbers."

Two more:
- `reference: payoutHandleSchema` on `haulPayment` — an ACH trace number is 15 digits and a wire reference is often 16. A host recording exactly the reference that proves they sent the money is refused.
- The "we never hold account numbers" claim has three unguarded doors: `driverPayoutPreference.instructions` (300 chars, no refine), `haulPayment.disputeNote`, and `cancellationIncident.note`. A driver told "describe how to reach you" will paste routing details into `instructions`.

**Severity: high** — this is a launch-blocking usability failure disguised as a security control, plus a security claim with holes.

**Minimal fix:** allow 10-digit phone-shaped values explicitly (strip and match `^\d{10}$` as a permitted case), or invert the guard to reject only the ABA/account shapes it means (`^\d{9}$` routing, 11–17 digit runs) — and apply the same refine to `instructions`. Keep `reference` on a separate, laxer schema. Test the refusal *and* the four handles real drivers will actually type.

### H10. The $49 monthly minimum has no relationship to the existing Stripe subscription, no proration, and no trigger

§9 keeps `invoice` and `entitlement` separate for good reasons, then never says how the $49 floor relates to whatever the host is *already* paying through the existing Stripe subscription billing (`packages/services/src/billing.ts`).

Three concrete gaps:
1. **Double-charging the floor.** If a host is on a $99/mo plan and also receives an invoice with `minimumAdjustmentCents: 4_900`, they paid the floor twice. Nothing in the model prevents it or even notices.
2. **No proration, no `billingStartsAt`.** A host who signs up on the 29th gets the full $49 for two days. A host who leaves mid-month gets a full $49 for a period they were not on the platform.
3. **No trigger for a zero-fee org.** The refine makes `minimumAdjustmentCents = max(0, 4_900 - 0) = 4_900` for an empty period, but nothing says *who gets an invoice*. Every org in the database? Every org that ever posted? A carrier org (drivers, not hosts) would be billed $49/month under a naive "all orgs" reading.

**Severity: high** — this is the difference between "$49/month minimum" being a real, defensible charge and being a surprise bill.

**Minimal fix:** add an explicit `billingProfile` concept (or fields on the invoice) recording `billableFrom` / `billableUntil` and `organizationType === "landing_source"`-or-equivalent host eligibility; state in the spec whether the $49 is the subscription price or additional to it, and add a refine or contract assertion that they cannot both be charged. Test: a carrier org with zero postings receives no invoice; a host who joins on the 29th is charged a prorated or zero minimum, whichever the founder rules.

---

## MEDIUM

### M1. `invoiceLineId(invoiceId, kind)` silently collides for `adjustment` lines
The spec's own signature is `invoiceLineId(invoiceId, platformFeeEventId ?? kind)`. For `kind: "adjustment"`, the source id *is* the literal string `"adjustment"`, so **only one adjustment line per invoice is representable**. A second adjustment computes the same id: either it overwrites the first (an adjustment silently vanishes from a bill) or it produces a duplicate-id row that the dedupe drops. **Fix:** give adjustments their own source id (a `creditId`, an operator note id, or an explicit index) and assert id uniqueness within the invoice.

### M2. An over-applied credit makes the invoice unconstructable, and can kill a whole billing run
`totalCents: centsSchema` is `nonnegative()`. The refine forces `total = subtotal + minimumAdjustment - creditsApplied`. A $6,000 credit against a $4,900 bill yields `-1_100` → `invoiceSchema.parse` **throws**. If the billing run builds many orgs' invoices in one CAS closure, one over-credited org aborts the mutation and nobody gets invoiced. The spec never states that application must be clamped to the invoice total. **Fix:** state the clamp explicitly (`applied = min(credit.remaining, subtotal + minimumAdjustment)`), test the exact-zero and over-credit cases, and build invoices one org per closure.

### M3. The publication gate is stated as a transition guard; it needs to be an existence guard
"A posting may not leave `draft` with `driverPayCents === null`." `opportunityTransitions` allows `draft → scheduled`, `draft → open`, and `scheduled → open` (`production-network.ts:558-567`) — but nothing establishes that every posting *starts* in `draft`. If `createLoadPosting` accepts a `status`, a posting can be born `open` with null pay and never "leave draft." **Fix:** assert the invariant, not the edge: no posting may be written in any status other than `draft`/`cancelled`/`archived` with `driverPayCents === null`, checked on every write. Test creation-directly-as-open.

### M4. Pay is frozen at accept; the driver decided at request
§4 freezes `acceptedDriverPayCents` at `requested|offered → accepted`. But the host is the party who accepts. The number the driver actually read and acted on was the one displayed when they tapped request. The gap is currently narrow (requesting reserves the slot, and edits require `reservedCount === 0`) but a decline → edit-down → re-offer cycle reopens it, and nothing records what the driver saw. **Fix:** stamp `requestedDriverPayCents` on the assignment at request and assert `accepted === requested` at acceptance, or freeze at request outright.

### M5. `payeeOrganizationId` is required even when the payee is a person
§5 lets a driver choose `payee: "driver"` (owner-operator paid directly), and §7 then requires a non-null `payeeOrganizationId`. `driverProfile.companyId` is `optional().nullable()` (`schemas.ts:264`), so an owner-operator may legitimately have no org to name. **Fix:** make `payeeOrganizationId` nullable with a refine: required iff `payee === "organization"`.

### M6. `reversalReason: "cancelled_after_completion"` has no reachable code path
`assignmentV2Transitions.completed: []` and `tripTransitions.completed: []` (`production-network.ts:569-592`). A completed assignment or trip cannot transition to `cancelled`. §10's "if a fee already accrued for the slot and a cancellation incident is later recorded against it" describes a sequence the state machines forbid. **Fix:** either drop the enum member (an unreachable reason is a claim with no code path — the doctrine this spec cites) or state which admin path can produce it and test it.

### M7. §6's naming rule stops at "confirmed" and misses "completed", which is overloaded five ways
`loadStatus: "completed"`, `truckSlotStatus: "completed"`, `assignmentStatus: "completed"`, `tripStatusV2: "completed"`, and now "billable completion" — and **none of them means billable**. The migrator comment in `snapshot.ts` says it outright: a trip can be `tripStatusV2: "completed"` with `completionStatus: "pending"`, because "the delivery happened, the accounting of it never did." Any host-facing surface that shows "12 completed loads" next to "you are billed per completed load" is a false statement with no code path behind it, and it will be built by someone reading the wrong `completed`. **Fix:** extend §6's rule — "completed" is banned from all billing-facing copy and field names. The billable event needs its own word (`billableAt` is fine); the pricing page and Terms must define it in trip vocabulary ("a load you accepted and the driver confirmed payment for"), not as "completed."

### M8. §2.2 deletes a working hardcode and replaces it with two values that do not exist
`landingSchema.slotWindowMinutes` is `z.number().int().positive().optional().nullable()` (`schemas.ts:182`) — **nullable and optional**, and read by nothing, so its intended meaning (window duration? lead time? spacing?) has never been exercised. §2.2 defaults `slotDurationMinutes` from it, which yields `null` for every landing that hasn't set it — and `slotDurationMinutes` is `positive()`, non-nullable, so plan construction throws.

Worse: `dayStartMinutes` is documented as "local to the landing's timezone" and **there is no timezone field anywhere in `schemas.ts`** (grep for `timezone`/`timeZone` returns nothing). §2.2 deletes the 13:00–21:00Z hardcode — which at least worked — and replaces it with local-time semantics the data model cannot express. A series built in Oregon in November silently shifts an hour when DST ends.

**Fix:** add `timezone` (IANA) to `landingSchema` and to `loadSeriesPlanSchema` in the same PR, with a fallback constant; give `slotDurationMinutes` a stated default for null `slotWindowMinutes`; do not delete the hardcode until the replacement is complete.

### M9. `seriesPlan.version` bump semantics are undefined
The comment says a plan edit is "visibly a new version rather than a silent rewrite of slots drivers already read," but no rule says what happens to already-minted slots. Are booked slots preserved? Are unbooked ones deleted and re-minted? Does `seriesPlanVersion` on a slot become stale-but-authoritative? A host extending a 3-day series to 5 days should not be able to touch the two days a driver has already committed to. **Fix:** state it — a plan version bump may only *add* slots; existing slots keep their version and their frozen `driverPayCents`; removal is only possible for `status === "open"`, `reservedCount === 0` slots. Test that a re-version cannot alter a booked slot.

---

## LOW

- **L1.** `basisPointsSchema` permits `10_000` = 100%. Harmless at the schema level, but a 100% platform fee is representable; consider `.max(2_000)` with the ceiling as a stated policy.
- **L2.** `centsSchema.max(100_000_000)` caps any single figure at $1,000,000 — including `invoice.totalCents` and `feeSubtotalCents`. A fleet doing 2,000 loads/month at $500 pay generates a $50,000 fee, fine; but the failure mode at the cap is an unconstructable invoice (parse throws), not a clamp. Give the invoice aggregate fields a higher ceiling than the per-load ones.
- **L3.** §14 ties the copy sweep to "the same PR as the first `platformFeeEvent` that reaches an invoice" — a runtime event, not something a reviewer can check at merge time. Restate it as a code condition: the PR that first makes `PLATFORM_FEE_BASIS_POINTS` reachable from a Stripe charge path.

---

## What is sound

Said plainly, without invented objections:

- **§1's rejection of `moneySchema` reuse** is correct and well-argued; `currency: z.string().length(3)` accepting `"xyz"` is a real defect and scalar `*Cents` is the right call.
- **§2's decision not to create a `loadSeries` entity** is right. Every reader is keyed on `loadPostingId`; a third level would be re-resolution work for zero expressive gain.
- **§2.1's refusal to derive `driverPayCents` from `rateId`** is the single best judgement call in the document. Leaving existing postings `null` and unpublishable is the honest outcome.
- **§3's discriminator over a destructive `capacity` rewrite** is correct — and the only thing wrong with it is C2, which is a missing service guard, not a modelling error.
- **§4 pulling the frozen figure out of `termsSnapshot`** is right, and the precedent it cites (`directOfferId`) is real.
- **§0 and §13 row 21 on `upgradeStateSnapshot` casting rather than parsing** is exactly the trap that would have shipped otherwise, and the reasoning that old code preserves unknown collections via `{...value}` is **verified correct** (`snapshot.ts:56`). Only the schema-version half of that paragraph is wrong (C1).
- **§11's required `snapshot.test.ts` case** — feed a v2-shaped object with none of the new keys, assert non-null — is the right test and would catch the outage class it describes.
- **§7.1's identity gate on receipt confirmation** (`driverProfile.userId === actor.id`, not a role permission) is correct and important; `driverProfile.userId` is a required non-nullable uuid, so it always resolves.
- **§8.2's choice of `basisAmountCents` over `receiptAmountCents`** as the fee basis, and §13 row 3's justification ("under-paying drivers would get the host a discount"), is exactly right.
- **§12's exclusion list** — no wallet, no balance, no `application_fee_amount`, no brokering entity, no genericised vocabulary — is correct and matches the locked decisions.
- **§13 rows 2, 3, 5, 7, and 12** are well-chosen: the reflective `/Cents$/` sweep is the only guard that survives someone adding a collection next quarter; row 5's insistence on asserting the *stored* rate rather than recomputing is the right instinct; row 7's `/net|Net|afterFee/` key assertion is a genuinely clever guard against a future convenience field.

The document's failure mode is consistent and worth naming: **it defends the over-billing direction with three redundant layers and leaves the under-billing and driver-stranding directions almost entirely undefended.** C2, C4, C5, and C6 are all the same shape — a host who does nothing, or who picks the legacy option, pays nothing and the driver has no recourse. That asymmetry is the thing to fix before any of the schema detail matters.

---

# 8. Adversarial review — LogLoads Marketplace state machines & billing

# Adversarial review — LogLoads Marketplace state machines & billing

Verified against the live tree at `/home/jackson/automatedempires/ventures/logloads`. Every line reference below was read, not recalled.

---

## A. Fatal — money is wrong or unrecoverable

### A1. `accruePlatformFee` makes re-accrual after a legitimate reversal **impossible**, and the spec's own rationale for it is inverted
`packages/services/src/platform-fees.ts` (as specced), §(a) + §(h).

The function does `if (existing) return existing` on a deterministic id **before** the at-most-one assertion. §(h) `reopenHaulCompletion` writes a `fee_reversal` (setting `reversedAt` on the original, explicitly *"without altering amountCents"* — the row survives), moves the slot back to `pending_agreement`, and expects the host's re-confirmation to re-accrue.

Failure: host confirms → fee `F` accrues with id `feeId("platform_fee", slotId)`. Host reopens within 24h → `F.reversedAt` set, slot → `pending_agreement`. Host re-confirms → `accruePlatformFee` finds `F` by id, returns it, and **never sets `slot.billingStatus = "billable"` or `billableAt`**. The slot is permanently stranded in `pending_agreement`, the load is silently free forever, and §(1)'s `delivered → completed` edge (which requires billing resolved to `billable`/`not_billable`) never fires — the slot never reaches a terminal state either.

The spec's justification is backwards: it says *"the id check alone would let a reversal-then-reaccrual double-bill."* The id check is precisely what **prevents** re-accrual; the at-most-one assertion (which correctly excludes `!e.reversedAt`) is the one that permits it.

Severity: **critical** (silent permanent revenue loss + stranded slot).
Minimal fix: key the id on `(slotId, accrualSequence)` where sequence = count of prior non-reversed-or-reversed platform_fee rows for the slot; keep the at-most-one-*live* assertion as the real guard; move the `slot.billingStatus` write **before** any early return. Test: reverse-then-reconfirm must produce two `feeEvents` (one reversed, one live) and `billingStatus === "billable"`.

### A2. §(4) and §(h) contradict each other on where a reversed slot lands
§4 lists `billable/invoiced/paid → reversed`, and `reversed` as **terminal**. §(h) says reopen "writes the `fee_reversal` in the same mutation and moves the slot to `pending_agreement`." Both cannot hold. Whichever is implemented, the other table is a lie and reviewers will implement the one they read first.

Severity: **high**. Minimal fix: `reversed` is not terminal — define `reversed → pending_agreement` as the only exit, and make it reachable only from `reopenHaulCompletion`.

### A3. The closed-period credit formula over-credits on the second reversal
```
creditableCents = max(0, min(feeCents, closedPeriodFeeSubtotalCents - MONTHLY_MINIMUM_CENTS))
```
The formula is correct for **one** reversal (I checked three cases: $60 subtotal / reverse $50 → $11 ✓; $100 / reverse $50 → $50 ✓; $40 subtotal with true-up / reverse $20 → $0 ✓). It is wrong the moment a second reversal touches the same closed period, because `closedPeriodFeeSubtotalCents` is a frozen constant.

Failure: closed period subtotal $100 (host charged $100, no true-up). Reverse fee X ($50) → credit `min(50, 100-49)` = **$50**. Later reverse fee Y ($50) → the formula still reads subtotal $100 → credit `min(50, 51)` = **$50**. Total credits $100. Correct answer: the host must retain the $49 floor, so credits should total $51. LogLoads hands back $49 it was entitled to keep, per host, per correction pair.

Severity: **critical** (money out the door, silently).
Minimal fix: compute against the *live* remainder, not the frozen subtotal:
```
chargeFor(n) = max(MONTHLY_MINIMUM_CENTS, n)
creditable   = max(0, chargeFor(unreversedBefore) - chargeFor(unreversedBefore - feeCents))
```
Test: two sequential reversals in one closed period must sum to `subtotal - MONTHLY_MINIMUM_CENTS`, not to `subtotal`.

### A4. The fee grain (slot) does not match the load grain — capacity > 1 is the **default**, not the exception
`packages/services/src/loads.ts:178` mints every publish-path slot with `capacity: perDay`. `packages/contracts/src/schemas.ts:267` is `z.number().int().positive()` — there is no capacity-1 constraint anywhere, and `requestAssignment` (`packages/services/src/assignments.ts:24`) explicitly allows `reservedCount < capacity` concurrent bookings on one slot.

§0.2 only asserts `capacity === 1` **when the parent posting is `slotted`**. So for every `single`-mode posting — i.e. all existing data and the entire current publish path — one slot legitimately carries N assignments, N drivers, N deliveries, N `haulPayment` rows… and exactly **one** `platform_fee`, because `accruePlatformFee` is keyed on `slot.id` and asserts at-most-one per slot.

Failure: a host publishes 3 truckloads/day for 5 days. 15 loads delivered, 15 drivers paid, **5 fees charged**. LogLoads under-bills by 67%. Simultaneously `truckSlot.billingStatus` / `billableAt` / `notBillableReason` are single scalars trying to describe three independent completions, and `accruePlatformFee`'s `const base = payment.finalDriverPayCents` (`payment` is an undefined free variable in the spec's code — as is `load`) has no defined answer for which of three payments it reads.

This is the load-bearing contradiction in the design: keying the fee on the slot is the right instinct for §(f) replacement, and the wrong grain for everything else.

Severity: **critical**.
Minimal fix: make `capacity === 1` universal — one slot is one truckload, enforced in `truckSlotSchema` and in the `loads.ts` fan-out (emit `perDay` slots per day instead of one slot of capacity `perDay`) — and move `billingStatus`/`billableAt`/`notBillableReason` off `truckSlot` onto a dedicated `slotBilling` row so a shape migration doesn't have to shrink `capacity`. See D3 for why shrinking `capacity` in place is unsafe.

### A5. §(f)'s replacement path cannot execute — the slot is stranded at `filled`
Three independent blockers, all in current code:

1. `packages/contracts/src/state-machines.ts:20` — `filled: ["reserved", "completed", "cancelled"]`. There is no `filled → open` edge. §1's table adds one, fine.
2. `releaseTruckSlotReservation` (`packages/services/src/truck-slots.ts:71-80`) reopens **only** from `requested`/`reserved`: `reservedCount === 0 && ["requested","reserved"].includes(slot.status) ? "open" : slot.status`. From `filled` it decrements to 0 and leaves the status `filled`. It does this by **raw string assignment**, bypassing `transitionTruckSlotStatus` entirely.
3. `reserveTruckSlot` then refuses: `!["open","requested","reserved"].includes(slot.status)` → *"cannot be reserved while filled"*.

Failure: driver A cancels late. `applyAssignmentCancellationEffects` (`operating-network.ts:1111`) calls release → slot sits `filled`, `reservedCount` 0. Assignment B cannot be created. The load is dead: not re-listable, not expirable (`expired` requires `reservedCount === 0` **and** `open`), not cancellable to a fee-bearing state. Host loses the load, driver B never appears, no fee, and §(f)'s "one slot, two assignments, one fee" — described as *"the single most important idempotency guarantee in the design"* — never runs even once.

Severity: **critical** (core marketplace flow is non-functional).
Minimal fix: `releaseTruckSlotReservation` must route through `transitionTruckSlotStatus` and handle `filled → open`; add that edge to the map; and — as §5 item 13 correctly says — scope the release to the cancelling `assignmentId` so it cannot release a successor's reservation.

### A6. Host silence is a **complete, permanent** fee-avoidance and driver-strand path
§(b): *"If no disclosure record exists, `deliveryAutoConfirmAt` is null and auto-confirm never fires — the record sits `submitted` indefinitely and the fee never accrues. This is not a fallback; it is the rule."*

The spec frames indefinite-`submitted` as the safe default. Trace what it means for the driver: `haulPayment` was created at `assignment → completed`, goes `pending → overdue` at +15d… and `isBillableCompletion` requires `deliveryAgreed && payFinalized`. `deliveryAgreed` is false forever. So: **no fee, no dispute, no timeout, no escalation, no resolution — and a driver whose delivery record never settles and whose payment obligation the host can simply ignore.** Any disclosure-write failure (or a host who never receives the notice — see A7) converts into permanent limbo, and a host who works out that the disclosure is the trigger has a repeatable free-loads exploit.

Severity: **critical** (the brief's exact "states that strand a driver unpaid").
Minimal fix: absence of a disclosure must escalate, not stall. If no disclosure exists at `submittedAt + 72h`, write one (or fail the delivery attempt loudly), restart the clock once, and after a bounded second window auto-confirm with `completionResolution: "host_never_responded"`. Indefinite is never an acceptable terminal condition for an unpaid driver.

### A7. The disclosure record is self-certifying — there is no delivery channel
§(b) makes auto-confirm conditional on `billingDisclosures` holding a **delivered** notice. `packages/services/src/notifications.ts` contains no email, no Resend, no SMS, no webhook — `createNotification`/`insertNotification` push a row into the same JSON snapshot. There is no `deliveredAt` that means anything.

So the "delivered notice" is written by the same CAS mutation that will later read it. The guarantee reduces to *"the code that bills you also wrote the proof that it warned you"* — which is exactly the class of claim this repo's doctrine bans. Worse: if the disclosure is written by `materializeDueBillingTransitions` at read time (§0.4), the 72-hour countdown starts **whenever someone happens to open a dashboard**, not when the host was informed.

Severity: **critical** (this is the ethical load-bearing member of "charging on silence", and it is hollow).
Minimal fix: charging on silence requires an out-of-band delivery with a real provider receipt. Either ship email delivery and store the provider message id + accepted-at on `billingDisclosures`, or drop auto-confirm from the billable predicate entirely at MVP and require an affirmative host act. Do not ship a disclosure precondition that only proves a row was written.

---

## B. High — stranding, deadlock, and bypassable guards

### B1. A driver who is right and says so loses the dispute by default
`applyHaulCompletionSubmission` (`packages/services/src/haul-completion.ts`) short-circuits:
```
unchanged = trip.completionStatus !== "pending"
  && trip.completionSubmittedByUserId === actorUserId
  && sameDeliveredQuantity(...) && sameHaulException(...)
→ return { changed: false, previousStatus, trip }   // status stays `disputed`
```
`disputed` satisfies `!== "pending"`. So when the host disputes and the driver resubmits **the identical, correct figures**, the call is a no-op and the trip stays `disputed`. Then §(c)'s 336h auto-resolve fires: *"if the driver never answered, the host's counter-figure is written as the record, `completionResolution: "driver_did_not_answer"`."* The driver answered. The system recorded nothing and then labelled them non-responsive.

The spec explicitly blesses this short-circuit — *"the existing unchanged-content short-circuit stays; it is what makes device retries safe"* — without noticing that the dispute machine it is adding turns it into a trap.

Severity: **high** (a driver loses their pay figure for doing exactly the right thing).
Minimal fix: the `unchanged` short-circuit must not apply when `completionStatus === "disputed"`. An identical resubmission out of `disputed` is a *reassertion* and must set `submitted` + a `completionReassertedAt`. Test: dispute → identical resubmit → status is `submitted` and the 336h clock is dead.

### B2. A slot with an unanswered request can never expire and can never be re-listed
§1 gives `open → expired` guarded on `slot.endAt <= now` **and** `reservedCount === 0`. A driver requests; `reserveTruckSlot` sets `requested`, `reservedCount` 1. The host never approves and never declines. The window passes. There is no `requested → expired` edge, no timeout on `requested` anywhere in the spec, and `requestCapacityWithPolicyInternal` (`operating-network.ts:770`) now refuses new requests because `slot.endAt <= now`.

Result: slot pinned at `requested` forever, capacity consumed, driver's request open indefinitely with no notification and no resolution, load partly dead. Zero visibility to either party.

Severity: **high**. Minimal fix: add derived `requested → expired` (declining every pending request with `cancellationCategory: "load_cancelled"` and releasing the reservation), and give `requested` its own disclosure + timeout so the driver learns their request lapsed.

### B3. Auto-confirm skips two guards `settleHaulCompletion` enforces, one of which lets a **cancelled** haul bill
The spec's auto branch calls `applyHaulCompletionConfirmation` directly, correctly noting it bypasses `assertOrganizationAction`. It misses that `settleHaulCompletion` (`operating-network.ts:2127+`) also asserts:
- `context.actorUserId !== trip.completionSubmittedByUserId` (separation of duties) — moot for `null`, fine;
- **`trip.status !== "cancelled"` — *"This haul was cancelled; there is no delivery to settle"*.**

`applyHaulCompletionConfirmation` itself checks only `completionStatus === "submitted"`. And `cancelAssignmentWithPolicy` (`operating-network.ts:1225`) currently permits cancelling a trip whose `completionStatus` is `submitted` — the trip goes `cancelled` while `completionStatus` stays `submitted`. 72h later the auto path confirms it and §(a) mints a fee for a cancelled haul.

Also a type problem the spec glosses: `ConfirmHaulCompletionInput.actorUserId` is `string`, not `string | null`.

Severity: **high**. Minimal fix: the `auto` branch must re-assert every precondition `settleHaulCompletion` asserts (`trip.status !== "cancelled"` above all), widen `actorUserId` to nullable, and be the *only* caller permitted to pass `null`. §(d3)'s tightening (which is correct — see E) closes the reachability, but the guard belongs in the confirmation function, not only upstream.

### B4. `GET /api/truck-slots` publishes every host's driver pay to every authenticated user
`apps/web/app/api/truck-slots/route.ts` GET: `requireApiActor()` with **no** organization argument, then `services.listTruckSlotsForDate(date)` → `packages/services/src/truck-slots.ts:12` returns **every slot in the estate** for that date, unscoped by org, by visibility mode, or by private-network relationship.

Today that leaks scheduling. The moment §0.2 puts `driverPayCents` on `truckSlot`, it leaks every competing host's flat driver-pay figure — and, after acceptance, the exact platform fee base — to any authenticated user of any org, including their competitors' haulers. The spec never mentions this route's GET.

Severity: **high** (new commercial-data disclosure created by the change).
Minimal fix: scope the GET to the caller's org plus loads visible to it via the existing `isLoadVisibleToOrganization` path, in the **service**, before adding the field.

### B5. `POST /api/truck-slots` is worse than the spec describes — and the fix needs a signature change
The spec says the route has "no org check". It has one, and it's the wrong one: `requireApiActor(payload.organizationId)` proves the caller is a member of **the org they typed in the body**, not that the org owns `payload.loadPostingId`. `createTruckSlot` (`truck-slots.ts:20`) takes no actor context at all — it parses and pushes.

Failure: any authenticated member of any org POSTs `{organizationId: <their own>, loadPostingId: <someone else's load>, driverPayCents: 5000000, capacity: 99}`. A slot with an attacker-chosen pay figure now hangs off a stranger's posting. `requestAssignment` will happily bind to it (it checks `slot.loadPostingId === load.id`, which is satisfied), acceptance freezes the attacker's number as `frozenDriverPayCents`, and §(a) bills `load.companyId` — the victim host — 5% of it.

Severity: **high**. Minimal fix: `createTruckSlot(state, context, input)` with `assertOrganizationAction(context, "publish_load")` and `load.companyId === context.organizationId` **inside the service**, and `driverPayCents` rejected outright on any slot whose parent load the caller does not own. Note `assertOrganizationAction` already has `publish_load` (`packages/contracts/src/permissions.ts:31`), so the permission exists.

### B6. Nothing in a cronless world closes a billing period
§0.4 states, correctly, that `apps/web` has no `vercel.json` and no cron routes, and concludes "every timer is lazily derived." Then §(h) defines `billingPeriod: open → closing` on "period end reached" and `closing → closed` writing the `minimum_true_up` and creating the Stripe invoice.

Period close has no lazy read path — nobody opens a dashboard for a period that just ended, least of all a host with zero activity. `POST /api/billing/materialize` "guarded by a service token" is an endpoint, not a scheduler; the spec never names what calls it. So: no cron ⇒ periods never close ⇒ no invoice ⇒ no revenue, and the $49 minimum for an idle host is never charged at all (no fee events ⇒ arguably no `billingPeriod` row is ever created for that org in the first place — the spec never says what creates one).

Severity: **high** (the billing system as specced collects nothing without an unspecified external trigger).
Minimal fix: state the trigger explicitly — add `vercel.json` with a daily cron hitting `/api/billing/materialize`, and define `billingPeriod` creation as unconditional per (host org, month) for every org with an active host relationship, so the minimum applies to idle hosts as locked #3 requires.

### B7. Extending `applyBillingUpdate` for invoice events makes a per-load fee invoice mutate the **subscription** entitlement
§5 item 10 says to extend `applyBillingUpdate` (`packages/services/src/billing.ts`) to invoice events. That function's entire mutation is `entitlement.status = input.status` on the org's plan record, plus `stripeCustomerId`/`stripeSubscriptionId`/`currentPeriodEndsAt`.

Failure 1: an `invoice.payment_failed` on a $73 fee invoice sets the host's *subscription* entitlement to `past_due`, revoking plan access for a marketplace-fee miss. Symmetrically, a paid fee invoice can flip a `cancelled` subscription back to `active`.
Failure 2 (immediate): hosts are on the "Free launch pilot" and have no entitlement row — `applyBillingUpdate` does `if (!entitlement) throw new Error("No plan record found for this organization")`. The webhook 500s and Stripe retries the event indefinitely.

The `metadata.eventId` dedupe pattern is genuinely good and worth copying; the *function* is not.

Severity: **high**. Minimal fix: a separate `applyFeeInvoiceUpdate` writing only `feeEvent.billingStatus`/`billingPeriod.status`, reusing the eventId-before-mutation dedupe. Never let freight-fee invoices touch `entitlements`.

### B8. There is no host billing onboarding — the fee has nothing to charge
`apps/web/app/api/billing/webhook/route.ts` recognizes exactly one product: `product === "fleet_operations"`. There is no host product, no host price, no host Stripe customer, and `plans.ts:42-43` says Host is a `"Free launch pilot"` — so hosts have never been through checkout.

§6 correctly identifies that the copy sweep must ship with the first charge. It under-scopes it: deleting the string does not create a payment method. The PR that first accrues a fee must also create the host product, the checkout/customer-creation flow, and a **publication gate** (a host with no payment method on file cannot publish a load), or the first invoice has no customer to bill.

Severity: **high**. Minimal fix: add "host has a Stripe customer with a default payment method" as a `publish_load` service-level gate in the same PR, and say so in §6.

### B9. A truthful driver reporting "$0 received" mints the platform its fee
§3: `sent → received` "Records `confirmedReceivedCents`." §(a): `payFinalized = payment.status ∈ {received, resolved, overdue}`. Nothing conditions `received` on the amount.

Failure: host marks `sent` (no rails, no verification — locked #4). Driver, being honest, confirms with `confirmedReceivedCents: 0`. Status → `received` → `payFinalized` → **billable at the full posted figure**. `divergent` is set and "surfaces on the host and admin views," which is a display flag, not a control. The driver's honesty is converted into LogLoads' 5% on money that never moved.

Severity: **high** (conflates "driver confirmed receipt" with "driver was paid" — the exact conflation the brief asks about, one layer deeper than the naming fix in §3).
Minimal fix: `received` requires `confirmedReceivedCents >= finalDriverPayCents`. Anything less routes to `disputed` (or a new `received_short`) and holds `billingStatus` at `on_hold`. Only `resolved` may finalize a short receipt, and it must record what the parties agreed.

### B10. The fee is charged on a payment the platform's own records show was never made, with no reversal path
`overdue` is billable by design (§a), and the reasoning — a host must not extinguish the fee by never paying — is sound. But `fee_reversal` is defined *only* for "the fee should never have accrued: auto-confirm without a disclosure, a duplicate, a platform error." There is no kind for "the driver was never paid at all."

Failure: host posts $500, takes delivery, confirms it, never marks `sent`. At +15d the payment goes `overdue` → billable → LogLoads invoices 5% and closes the period. The driver is out $500. LogLoads has collected on it, cannot correct it under §(h), and its no-brokering disclaimer (locked #5) is doing a lot of work.

Severity: **high** (reputational and arguably the sharpest "non-custodial" edge).
Minimal fix: add a `never_paid` dispute resolution that reverses the fee (via A1's corrected re-accrual machinery) and a host reliability mark; and hold `overdue → billable` until an escalation disclosure has actually reached the host.

---

## C. Medium — architecture and concurrency

### C1. "Materialize at the top of every read path" turns every read into a global CAS write
`mutateRemoteOperatingState` (`packages/db/src/snapshot.ts:405+`) PATCHes the **entire estate JSON** in one row guarded by `version=eq.N`, retries 4 times, then throws `OperatingStateConflictError`. Reads go through `loadRemoteOperatingState` and write nothing.

§0.4's *"materialization … invoked at the top of every host/driver billing read path"* means every dashboard load becomes a full-document write contending on `id=primary`. With a 45-slot fan-out per posting (`MAX_SCHEDULE_SLOTS`), a single discovery read can want to materialize dozens of `open → expired` transitions. Under any real concurrency the billing pages start returning conflict errors and the whole app serializes behind them.

Severity: **medium-high**. Minimal fix: make the effective-status functions **pure and display-only** (the `effectiveDirectOfferStatus` precedent at `operating-network.ts:351` is pure — follow it exactly). Persist transitions **only** from (a) the token-guarded materialize endpoint on a cron, and (b) write paths that were already mutating for another reason. Never from a GET.

### C2. Append-only ledgers in a single JSON document, unbounded
`feeEvents`, `haulPayments`, `billingDisclosures`, `payAdjustments`, `billingPeriods` are all append-only and never pruned, living in the same row that is fully read and fully rewritten on every mutation. `applyBillingUpdate`'s dedupe is already a linear scan of all `auditEvents`; §(a)'s at-most-one assertion is a linear scan of all `feeEvents`; `upgradeStateSnapshot`'s backfill maps run over every collection on **every read**. This compounds C1: the row that every request rewrites grows monotonically with revenue.

Severity: **medium**. Minimal fix: index-by-slot lookup maps built once per mutation rather than repeated `.some()` scans, and a stated archival boundary (closed periods older than N months move out of the snapshot) before the first fee ships, not after.

### C3. `upgradeStateSnapshot` **casts**, it does not parse — money rows enter runtime unvalidated
Confirmed at `packages/db/src/snapshot.ts:54-120`: the upgrade path does `candidate.X = value.X ?? []` and spread-maps; nothing calls `.parse()`. `feeEventSchema.parse` at write time is therefore the *only* validation a fee row ever gets. During a rollout/rollback overlap (which the file's own doc comment says explicitly is expected), a row written by one deploy is summed by another with no schema check.

Severity: **medium**. Minimal fix: money collections are the one place worth parsing on read — validate `feeEvents`/`haulPayments` in `upgradeStateSnapshot` and fail closed (return `null`, refusing the snapshot) rather than admitting an unparseable fee row into an invoice total.

### C4. Deleting `assignmentTransitions` keeps the **looser** machine, and the sweep is under-scoped
§2: *"Delete `assignmentTransitions` and route `packages/services/src/assignments.ts` through the v2 map."*

Two problems. First, v1 is the *stricter* map: v2 (`production-network.ts:569-579`) additionally permits `requested → accepted` (skipping `offered`) and `accepted → loading` (skipping `checked_in` — the side of the machine that mirrors the DVIR gate). Deleting the stricter map to keep the looser one is the wrong direction for a machine that now freezes a fee base at `offered`/`accepted`.

Second, `transitionAssignmentStatus`/`canTransitionAssignmentStatus` are **not** confined to `assignments.ts` — they are used at `operating-network.ts:899, 901, 1098, 1106`, including the cancellation gate in `applyAssignmentCancellationEffects`. Deleting v1 while only naming `assignments.ts` leaves four unmigrated call sites, two of them on the cancellation path.

Severity: **medium**. Minimal fix: keep one map defined as the **intersection** of the two (drop `requested → accepted` and `accepted → loading` unless a real caller needs them — grep says none does), and migrate all six call sites in one change.

### C5. The "compiler-forced" claim is weaker than §1 states
§1 correctly warns that `Record<>` exhaustiveness catches map members but not `===` comparisons. It misses a third hole: `releaseTruckSlotReservation` (`truck-slots.ts:73-77`) writes `status` by **raw string assignment**, never touching `transitionTruckSlotStatus`. Adding `delivered`/`expired` produces no compiler signal there at all, and that function is on the cancellation path that A5 shows is already broken.

Severity: **medium**. Minimal fix: route every slot-status write through `transitionTruckSlotStatus`; add a lint/guardrail rule forbidding direct assignment to `slot.status`.

### C6. `frozenDriverPayCents` freezes at acceptance and refuses null — legacy postings fail at the wrong moment
§2: freeze from `slot.driverPayCents ?? load.driverPayCents`, *"refuse if null."* Every currently-open posting has `driverPayCents === null` (it's a new field with no backfill possible — nobody knows what the host would have said). The refusal therefore lands on the **host's approve action, after a driver has already requested and had capacity consumed**, with the message arriving to the wrong party at the wrong time.

Severity: **medium**. Minimal fix: gate at publication and at discovery — a posting with null `driverPayCents` is not requestable and not visible in the marketplace, with a host-facing "state the driver pay to relist" action. Never let a request be created against a posting that cannot be accepted.

### C7. Billing-period membership becomes a function of who happened to open a dashboard
`billingPeriodKey: periodKeyFor(load.companyId, at)` where `at` is the materialization instant. Under lazy materialization, two hosts with byte-identical facts land in different months depending on whose dashboard was opened before midnight on the 31st. Combined with `open → closing`'s guard ("no `on_hold` slot remains whose `billableAt` would fall inside the period" — which is itself circular, since `billableAt` doesn't exist until accrual), period membership is non-deterministic.

Severity: **medium**. Minimal fix: `billingPeriodKey` derives from the **fact** timestamp (the later of `completionConfirmedAt` and the payment-finalizing timestamp), never from `at`. Then §(h)'s "a reversal inside a closed period credits the open period" still works, and it is the only place `at` should matter.

### C8. `feeId("payment", assignmentId)` collides across payment kinds
§3 creates the obligation payment with `feeId("payment", assignmentId)`. §(d2) lets the host record a **discretionary** payment for a cancelled assignment, and §3 lets a cancelled-pre-haul obligation go to `voided`. Both are `haulPayment` rows for the same `assignmentId` → same deterministic id → the discretionary payment silently returns the voided obligation, or overwrites it.

Severity: **medium**. Minimal fix: `feeId("payment", assignmentId, kind)`.

### C9. The `assignment → completed` mirror can silently no-op, and the payment obligation hangs off it
`operating-network.ts:1932-1942`:
```ts
if (nextAssignmentStatus && assignment.status !== nextAssignmentStatus && canTransitionAssignmentStatusV2(...)) { … }
```
If the guard is false the mirror is skipped **silently** — trip `completed`, assignment not. §3 creates the `haulPayment` "when `assignment.status → completed`". The current happy path survives (`assignmentStatusByTripStatus` at `:84-91` maps `at_destination`/`en_route_to_destination`/`unloading` → `hauled`, and `hauled → completed` is legal), but the obligation to pay a driver now rests on a conditional with no assertion and no audit event when it declines to fire. Add one trip status, or reorder one edge, and drivers stop being owed money with no error anywhere.

Severity: **medium**. Minimal fix: create the `haulPayment` from `nextStatus === "completed"` on the **trip** (same block as `updateOpportunityCapacityAfterCompletion`), and turn the mirror's silent skip into an `assertCondition`.

### C10. The obligation only exists if someone presses one more button
`submitHaulCompletion` requires `trip.status ∈ {at_destination, unloading, completed}`; `progressTripStatus → completed` requires `completionStatus !== "pending"`. So the driver must record the delivery **and then** separately finish the trip. If the second action never happens (dead battery, no signal at the mill, driver assumes recording *is* finishing), the trip sits at `at_destination`: slot never reaches `delivered`, `billingStatus` never leaves `not_started`, no `haulPayment` exists, and every clock in §(b) is unstarted. The host is the only other party who can progress it, and is the party with the incentive not to.

Severity: **medium**. Minimal fix: `submitHaulCompletion` should progress the trip to `completed` in the same mutation when evidence requirements are met — recording the delivery *is* finishing the haul — or the driver's UI must present it as one action with one write.

### C11. §7 re-opens the door §0.2 closed on post-hoc pay reduction
§0.2: *"A later edit to the posting or slot **never** moves an accepted driver's pay."* §7 then lets the host propose any `proposedPayCents` — including downward — at any point from acceptance onward, with the driver's only defence being refusal *after the load is already delivered*, when their leverage is zero. Locked #2 says the driver sees exactly the number the host stated; a post-delivery haggle mechanism is that number becoming an opening bid.

`expired → original stands` is the right default and I'd keep it. The direction is the problem.

Severity: **medium**. Minimal fix: after `checked_in`, `payAdjustment` may only **increase** `proposedPayCents`. Downward corrections before the haul are a cancel-and-repost (with the host wearing the reliability mark under §d2); downward corrections after the haul are a dispute, adjudicated, not a proposal the driver can be pressured into.

### C12. §(g) punishes a driver for a legitimate breakdown, and double-punishes with §(e)
§(g): `equipment_failure`, qty 0 → *"none; **driver reliability mark**."* §(e): "after `checked_in` with no delivery" → `no_show`, reliability mark on the driver profile and the hauling org.

A mechanical failure en route is the single exception type a driver has least control over in the moment, and `EXCEPTIONS_WITHOUT_EVIDENCE` (`haul-completion.ts:31-36`) already treats it as a legitimate no-delivery outcome. Under §(g) + §(e) a driver who breaks down after check-in takes a public reliability mark **twice**, on two different rules, for a truck that failed. Compare `weather_hold` — identically zero delivery, identically no fee — which the spec correctly marks "nobody's fault."

There is also no evidence path: `equipment_failure` waives evidence, so a driver cannot even attach a repair invoice to contest the mark.

Severity: **medium** (directly against the brief's last clause).
Minimal fix: `equipment_failure` is not misconduct — no automatic mark. If a pattern signal is wanted, count *occurrences* privately and surface only on a threshold, with a driver-visible right to attach documentation. And `no_show` must exclude any trip that reached `checked_in` and recorded an exception — a driver who showed up and told you what happened is definitionally not a no-show.

---

## D. Lower severity but concrete

**D1.** §(a)'s code references `payment` and `load` as undefined free variables. With capacity > 1 (A4) there is genuinely no single answer for which payment, so this is a symptom, not a typo.

**D2.** §(a)'s `if (existing) return existing` returns before `slot.billingStatus = "billable"` / `billableAt` are written. Even absent A1, a re-entry that finds the event leaves the slot's status unwritten if the first attempt's CAS lost. Set the slot fields before any early return.

**D3.** `truckSlotSchema` carries `.refine(value.reservedCount <= value.capacity)` (`schemas.ts:274`). Forcing `capacity: 1` onto an existing slot whose `reservedCount` is 2 makes the **entire snapshot** unparseable at the next validated read. A4's fix must *split* slots into new rows, never shrink `capacity` in place.

**D4.** "Settled" is already live vocabulary for delivery: `settleHaulCompletion` notifies the driver *"`${load.title}` is settled."* §3 bans "settled" for payment — correctly — but must also add this existing string to the §6 copy sweep, or hosts and drivers will read "settled" on a haul where no money has moved.

**D5.** §0.1's atomic-triple instruction is right, but `upgradeStateSnapshot` today uses `if (candidate.X === undefined) candidate.X = []`, not `??=`. Cosmetic — match the file's existing style so the diff reads as one pattern.

**D6.** §1's `filled → cancelled | "forbidden after the driver submits"` is a row in a transition table whose guard is a prohibition. Split it: the edge exists, the guard is `completionStatus === "pending" && trip.status ∉ {at_destination, unloading, completed}`.

---

## E. What is sound — stated plainly

These are correct and I could not break them:

- **The (d3) tightening.** `cancelAssignmentWithPolicy` really does only refuse `completionStatus === "confirmed"` (`operating-network.ts:1225-1229`, `settledTrip?.completionStatus !== "confirmed"`), leaving `submitted` and `disputed` cancellable. A host really can erase a recorded delivery today. The proposed guard, and the additional refusal once `trip.status ∈ {at_destination, unloading, completed}`, are both right and both need removal-tests.
- **Requiring a counter-figure on dispute.** `applyHaulCompletionDispute` really does require only a reason. An open-ended dispute really is a free permanent fee-avoidance lever under the new predicate. Correct diagnosis, correct fix.
- **"Delivery disputes do not move the fee base."** This is the right separation and it genuinely removes the dispute-for-fee-reduction incentive. Keep it exactly as written.
- **Auto-confirm as a distinct code path with `actorUserId: null` and a `haul_completion_auto_confirmed` audit action.** Correct, and consistent with how `applyHaulCompletionDispute` already refuses to name a confirmer nobody appointed.
- **The never-recompute-a-closed-period principle** in §(h), and the insight that reversing into a floor-billed period must credit zero. The principle is right; only the arithmetic (A3) is wrong.
- **Fee never subtracted from driver pay**, `application_fee_amount` absent in Phase 0 because there is no charge object, and the negative-control test that no code path returns `pay - fee`. Correctly derived from locked #4, and the negative control is the right shape of test for this repo.
- **`reopenHaulCompletion` as a real capability.** The string *"ask the host to reopen it before changing the record"* is live in `applyHaulCompletionSubmission` with no code path behind it. Building it rather than deleting the string is the right call under the doctrine.
- **The idempotency inventory in §5.** Items 5 (re-evaluate `reservedCount` inside the CAS body), 8 (the existing `progressTripStatus` completed short-circuit at `:1864` now guards a fee), 10 (`applyBillingUpdate`'s eventId check does run before any mutation — verified), and 13 (`releaseTruckSlotReservation`'s `Math.max(0, …)` can release a successor's reservation) are all real and correctly characterised. Item 13's fix is also a prerequisite for A5.
- **§0.4's diagnosis** that there is no cron and no `vercel.json`, and that `effectiveDirectOfferStatus` is the existing lazy-derivation precedent. The diagnosis is right; the conclusions drawn from it (C1, B6) are not.

---

## F. Ranked fix order

1. **A4** (fee grain / capacity 1) — everything downstream assumes it.
2. **A5** (replacement path stranding) — the core flow does not work.
3. **A1 + A2** (re-accrual impossible; contradictory reversed-state).
4. **A6 + A7** (host-silence strand; disclosure has no delivery channel) — these two decide whether auto-confirm can ship at all.
5. **A3** (credit arithmetic), **B7/B8** (invoice plumbing + host onboarding), **B6** (period close trigger).
6. **B1, B2, B3, B9, B10** (driver stranding and bypassable guards).
7. **B4, B5** (the truck-slots route, both verbs) — cheap, and they gate the new field.
8. **C1** (read-path writes) before any load is put on the system.

Nothing in this design puts LogLoads in custody of driver funds — Phase 0 is genuinely record-only and I found no path to a balance, a transfer, or a nonzero `application_fee_amount`. The custodial line holds. The money that is at risk is LogLoads' own (A1, A3, A4, B6) and the driver's (A6, B1, B9, B10).

---

# 9. 3.9 Cancel-then-take

itimate edit either goes unrecorded (leaving the driver unprotected) or throws outright. The at-most-one assertion is an idempotent **skip**, never a throw, because the sweep re-runs on every mutator and every CAS retry.

## 3.9 Cancel-then-take

```ts
detectCancelThenTake(state, { driverProfileId, candidateOccupancy, at }): Signal | null
```
Runs in the service, in **both** directions, on both events:

- **On a new booking** — scan the driver's `cancelled` assignments with `cancelledAt` within `CANCEL_THEN_TAKE_LOOKBACK_HOURS = 168` whose reconstructed occupancy `conflicts()` with the candidate and whose reason code is **not excused** → `cancel_then_take`.
- **On a cancellation** — if the driver holds an active assignment, booked *after* the one being cancelled, that conflicts with it → `take_then_cancel`.

Implementing only one direction is the likely half-build. Detection never blocks at MVP; it records. False positives are the risk that matters: cancelling for a breakdown and taking unrelated work two days later must produce nothing.

## 3.10 Counters and the enforcement ladder

Counters are **derived, never stored**:
```ts
schedulingReliability(state, subjectId, { windowDays: 90, at }) → {
  acceptedInWindow, completedLoads, lateCancellations, excusedCancellations,
  cancelThenTakes, takeThenCancels, noShows, unconfirmedAtDeadline,
  lateCancellationRate: number | null
}
```
- Denominator = **ever-accepted** assignments whose slot start fell in the window, **including subsequently cancelled ones**. Removing a cancelled assignment from the denominator counts the cancellation twice (once in the numerator, once by shrinking the base): 5 accepted with 2 cancelled would read 67% instead of 40%. The test asserts exact values, not "lower than".
- `lateCancellationRate` is `null` below 5 accepted — matching the existing reticence at `recommendations.ts:72`. One incident cannot brand a new driver.
- Incidents with `adverse: false` or a withdrawn attestation are excluded from every adverse count.

**Host-visible at MVP:** completion rate, on-time rate, `lateCancellations`, `noShows`. **Not host-visible:** `excusedCancellations`, `cancelThenTakes`, `takeThenCancels` — those are visible to the driver themselves and to platform ops. A counter rendered beside an approve button is a penalty regardless of what the label says, and `cancel_then_take` is a heuristic with acknowledged false-positive modes shipping with zero measured precision. Revisit once precision is measured.

```ts
export const DEFAULT_SCHEDULING_POLICY = {
  conflictCheck: "enforce",          // after one deploy at "warn"
  deadheadCheck: "enforce",
  cancellationTracking: "record",
  enforcement: {
    warnDriverAtLateCancellations: null,
    restrictBookingAtLateCancellations: null,
    suspendAtNoShows: null,
    requireHostApprovalAtRate: null
  }
} as const
```
Every rung is implemented and unit-tested with **injected** thresholds. `evaluateEnforcement(counters, policy)` is pure; the only production caller passes the constant above, in which every threshold is `null` = disabled. **No shipped UI string may threaten suspension or penalty while the ladder is off.** Driver copy is limited to: *"Hosts can see your on-time record."*

## 3.11 Scheduling tests

Each is written so it **turns green if the guard it protects is deleted**.

**Conflict core** (`contracts/src/scheduling.test.ts`)
1. Same slot, same driver, different trucks → conflict on `driver`.
2. Same slot, different drivers, same truck → conflict on `truck`.
3. Same slot, same driver+truck, trailer `null` → driver+truck conflicts, **no** trailer entry.
4. `next.start === prev.end + separation` exactly → no conflict.
5. One minute earlier → `insufficient_transit`, `actualGapMinutes === requiredGapMinutes - 1`.
6. **All buffers and deadhead 0** → literal overlap still conflicts.
7. Same-site pair still requires `deadheadMinimumMinutes`; a 120-mile pair reflects `roadCircuityFactor`.
8. `conflicts(a,b) === conflicts(b,a)` over 200 generated pairs.
9. `cancelled`/`declined`/`completed` contribute nothing; `requested` and `offered` do.
10. `unavailable` overlapping → `declared_unavailable`; **no window → `unconstrained`, bookable**; `state.availabilityWindows.length` unchanged (the deleted auto-mint).
11. A host override of `preTripMinutes` does not change the driver's `requiredGapMinutes`.
12. Absolute assertion: `occupancyEnd` equals a hand-computed instant (catches the service-duration double-count).

**Service enforcement** (`services/src/scheduling-integrity.test.ts`)
13. `requestCapacityWithPolicy` with a conflicting slot returns a rejection, leaves `remainingTruckloads` unchanged, creates no assignment, and commits **exactly one** `double_book_blocked`.
14. Request created while clear → second booking lands → **approve rejects**.
15. A direct-offer claim conflicting on the **trailer** dimension is rejected (only the shared checker computes trailer; the old inline block never did).
16. Two non-overlapping slots of the same series, same driver → both succeed.
17. Two assignments on the same slot, same driver → rejected even with capacity remaining.
18. Host re-times slot A into slot B's window → **the edit is rejected**, both assignments intact.
19. `POST /api/truck-slots` from a member of another org → 403; from a member lacking the permission → 403.
20. Annotation ⟺ gate over 50 generated (driver, slot) pairs.

**Time zone**
21. Landing in `America/Los_Angeles`, slot at 23:30 local → `slotDate` is the **local** civil date.
22. Spring-forward 02:30 resolves forward, does not throw, `startAt < endAt`.
23. Fall-back 01:30 resolves to the **first** instant; two slots that day do not collide.
24. A site with a null `ianaTimeZone` cannot generate slots and renders no local time string.
25. Pickup and delivery in different zones render their own abbreviations; a device on `America/New_York` still sees landing-local pickup times.

**72h, taxonomy, no-show**
26. Cancel at T-73h with `driver_schedule_conflict` → no `late_cancellation`.
27. Cancel at T-71h59m → exactly one incident; a duplicate call still yields one.
28. Cancel 4 minutes after accepting a 10h-lead load → **no incident** (grace).
29. Cancel at T-1h with `equipment_breakdown` → `excused_cancellation` only, `adverse: false`, `lateCancellations` stays 0.
30. Host changes pay inside the window → `host_material_change`, and a driver cancel in the next 24h is excused whatever code they pick.
31. Two different host edits inside the window → **two** incidents (id discriminator).
32. Cancel with no reason code → schema rejection; legacy nulls load as `legacy_unclassified` and break no counter.
33. `reservedCount` decrements exactly once; a second cancel does not decrement again; a release scoped to A does not release B's reservation.
34. Slot start + grace passed with the trip still `assigned` → one `no_show`; host attestation withdraws it from every counter.
35. A driver who reached `checked_in` and recorded `equipment_failure` produces **no** `no_show` and **no** adverse mark.

**Cancel-then-take**
36. Cancel A unexcused → book overlapping B within 7 days → one `cancel_then_take` naming both.
37. Book B → cancel overlapping A → one `take_then_cancel`.
38. Cancel A for `equipment_breakdown`, book non-overlapping B two days later → **no incident**.
39. `mutual_reschedule` then refill the freed window → **no incident**.
40. Same pattern 8 days later → outside lookback, nothing.

**Offers and deadlines**
41. Offer with `expiresAt >= slot.startAt` → rejected at creation.
42. Expired offer materializes once, releases its hold once; a claim after expiry throws, including one arriving in the same mutation as the sweep.
43. Request 90 minutes out cannot be approved after `slot.startAt - approvalCutoffMinutes`.
44. Host non-response past the deadline → request expires, capacity restored, one `host_slow_response`; running the sweep twice yields one incident and one restore.
45. Missed T-72h **and** T-24h → **two** `unconfirmed_at_deadline` incidents, distinct ids.

**Ladder and counters**
46. A driver with 99 `late_cancellation` and 20 `no_show` can still request, claim, and be approved under `DEFAULT_SCHEDULING_POLICY`; `evaluateEnforcement` returns `{outcome: "none"}`.
47. With injected thresholds each rung fires at its exact boundary and not one below.
48. Guardrail: driver-facing scheduling copy contains no `suspend`/`penalt`/`ban` string.
49. 5 accepted with 2 cancelled → rate is exactly 40%, not 67%.
50. Below 5 accepted → `lateCancellationRate: null`.
51. Cross-org viewer sees a day-level label with no times, no host, no load title, no mill.

**Snapshot shape**
52. `upgradeStateSnapshot` on a pre-migration snapshot yields `schedulingIncidents: []` and `ianaTimeZone` present-and-null on every site; `REQUIRED_TABLES` contains `schedulingIncidents`.
53. A snapshot lacking the collection, then an immediate cancel, does not throw.

---

# 4. Permissions

## 4.1 New actions

Added to `ORGANIZATION_ACTIONS` (`packages/contracts/src/permissions.ts:26`). **No existing action is renamed or removed.** `permissions.test.ts` enumerates the full matrix — extend the enumeration, never spot-check.

| Action | Meaning |
|---|---|
| `set_driver_pay` | Author or change `driverPayCents` on a posting or an unbooked slot |
| `manage_load_slots` | Add, edit, or cancel individual slots on a published series |
| `record_haul_payment` | Mark that the host has sent driver pay |
| `confirm_haul_payment` | Mark that the payee received it (necessary, never sufficient — §4.3) |
| `report_payment_problem` | Open or withdraw a **payment dispute** or non-payment report |
| `view_fee_ledger` | Read platform fee lines, invoices, credits, the monthly minimum |
| `manage_billing_profile` | Create/update the host billing profile and payment method |
| `adjust_fee_ledger` | Issue a credit against a LogLoads invoice (platform organizations only) |

**Deliberately reused, not new:** publishing a series → `publish_load`; requesting a slot → `request_assignment`; accepting/declining/cancelling as host → `assign_capacity`; cancelling one's own assignment as driver → `request_assignment`; reading driver pay on a listing → no action (it is part of the public listing body).

**Deliberately not an action:** writing a payout preference. That is identity-gated (§4.3), because any role-based grant hands a carrier admin the ability to redirect a driver's pay to themselves.

## 4.2 Grants

| Role | `set_driver_pay` | `manage_load_slots` | `record_haul_payment` | `confirm_haul_payment` | `report_payment_problem` | `view_fee_ledger` | `manage_billing_profile` | `adjust_fee_ledger` |
|---|---|---|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅¹ | ✅ | ✅ | ✅ | ✅² |
| admin | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| dispatcher | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| driver | ❌ | ❌ | ❌ | ✅¹ | ✅ | ❌ | ❌ | ❌ |
| fleet_manager | ❌ | ❌ | ❌ | ✅¹ | ✅ | ❌ | ❌ | ❌ |
| landing_manager | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| destination_manager | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| billing | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| viewer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ Necessary and **not** sufficient: the payee binding of §4.3 also applies. A host owner holds the action and always fails the binding — that is the design, not a leak.
² Also requires `organization.type === "platform"`. `organizationTypeForPath` (`accounts.ts:138-147`) derives org type from a closed signup path enum, `INVITABLE_ROLES_BY_ORGANIZATION_TYPE.platform` is `[]` (`permissions.ts:117`), and there is no mutation path for `organization.type` — so no customer can self-declare one. **Still assert the org type in the service**, because the role check alone grants it to every owner via the `ORGANIZATION_ACTIONS` spread.

`set_driver_pay` is separated from `publish_load` deliberately. `publish_load` is held by `dispatcher` and `landing_manager`; reusing it for money would let a woods foreman author the figure LogLoads bills 5% of, while holding no `view_fee_ledger` and therefore unable to see the charges they generate. `landing_manager` publishes and manages slots; only `owner`/`admin`/`dispatcher` state pay. **Update the stale comment at `permissions.ts:58-60` in the same PR** so the file stops asserting something false.

`INVITABLE_ROLES_BY_ORGANIZATION_TYPE` is unchanged. `billing` remains host-side only, which is why `record_haul_payment` on the hauling side resolves to `owner`/`admin`.

## 4.3 The payee binding

```
assertPayeeMayConfirm(state, actor, payment):
  // reads the SNAPSHOT on the payment, never the live payout preference
  if payment.payeeType === "driver":
      require actor.userId === payment.payeeUserId
  if payment.payeeType === "organization":
      require actor.organizationId === payment.payeeOrganizationId
      require organizationRoleCan(actor.role, "confirm_haul_payment")
  always: require actor.organizationId !== payment.payerOrganizationId
  always: require actor.organization.type !== "platform"
```

Real fleets pay employee drivers through the carrier, so the rule is payee binding, not role alone. The last two lines are unconditional and each needs a test that fails when that line is deleted — they are the entire mechanical content of "the host cannot mark its own payment received" and "LogLoads staff cannot settle a payment record."

Reading the snapshot rather than the live preference is what closes the rebind attack: a carrier admin who edits the driver's preference to point at the org cannot thereby become the party who confirms a payment that was created against the driver personally.

`actorUserId` always comes from the session via `apps/web/lib/api-actor.ts › requireApiActor()`. Any `actorUserId` in a request body is refused, not merged.

## 4.4 Refusal codes

- **R-VIEWER** — role is `viewer`: refuse every write and every ledger read, independently of the action check, so a fat-fingered future grant cannot open a route.
- **R-CROSSORG** — the target record's organization is not the actor's: refuse as *not found*, never *forbidden*, matching `operating-network.ts:1326`.
- **R-DEMO** — demo personas may not mutate money records. **Asserted on a flag in the actor context inside the services**, not from `apps/web/lib/demo-mode.ts` — there are zero `demo` references in `packages/services/src` today, and a gate outside the service boundary is exactly what R1 forbids. Tested by calling the service directly.

## 4.5 Route-level fixes that gate the new fields

`POST /api/truck-slots` today does `requireApiActor(payload.organizationId)` then `createTruckSlot(payload)`. That check proves the caller is a member of **the org they typed into the body** — it never checks that `payload.loadPostingId` belongs to that org, and `createTruckSlot` (`truck-slots.ts:20-34`) takes no actor context at all. Any authenticated user of any org can POST `{organizationId: <their own>, loadPostingId: <a competitor's>, driverPayCents: 2000000}`, and after acceptance that attacker-chosen figure becomes the victim host's fee base.

`createTruckSlot(state, context, input)` gains, **in the service**:
- organization derived from `loadPosting.companyId`, ignoring `payload.organizationId` entirely;
- `assertOrganizationAction(context, "manage_load_slots")`, plus `set_driver_pay` if `driverPayCents` is present;
- `assertCondition(loadPosting.companyId === context.organizationId, …)` → R-CROSSORG;
- `kind === "series_unit"`, `capacity === 1`;
- capacity update on the parent posting.

`GET /api/truck-slots` calls `requireApiActor()` with **no** organization argument and returns `listTruckSlotsForDate(date)` — every slot in the estate. Today that leaks scheduling; the moment `driverPayCents` lands on the slot it publishes every competing host's driver-pay figure, and after acceptance the exact fee base, to every authenticated user including their competitors' haulers. Scope the GET, in the service, to the caller's organization plus loads visible to it through the existing `isLoadVisibleToOrganization` path.

**The driver-facing serializer whitelists fields.** No payload rendered to a driver may contain a key matching `/fee|invoice|platform_?fee/i`. A driver who sees the host's fee reads it as a deduction from their pay, and the entire promise collapses.

## 4.6 Capability refusals worth naming

| Capability | Refuses |
|---|---|
| Publish a series | `driverPayCents` null/≤0/>$20,000; `hostPaymentTermsDays` null; landing without `ianaTimeZone`/`operatingHoursLocal`; `slots.length !== seriesSize`; two slots overlapping beyond the landing's `concurrentTruckCapacity`; no host billing profile with a payment method on file (from PR-8); any overdue haul payment on the org |
| Edit a slot | any change once an accepted assignment exists past `checked_in`; **any** `driverPayCents` change once an accepted assignment exists, at any trip status; all edits after billable completion; edits creating a sibling overlap; edits creating a conflict for any active assignment (§3.6) |
| Request a slot | slot not requestable (§1.4); an active assignment already exists **for this `(truckSlotId, driverProfileId)`** — re-scoped from the per-posting check at `operating-network.ts:748-753`, which today makes a whole series bookable exactly once; any active assignment on the slot regardless of driver; a schedule conflict; **no payout preference on file** |
| Accept a request | slot pay changed since the request; another accepted assignment on the slot (asserted against a deterministic key); driver schedule conflict re-checked at approve; R-CROSSORG |
| Mark payment sent | trip delivery not recorded; actor org is not the payer; status not `awaiting_payment`; `amountSentCents !== agreedDriverPayCents` without a 10–500 char variance reason; any attempt to write receipt fields in the same call; `dispatcher` explicitly (with a test asserting `organizationRoleCan("dispatcher", "record_haul_payment") === false`) |
| Confirm receipt | actor in the payer org at any role; actor org type `platform`; actor not the bound payee; status not in `{awaiting_payment, marked_sent, receipt_short, payment_reported}`; `amountReceivedCents` absent or ≤ 0 |
| Report / dispute payment | actor is not the payee; `awaiting_payment` before `dueAt`; reason under 10 chars |
| Cancel | reason code absent; free text under 10 chars where `requiresNote`; after billable completion; host cancel past `loaded`; a driver cancelling another driver's assignment; cascading a series cancel onto slots that have accepted assignments (each must be cancelled individually, with its own reason, notifying its own driver) |
| Adjust the fee ledger | org type not `platform`; editing or deleting an existing fee line (adjustments are append-only); an adjustment driving the invoice total below zero; **any adjustment whose target is a driver payment record** — LogLoads can credit its own fee and can never adjust what a host owes a driver, which is the non-custodial line drawn in code |

---

# 5. Canonical terminology and the payment disclosures

## 5.1 Work objects

| Concept | Code | User-visible | Definition shown | Never |
|---|---|---|---|---|
| Load series | `loadPosting` with `seriesPlan !== null` | **load series** | "Six loads on the same route, posted together." | batch, bundle, multi-load, campaign |
| Slot | `truckSlot` (`kind: "series_unit"`) | **slot** | "One load on the series, with its own day and time window." | seat, spot, opening, shift, booking, job |
| Driver availability | `availabilityWindows` | **availability** | "When this driver and truck are free." | slot |
| Assignment | `assignment` | **assignment** | "A driver accepted onto one slot." | booking, reservation, order, gig |
| Trip | `tripsV2` | **trip** | "The haul itself, from assigned through completed." | run, job, delivery (as a record noun) |
| Haul | — | **haul** | Prose and marketing only. Never a record label, column header, or status. | — |

## 5.2 Money

| Concept | Code | User-visible | Definition | Never |
|---|---|---|---|---|
| Driver pay | `driverPayCents` / `agreedDriverPayCents` | **driver pay** | "The flat amount the host pays the driver for this load." | rate, load rate, price, offer, earnings, compensation, per-ton, per-mile |
| Rate card | existing `rates`/`rateType`/`fuelSurchargeCents` | **rate card** | "Your company's standing price list. It is not what a driver is paid for a load." | driver pay, load pay |
| Platform fee | `platformFeeCents` | **platform fee** | "LogLoads' 5% service fee, charged to the host on top of driver pay." | commission, take rate, cut, margin, **brokerage fee**, broker fee |
| Monthly minimum | `monthlyMinimumCents` | **monthly minimum** | "The least you pay LogLoads in a month, whatever your load count." | base fee, subscription |
| Invoice | `platformInvoice` | **invoice** | "What LogLoads charges you this month: platform fees, topped up to the monthly minimum." | bill, statement, settlement |
| Credit | `platformCredit` | **credit** | "A reduction of a LogLoads fee already invoiced to you." | refund, reversal, rebate, chargeback |
| Payout details | `driverPayoutPreference` | **payout details** | "How the driver wants to be paid, and by whom." | wallet, account balance, payment method on file |

**Banned outright, product-wide:** wallet, balance, escrow, funds held, payout balance, we pay you, we release payment, settle your funds. Each implies custody. `brokerage fee` and `broker fee` are banned for a second reason — the Terms at `apps/web/lib/v3-shared.ts:351` and both footers disclaim brokering, and one fee label undoes both.

**"Completed" is banned from all billing copy and field names.** It already means five different things (`loadStatus`, `truckSlotStatus`, `assignmentStatus`, `tripStatusV2`, and colloquially "billable"), and **none of them means billable** — a trip can be `tripStatusV2: "completed"` with `completionStatus: "pending"`, because the delivery happened and the accounting of it never did. A host surface showing "12 completed loads" next to "you are billed per completed load" is a false statement, and it will be built by someone reading the wrong `completed`. The billable event has its own word: **billable completion**, `billableAt`, `billableReason`.

## 5.3 Billable completion, host-facing

> "A load becomes billable when the host has accepted the delivery **and** the driver has confirmed the pay they received. If the host never responds to a delivery record, we tell them twice by email and, if they still do not answer, the load becomes billable and the record shows the host did not respond. If the host has marked the payment sent and the driver does not answer within 7 days of being told, the load becomes billable. **If the host never marks the payment sent, no fee is ever charged** — instead the host cannot publish new loads until the payment is recorded."

Requested, accepted, in-progress, cancelled, disputed, short-paid, and never-paid hauls generate **no fee line**.

## 5.4 The lexical firewall

Two events, days apart, decided by opposite parties. They share no verb, noun, or badge colour.

| | Delivery accepted | Payment confirmed |
|---|---|---|
| Meaning | The host accepts the driver's account of what was delivered | The payee states the money actually arrived |
| Who | Host (`assign_capacity`) | Payee only (§4.3) |
| Field | `trip.completionStatus === "confirmed"` | `haulPayment.status === "receipt_confirmed"` |
| Verb | **accept** / **accepted** | **confirm** / **confirmed** |
| Badge | "Delivery accepted" | "Payment confirmed" |
| Negative | "Delivery disputed" | "Payment disputed" |

**Renames that ship with the first `haulPayment` write:** `DriverPages.tsx:351` (`confirmed: "Confirmed by the host"`) and `DriverActions.tsx:909` ("Delivery confirmed by the host") become **"Delivery accepted by the host"** / **"{n} {unit} accepted by the host."** `settleHaulCompletion`'s notification string *"`${load.title}` is settled"* becomes *"…was accepted by the host"* — "settled" reads as money moved on a haul where none has.

Also banned repo-wide per existing doctrine: **audit trail** (use "record" or "activity"); note the stale comment at `haul-completion.test.ts:965`.

## 5.5 Exceptions, incidents, disputes

The bare word **dispute** is banned in user-visible copy — it must always carry `delivery` or `payment`.

| Concept | Code | User-visible | Never |
|---|---|---|---|
| Delivery exception | `HaulException` | **delivery exception** | incident, problem, failure |
| Incident | `schedulingIncidents` | **incident** | exception, dispute |
| Delivery dispute | `trip.completionDisputeReason` | **delivery dispute** | dispute (bare), rejection |
| Payment dispute | `haulPayment.disputeReason` | **payment dispute** | dispute (bare), claim, chargeback |

## 5.6 The lint

`tools/check-guardrails.mjs` scans `apps/web/**/*.{ts,tsx}`, `packages/ui/**`, **`packages/contracts/**`**, and **`packages/services/**`**. The disclosure module and every service error message live in the last two — a guardrail that skips them has a hole exactly where the risk concentrates. Two legitimate uses of "subscription" (the fleet plan) are allowlisted by path, not by exempting whole packages.

Rules: banned custody words; banned fee synonyms; bare "dispute"; the exact string `confirmed by the host`; `audit trail`; money keys inside `termsSnapshot`; `fee|invoice` keys in any driver-facing serializer; direct assignment to `slot.status`; `suspend|penalt|ban` in driver-facing scheduling copy.

**Status labels are whitelisted, not proximity-matched.** The proposed "`payment` may never appear within 40 characters of `accepted`" rule fires on the project's own disclosure copy (*"payment {terms} after they accept delivery"* passes only on an inflection) and is evadable by any writer who conjugates differently. Instead: each status field declares its permitted user-visible label set in contracts, and the lint asserts no other string is rendered for that field. That is checkable and inflection-proof.

## 5.7 The six payment disclosures — verbatim

`packages/contracts/src/payment-disclosures.ts` exports one pure function per disclosure taking a typed context and returning a string. Copy in contracts, never inline in a component. Each renders at the moment named, not in a help page.

Placeholders: `{pay}` driver pay formatted · `{fee}` 5% of driver pay · `{host}` host organization name · `{terms}` the host's stated payment window · `{method}` payout method label · `{payee}` payee name.

**D1 — How much**
- Driver, on the slot detail before requesting:
  > "This load pays {pay}. That is the full amount — LogLoads takes nothing out of it."
- Host, on the publish form, live as the field changes:
  > "Driver pay is {pay}. Our platform fee is 5% — {fee} — charged to you on top. It is never taken out of driver pay."

**D2 — Who pays**
- Driver:
  > "{host} pays you directly. LogLoads is not a party to this payment and never handles the money."
- Host:
  > "You pay the driver directly. LogLoads does not collect, hold, or forward driver pay."

**D3 — When**
- Driver:
  > "{host} states payment {terms} after they accept delivery. That term is theirs, not a LogLoads guarantee."
- Host:
  > "You told drivers you pay {terms} after accepting delivery. This term appears on every slot in this series."

**D4 — How**
- Driver:
  > "{host} will pay you by {method}, using the payout details on your profile. Keep them current — LogLoads cannot route a payment for you."
- Host:
  > "Pay by {method} to the payout details {payee} provided, from your own account. LogLoads has no payment rails in this."

**D5 — Initiated and confirmed**
- Driver:
  > "{host} marks the payment sent. Only you can mark it received — nobody at {host}, and nobody at LogLoads, can mark it for you. If you were paid and {host} never marked it sent, you can still record that you received it."
- Host:
  > "You mark the payment sent. Only {payee} can mark it received; marking sent does not close the record, and LogLoads will not confirm it for you."

**D6 — When it goes wrong**
- Driver:
  > "If the money never arrives, or the amount is wrong, open a payment dispute. LogLoads records both accounts and can produce the record — LogLoads cannot recover the money for you and does not decide who is right."
- Host:
  > "If {payee} reports a problem, both accounts go on the record and the load stops generating a platform fee until it is resolved. If a payment stays unrecorded past your own stated terms, you cannot publish new loads until you record it. LogLoads records the disagreement; it does not decide it."

**The custody disclaimer** — one string, `PAYMENT_CUSTODY_DISCLAIMER`, rendered verbatim on the driver payout-details screen, the host payment screen, the payment-record view for both sides, and the Terms section in `apps/web/lib/v3-shared.ts`:

> "LogLoads never holds, moves, or has access to driver pay. Hosts pay drivers directly, by whatever method the two of them agree on. What you see here is a record both sides keep — it is not a payment, a guarantee of payment, or an account holding funds. LogLoads charges hosts a platform fee for completed loads; that is the only money LogLoads collects, and it is collected from hosts, never from drivers."

The Terms section and both footers must continue to state that LogLoads is not a party to the haul and does not broker freight. Nothing in the payment record, the fee ledger, or the invoice may describe LogLoads as arranging, procuring, or guaranteeing transportation.

---

# 6. PR sequence

Each PR is independently shippable and lands green on typecheck / unit / lint / guardrails / e2e. `main` auto-deploys to production, so each is written to be safe alone.

---

### PR-0 — Snapshot forward-compatibility · [no migration] · no dependencies
`parseRemoteRow` accepts `schemaVersion > OPERATING_STATE_SCHEMA_VERSION` when every `REQUIRED_TABLES` key validates (the migrator already handles the additive case). No version bump anywhere in this program; this PR only makes a future one survivable and makes the rolling-deploy window safe for everything that follows.

**Tests:** a snapshot at `CURRENT + 1` loads; a snapshot missing a required table still returns `null`; a snapshot at version 0 still returns `null`.

---

### PR-1 — Contracts foundation · [no migration] · needs PR-0
`billing-model.ts`, `billing-policy.ts`, `geo.ts` (haversine moved, `economics.ts:35` re-exports), `time-zones.ts`, `scheduling.ts`, `cancellation.ts`. Pure code only, no collection, no behaviour change, nothing wired.

**Tests:** invariants 1, 4, 21, 23 (§1.10); conflict-core tests 1–12 and 21–25 (§3.11); the enumerated one-row-per-reason-code table test.

---

### PR-2 — Route and machine hardening · [no migration] · needs PR-1
`createTruckSlot(state, context, input)` with org derivation from `loadPosting.companyId` and permission assertions; `GET /api/truck-slots` scoped; `releaseTruckSlotReservation` routed through `transitionTruckSlotStatus`, handling `filled → open`, scoped to the cancelling assignment id; the two `assignmentTransitions` maps collapsed to their intersection across all six call sites; the silent assignment-mirror skip replaced by `assertCondition`; the `reservedCount === count(active assignments)` end-of-mutator assertion; the `slot.status` direct-assignment lint. All of this is a strict security and correctness improvement to what exists today.

**Tests:** §3.11 #19, #33; a cancelled-then-replaced slot returns to `open` and is re-bookable; the collapsed map refuses `requested → accepted` and `accepted → loading`.

---

### PR-3 — Series, driver pay, time zones · **[snapshot migration]** · needs PR-2
Eleven collections registered in `types.ts` + `seedDatabaseState` + backfilled; money-collection parsing on read; `loadPosting.driverPayCents`/`hostPaymentTermsDays`/`seriesPlan`; `truckSlot.kind`/sequences/`driverPayCents`; `assignment.requestedDriverPayCents`/`agreedDriverPayCents`/reason code/`scheduleConfirmationState`; site `ianaTimeZone`/`operatingHoursLocal` (both null); slot generation from the series plan with `capacity: 1` per truckload; the 13:00–21:00Z hardcode deleted; `set_driver_pay`/`manage_load_slots` actions; the host "state your driver pay, terms, hours and zone to relist" surface. **Conflict annotation only, no gating.** Seed data gains one full series → payment → fee → invoice chain.

Legacy postings go non-requestable in this PR because they carry null pay — so the relist surface must be live in the same deploy, and the founder go/no-go on the dark window (§7) is a merge gate.

**Tests:** invariants 2, 20, 22, 23; §3.11 #21–25, #52, #53; `truckSlotSchema.parse({kind:"series_unit", capacity:2})` throws; a legacy `capacity: 3, reservedCount: 2` slot still parses untouched; series arithmetic accepts 3-then-2 over two days and refuses overlap beyond `concurrentTruckCapacity`.

---

### PR-4 — Conflict enforcement and the slot picker · [no migration] · needs PR-3
The shared checker called from request, approve, direct-offer claim, and every mutation that moves a resource (slot times, route, coordinates, `slotWindowMinutes`); the inline block at `~operating-network.ts:2889-2907` deleted; both availability auto-mints deleted; `availabilityMatchesLoad` rewired with `conflict`/`unconstrained`; the per-slot uniqueness re-scope at `:748-753`; `directOffer.truckSlotId` + `offeredDriverPayCents`; the **slot picker** with conflicting slots visible-and-disabled; structured 409 rejection carrying `SchedulingCheck`. Ships with `conflictCheck: "warn"`.

**Tests:** §3.11 #13–20; the annotation ⟺ gate sweep; a driver with zero availability windows still appears in matching and completes a booking end to end.

**Follow-on one-liner:** flip `conflictCheck` to `"enforce"` after one deploy, having read the would-have-blocked counts. Its e2e covers the picker-with-disabled-conflicting-slot path.

---

### PR-5 — Cancellation, incidents, sweeps · **[snapshot migration]** · needs PR-4
`vercel.json` with the hourly and daily crons; `/api/ops/sweep` behind a service token; the sweep installed inside the `mutateState` wrapper with `at` passed once and notifications flushed post-commit; required `cancellationReasonCode`; incident writing with discriminated deterministic ids that skip; the no-show producer with grace and host attestation; offer/request expiry materialization; host response and driver confirmation deadlines; `schedulingReliability` and the ladder implemented and off; reliability surfacing on `/host/reliability` and `/driver`.

**Tests:** §3.11 #26–51.

---

### PR-6 — Payout details and the payment record · **[snapshot migration]** · needs PR-5
`driverPayoutPreferences` (identity-gated writes) with the acceptance gate; `haulPayments` created at delivery recording with a snapshotted payee; `payAdjustments`; `record_haul_payment` / `confirm_haul_payment` / `report_payment_problem` actions and the payee binding; `submitHaulCompletion` progressing the trip in one mutation; the `disputed` reassertion fix; the delivery-dispute counter-figure requirement; the tightened cancellation guards; `reopenHaulCompletion`; the full §5.4 rename sweep including `settleHaulCompletion`'s "settled" string; `payment-disclosures.ts` D1–D6 and `PAYMENT_CUSTODY_DISCLAIMER` rendered at their six moments; the `payLabel` sweep at `network.ts:891`, `host-data.ts:133,253` (rate-card figures must stop rendering as driver pay); the guardrail lint additions. **No fee, no invoice, no charge — record-only.**

**Tests:** invariants 9, 10, 11, 12, 13, 21, 24; a host who never marks sent cannot freeze the driver's record; a driver confirming from `awaiting_payment` succeeds; a rebind after `marked_sent` does not change who may confirm; a short receipt lands in `receipt_short` and not `receipt_confirmed`; an identical resubmission out of `disputed` sets `submitted`; a delivered haul cannot be cancelled; the `confirmed by the host` string is absent tree-wide.

---

### PR-7 — Fee accrual · **[snapshot migration]** · needs PR-6 **and** a provisioned mail provider (§7)
`billingDisclosures` with provider receipts; the delivery-response and payment-receipt clocks; `host_did_not_respond` and `receipt_lapsed`; `billableCompletionAt`; `accruePlatformFee` as an idempotent upsert; slot billing status; `hostBillingProfiles` and `billingPeriods` created by the daily cron; the `publish_load` refusal on overdue payments; `host_payment_overdue` incidents. Fees **accrue** here; nothing is charged.

**Tests:** invariants 3, 5, 6, 7, 8, 13; deleting a disclosure row prevents both the lapse and the fee; a fee accrues exactly once across a full cancel-replace-complete sequence; a discretionary-only slot accrues nothing; re-entering accrual returns the same event without throwing; reverse-then-re-accrue yields one live event at `attempt: 1`; a `never_paid` reversal is terminal.

---

### PR-8 — Invoicing and the first host charge · **[snapshot migration]** · needs PR-7 **and** a Stripe host product (§7)
`platformInvoices`/`Lines`/`Credits`; `assertInvoiceBalances`; prorated minimum; derived credit remaining with clamped application; one org per CAS closure; period close; post-commit Stripe invoice creation keyed on `invoice.id`; the separate `applyFeeInvoiceUpdate` webhook path; one seeded platform organization and its ledger/credit admin surface; `manage_billing_profile` and host checkout; **`publish_load` gated on a payment method on file**; `apps/web/lib/plans.ts` "Free launch pilot" replaced with the real host price; the pricing page and the Terms fee section.

The copy sweep lands here and nowhere else: earlier is advertising a fee with no code path, later is charging against copy that promises free.

**Tests:** invariants 14, 15, 16, 17, 18; a forced CAS conflict during an invoice run produces exactly one Stripe call; an `invoice.payment_failed` on a fee invoice does not touch any `entitlement`; a carrier org with zero postings receives no invoice; a host joining on the 29th is charged a prorated minimum; two sequential reversals in one closed period credit `subtotal - minimumCents`.

---

# 7. Decisions that need the founder

Five. Everything else in this document is decided.

1. **Mail provider for LogLoads, on LogLoads' own account.** PR-7's lapse rungs cannot ship without a real out-of-band delivery receipt, and the machine-level Resend connector resolves to Explore & Earn — it must not be used. Needed: provisioning and a per-message budget. Until it exists, PR-7 ships with the lapse rungs implemented and **disabled**, meaning a fee accrues only on an explicit host acceptance plus an explicit driver confirmation. That is a smaller revenue surface, not a broken one.

2. **The host Stripe product.** There is no host product, no host price, and no host Stripe customer today — the webhook recognises only `product === "fleet_operations"`. Creating the product and price is an account-level action. Confirm: is the **$49 monthly minimum the host's entire recurring charge** (this spec assumes yes — hosts are billed on one LogLoads invoice, and the existing subscription/entitlement construct stays the *fleet/carrier* product and is never charged to a host for marketplace access), or is it additive to a separate host plan price?

3. **The dark window at PR-3.** Every currently open posting has null driver pay and goes non-requestable the moment PR-3 deploys, until each host restates pay, terms, hours and zone. That is the honest consequence of refusing to invent pay figures, and it is customer-visible. Go/no-go, plus whether hosts get advance notice before the merge.

4. **`hostPaymentTermsDays`** — default (proposed: 15) and maximum (proposed: 45). This number starts the non-payment clock that gates `publish_load`, so it is the one product number with teeth.

5. **Phase 1 counsel gate.** Nothing in this spec anticipates Stripe Connect: no `applicationFeeAmount`, `transferId`, `destinationAccountId`, or `connectedAccountId` field exists, and adding one now would let a UI advertise a rail that does not exist. When Phase 1 opens it is **direct charges only**, `application_fee_amount` always zero on driver payments, destination charges and separate-charges-and-transfers forbidden — and it needs counsel before a line is written.

**Accepted and monitored, not solved:** a host and driver who collude to keep a payment dispute open indefinitely avoid the fee. LogLoads does not adjudicate at MVP (R9) and will not build an adjudication process it cannot staff. Detection instead: posted-vs-confirmed divergence, per-host dispute rate, and per-host `awaiting_payment` age are surfaced on the platform ops view from PR-7. If the pattern appears in real traffic, that is the trigger to revisit — with data rather than a guess.

---
