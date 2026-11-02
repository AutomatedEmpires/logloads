# UX decisions (delegated)

> **Authority:** the founder delegated ownership of the open UX decisions to the UX agent on 2026-11-02 ("take ownership of what's needed; justify decisions"). Each decision below closes an item that was open in `01_AUDIT_AND_GAP_MATRIX.md` §1.3 or in the README.
> **Limits:** these decisions change UX behaviour, labels and validation only. None changes pricing, plan limits, the Blueprint, the founder decisions V2-DEC-01 to V2-DEC-03, or the database schema. Each one fits columns that already exist in `architecture/normalized-v2/01_schema.sql` (alignment branch). The coordinator records them in `docs/DECISIONS.md` and #114; the founder can reverse any of them.

| ID | Closes | Decision in one line |
|---|---|---|
| UX-DEC-01 | C5, C6, #135 | One status vocabulary; "filled" is shown as the poster's report, never as a verified fact |
| UX-DEC-02 | C8, #128 | Publishing requires a start date and either an end (date or duration) or an explicit "Ongoing" |
| UX-DEC-03 | C9, #128 | Product is chosen from a controlled list (plus "Other, describe") and is required to publish |
| UX-DEC-04 | C10, #128 | First contact is always through LogLoads messages; public listings never show phone or email |
| UX-DEC-05 | C4 | Access is by organization role on every plan; Pro and Regional get per-landing views, not per-landing permissions |
| UX-DEC-06 | Gate 5, #150 | Verification marks come from typed verification records and name their type, source and date |
| UX-DEC-07 | #138 | Prototype evaluation runs inside the research interviews (#119), not as a separate study |

---

## UX-DEC-01: Status vocabulary

**Interest** (stored `submitted | viewed | replied | declined | withdrawn`, unchanged):

| Stored | Turn (derived from the side of the last message) | Hauler sees | Landing queue | Landing sees |
|---|---|---|---|---|
| submitted | — | Sent · waiting for the landing | New | New |
| viewed | — | Seen by the landing | New, with a "Seen" marker | Seen · not answered |
| replied | landing spoke last | Your turn | Replied | Waiting for the hauler |
| replied | hauler spoke last | Waiting for the landing | New | Hauler replied |
| declined | — | Declined by the landing | Closed | Declined |
| withdrawn | — | Withdrawn by you | Closed | Withdrawn by the hauler |

**Job** (stored `draft | active | paused | filled | closed | expired`, unchanged):

| Stored | Public label | Accepts interest |
|---|---|---|
| draft | not public; "Draft" to the poster | — |
| active | Accepting interest | yes |
| paused | Paused by the poster | no |
| filled | Not accepting interest · poster reports enough trucks | no |
| closed | Closed by the poster | no |
| expired | Listing expired | no |

**Why:**
- The spec has three incompatible queue lists (§4.7, §5.5, §8.22), and "Waiting" is never defined. This mapping covers every stored status with no schema change.
- "Viewed" stays in New because the code currently moves a merely viewed inquiry into Responded (`landingInterestQueue`, audit P1-6). That would hide work nobody has answered.
- Spec §4.6 forbids presenting "slots filled" as verified, but `filled` exists in the schema. Labelling it as the poster's report keeps the data and the truth.

**Applies to:** `MARKETPLACE_INTEREST_STATUS_LABELS`, `landingInterestQueue`, `JOB_STATUS_LABELS` (#135, integration lane) and the `AvailabilityStatus`, `InquiryRow` and `JobResultRow` copy (#147).

## UX-DEC-02: Work timing

- **Publish requires** `work_starts_on`, plus exactly one of an end date (`work_ends_on`), a duration in days (`duration_days`), or an explicit **Ongoing** choice. Drafts may omit all of these.
- On a published job, Ongoing is stored as both end fields null. Publish validation guarantees that null was chosen, not forgotten. It displays as "Ongoing from Nov 6".
- The "start window" ("between Nov 8 and Nov 15") in earlier wireframes is **dropped**.

**Why:**
- Spec §4.5 and §8.21 require start timing and "duration or ongoing status". Today the draft schema makes start optional (`marketplace-job-draft.ts:60`), so a hauler can't tell when work begins.
- The schema stores a work *period* (start to end), not a start *window*. Showing a window would need a new column and would blur the meaning of "end".
- Requiring an explicit Ongoing removes the ambiguity between "runs indefinitely" and "the poster didn't say".

**Applies to:** the draft schema and publish validation (#105 and #128, Codex), and the editor step "Pay and schedule".

## UX-DEC-03: Product type

- A controlled list, stored in the existing `job_postings.product` text column:

  **Saw logs · Pulpwood · Poles and pilings · Chips · Hog fuel and biomass · Hardwood logs · Other (describe, up to 120 characters)**

- Required to publish. "Other" text goes through the existing sensitive-text rule and the moderation queue.

**Why:**
- Spec §8.21 calls for product "from a controlled taxonomy", and §5.2 needs product as a filter. Free text (today's draft) can't be filtered reliably.
- It covers the spec's examples (saw logs, pulpwood, poles), the chip work already in the pilot (chip truck and chip van equipment), and two common timber-haul products (hog fuel and biomass, hardwood logs). It uses the column that exists, so there's no migration. "Other" keeps real but unusual work postable, and its use in pilots shows whether the list needs to change.
- The list belongs in `packages/contracts` next to `MARKETPLACE_EQUIPMENT_TYPES`, so filters and the editor share one source.

**Applies to:** contracts (integration), the draft schema (#105 and #128), the filter options (#129) and the editor.

## UX-DEC-04: Contact route

- Every job's first-contact route is **LogLoads messages**, through the expression-of-interest thread. That satisfies the spec's required "contact route" with no extra field.
- Public listings and public profiles never show a phone number or email address.
- Inside a conversation, either party may choose to share direct contact details in a message. The UI says that this shares them with that business only.
- A per-job alternative route (for example "call this number") is **deferred** until the security review (#106) confirms how to show it without exposing it to scraping.

**Why:**
- Spec §4.5 and §8.21 require a contact route, which the in-app thread already provides for every job.
- `AGENTS.md` §7.4 and spec §10.28 protect private contacts and guard against scraping, and spec §14 leaves contact visibility open for privacy review.
- `job_postings` has no contact column, so a phone option would need a schema change and a privacy decision this lane shouldn't make alone.

**Applies to:** the job editor (no contact field; a short line explains the route), JobDetail copy and the MessageComposer hint.

## UX-DEC-05: Staff access scope

- On **all plans**, access follows the organization role (owner, manager, staff), as in spec §2.4.
- **Pro and Regional** add per-landing *views*: filters, and "assigned to me" or "assigned landing" groupings in the inbox and job list (`multi_landing_inbox`, already in `LANDING_PLAN_FEATURES`). These are not per-landing *permissions*.
- Per-landing permission scoping is **NEXT**. It needs a schema proposal and a security review before it is built.

**Why:**
- The schema has no landing-scoped membership grant. Adding one is a tenant-isolation change that belongs with the database and security lanes, not a UX label.
- Basic has one active landing, so scoping there would add UI that does nothing.
- Spec §2.4 says the permission matrix "requires testing before launch". Shipping views first lets pilots show whether foremen need hard limits.

**Applies to:** AppShell navigation (no landing-permission UI), the inbox and job filters on Pro and above (#132, #147), and plan copy.

## UX-DEC-06: Verification labels

- A mark is rendered only from a verification record with `status = verified`, a current `expiresAt` (or none), and a known `verificationType`.
- The label names the type and the source: organization → "Business identity reviewed by LogLoads"; identity → "Owner identity reviewed by LogLoads"; `insurance_document` → "Insurance document reviewed by LogLoads". It is followed by the `verifiedAt` month ("· Oct 2026").
- `self_reported` records never produce a mark. An organization whose status is `verified` but has no matching current record gets **no** mark.
- A public profile lists each mark separately, plus what was not checked (insurance, operating authority, equipment), as in the design reference.

**Why:**
- The founder requires labels that name the actual scope (#116), and spec §7.2 and §8.17 require scope-specific badges.
- The pilot already stores what the label needs: `verificationType`, `source`, `evidenceSummary`, `verifiedAt` and `expiresAt` (`packages/contracts/src/production-network.ts:70-93`). The organization "verified" status is the result of a `platform_review` of an `organization` record (`packages/services/src/admin.ts:455-470`).
- So a truthful label needs a mapping, not new data. "Reviewed by LogLoads" says who checked without claiming more than a staff review.

**Applies to:** #150 (contract field and mapping, integration) and `VerificationIndicator` (#147).

## UX-DEC-07: Evaluating the prototype

- The prototype tasks run as a 15-minute segment inside the planned discovery interviews (#119: 12–15 landing operators, 15–20 haulers), using the final review page.
- The UX lane owns the task script and the analysis. The research lane owns recruiting and consent.

**Why:** it reaches the same participants without a second outreach, it doesn't delay #144–#147, and it produces real evidence before page migrations (#147) lock in layouts. Nothing is called validated until those sessions report (spec and `04_EVALUATION_PLAN.md`).

---

## Deliberately not taken

- **#144–#147 implementation:** the Codex owner holds the scoped `packages/ui` grant, and I am the reviewer for the adoption gates. Implementing them myself would duplicate assigned work and mean reviewing my own code.
- **Spec v1.1 formatting fixes (F1–F5):** formatting only, with no behaviour impact, and the root spec file sits outside this lane. They are left for the document owner.
- **Contract and validation code for UX-DEC-01 to 04 and 06:** those files belong to the integration and V2 lanes. The decisions are written so their owners can implement them without further design input.
