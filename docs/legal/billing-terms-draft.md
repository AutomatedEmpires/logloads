# LogLoads billing terms: draft for counsel

> **Status:** TARGET. A draft for licensed counsel, written for
> [#345](https://github.com/AutomatedEmpires/logloads/issues/345) on 2026-11-18 against `work/logloads-repair` at
> `cb16e3d`, and revised the same day for [#409](https://github.com/AutomatedEmpires/logloads/issues/409), the
> review of PR 399: the checkout now describes a founding offer the business holds, and the limit is worded as the
> store counts it. **This is not legal advice.** An AI agent (Claude) wrote it from the
> [November 2026 legal review](./2026-11-legal-review.md). No attorney has reviewed it, and nobody has an
> attorney-client relationship with its author. **Billing is not open.** Nothing here is published, offered or
> switched on. No plan, boost or founding offer can be bought, and no Stripe product, price, tax setting or checkout
> exists for them ([`ACTIVATION_STRIPE.md`](../ACTIVATION_STRIPE.md) §5).

## 1. What this is

This is the billing item on the legal review's P0 list (item 20, risk R9), due before gate D, the first payment. It
has five parts:

1. Draft text for section 11 of the Terms of Service, "Plans and billing" (§2). The review's Terms outline left
   that section as a placeholder for counsel (§8.1, section 11). The text answers the review's question 7.
2. The founding offer: its terms and what the offer page and the checkout must disclose (§3), for question 4.
3. The checkout disclosures, in the order the checkout shows them (§4).
   `packages/contracts/src/v2/billing/disclosures.ts` builds them.
4. Sales-tax questions for an accountant, Washington and Texas first (§5).
5. Questions for counsel (§6) and the gate D checklist (§7).

**Markers.** Every term that is not already decided carries one marker.

| Marker | Meaning |
|---|---|
| **[Proposed]** | A value or rule this draft proposes. The lead confirms it, or the founder where it is commercial, before gate D. |
| **[Founder]** | A commercial term the founder sets. The founding offer's terms are deferred to the founder, by 2026-11-24 (COM-1). |
| **[Counsel]** | A question licensed counsel answers before gate D. |

**What it relies on.**

- The legal review: §10 questions 1, 4 and 7; the Terms outline in §8.1; the sales-tax note in §9.4.
- [`DECISIONS.md`](../DECISIONS.md): F5 (when a founding cycle counts), F6 (invitations on a plan change), F7 (no
  pausing; `paused` and `unpaid` grant nothing), COM-1 (the open basin and the qualifying landing), COM-2 (what
  pilot landings may be told) and ATT-2 (how an attestation is stored).
- [The Blueprint](../product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) §3.1, §6.2, §7, §8.1, §10.3 and §16.2, and
  [the UX spec](../product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md) §2.5, §4.12, §9.12 and §9.15.
- What the store does today: `architecture/normalized-v2/12_v2_billing_events.sql` (the grace window and when a
  founding cycle is counted), `architecture/normalized-v2/01_schema.sql` (`past_due_grace_days`, 7 by default),
  `architecture/normalized-v2/03_entitlements.sql` (`admin_grant_founding_promotion`: who is granted the founding
  offer, and how its places are counted) and `architecture/normalized-v2/26_v2_team_seats_saved_jobs_outbox.sql`
  (`apply_subscription_cycle`: how a grant is attached to a subscription).

**Prices are not restated here.** The plan and boost prices are in Blueprint §3.1 and §7.1 and, in code, only in
`packages/contracts/src/membership.ts`. The disclosures read them from there. The examples in §4 are the Basic plan
as the builders word it today.

**No percentage fee.** LogLoads charges no per-load, percentage or transaction fee, and takes nothing from driver
pay. The retired percentage fee accrues nothing new ([#319](https://github.com/AutomatedEmpires/logloads/issues/319),
[PR #354](https://github.com/AutomatedEmpires/logloads/pull/354)). Nothing in these terms brings it back.

## 2. Draft Terms section 11: Plans and billing

This is the text a landing business would read. "You" is the business that subscribes. "We" is LogLoads.

**11.1 Who pays.** Landing businesses pay for a landing plan and, if they choose, for boosts. Haulers and fleets pay
nothing: finding work, listing trucks and messaging landings will not cost them anything. LogLoads charges no
per-load, percentage or transaction fee and takes nothing from driver pay.

**11.2 Plans, prices and taxes.** The plans, what each one includes and its monthly price are on the pricing page
and at checkout. Prices are in US dollars, plus applicable taxes, which we add to each charge and show on its
invoice. **[Counsel]** Is a price shown without tax acceptable in every state we sell in (§5, G8)?

**11.3 Automatic renewal and the billing day.** A plan is billed monthly, in advance. Your first charge is on the
day you subscribe, and that day of the month becomes your billing day. In a shorter month you are billed on its last
day. **Your plan renews automatically each month, at the price shown at checkout, until you cancel.** We ask you to
agree to the renewal at checkout, and we email you a confirmation with these terms and how to cancel.

**11.4 Price changes.** We tell you about a price change by email and in Billing at least **[Proposed] 30 days**
before the new price applies to you. You can cancel before then. **[Founder]** Does a price change during the
founding cycles change the founding price (§3, F-5)?

**11.5 Upgrades.** An upgrade takes effect at once. You pay a prorated charge for the rest of the current billing
cycle, and we show you the amount before you confirm. **[Proposed]**

**11.6 Downgrades.** A downgrade takes effect at your next renewal. There is no refund for the current billing
cycle. If you then have more active landings or team members than the new plan allows, nothing is deleted and nobody
is removed. Until you are back within the plan, you can't start a landing, publish a job or send an invitation, and
while you have too many team members you can't add one. **[Proposed]** for the timing. The over-plan rule is what the
store does today (UX spec §9.15; `MarketplaceOverCapStateView` in `packages/contracts/src/v2/billing/index.ts`).

**11.7 Targeted invitations on a plan change.** Invitations belong to the billing cycle. A plan change moves the
current cycle's allowance to the new plan's number. Invitations already sent still count, and what is left never
drops below zero. A new cycle starts with none used. Unused invitations don't roll over and are never refunded or
credited (F6).

**11.8 Failed payments, the grace period and unpaid plans.** If a payment fails, we try it again up to
**[Proposed] 4 times** within **[Proposed] 7 days**, and your plan keeps working during those days. If the payment
still hasn't gone through, your plan becomes unpaid: its features stop (F7), and your jobs are unpublished, not
deleted. We keep your business's data for **[Proposed] 90 days** so you can come back. Paying restores the plan, and
you then reactivate your landings and publish your jobs again. After the 90 days, we keep or delete the data as the
Privacy Policy's retention schedule says (legal review §6.4). **[Founder]** The retry count, the grace period and the
90 days are published terms (Blueprint §16.2, F7). Whatever is chosen must equal the payment provider's retry
setting and the store's `past_due_grace_days`, which is 7 by default.

**11.9 No pausing.** LogLoads does not offer pausing a plan. To stop paying, cancel. If our payment provider ever
reports a plan as paused, it grants nothing, like an unpaid plan (F7).

**11.10 Cancelling.** You can cancel online at any time in Billing, in no more steps than it took to subscribe.
Cancelling stops the next renewal. Your plan stays active until the end of the billing cycle you paid for. Then it
ends: your jobs are unpublished, not deleted, and your account stays open so you can subscribe again. We confirm the
cancellation by email.

**11.11 Refunds.** We don't refund part of a billing cycle, or a boost that has started, unless the law requires it
or 11.12 says so. If we charged you by mistake, we refund that charge. Ask about a refund at the billing contact,
**[Founder]** an address to be named before gate D. **[Counsel]** Does any basin state require a prorated refund on
cancellation?

**11.12 Boosts.** A boost is a one-time charge, plus applicable taxes, for one job. It never renews. It shows that
job as Sponsored to haulers within about 100 straight-line miles of the job's public landing area, for the
package's number of consecutive days (Blueprint §7.1), from the moment the payment goes through. A boost buys
placement only. It does not promise views, inquiries, trucks or hires, and it adds no targeted invitations. If the
job is paused, filled or removed, the boost ends early and does not restart. **[Founder]** Are the unused days then
refunded pro rata, or not refunded (Blueprint §7.5)? If we remove the job for breaking the Posting Rules, no refund
is due either way. A boost does not lift a moderation hold or a suspension. The founding offer does not discount
boosts (Blueprint §8.1).

**11.13 The founding offer.** If your business has the founding offer, the terms shown on the offer page and at
checkout (§3) apply alongside this section.

**11.14 Suspension.** If we suspend or close your account for breaking the Terms, your plan stops renewing and no
refund is due for the current billing cycle or for a boost. **[Proposed]** **[Counsel]** Is that enforceable in our
states, and is a refund due when we close an account without a breach?

**11.15 Disputed charges.** If a charge looks wrong, contact us first at the billing contact. If you dispute it with
your card issuer instead, the disputed billing cycle counts as unpaid until the dispute is closed, as with a failed
payment (11.8). If the dispute is decided for you, that cycle stays unpaid. If it is decided for us, it counts as
paid. **[Proposed]** The store records no disputes yet. This rule has to be built before gate D (§7).

**11.16 Receipts and records.** We email a receipt for every charge, and Billing lists your invoices. You agree to
receive billing records electronically (Terms section 20). We keep billing records as the Privacy Policy's retention
schedule says.

**11.17 Changes to these billing terms.** Each version has a version id and an effective date. For a material
change, we tell you by email and in the product at least 30 days ahead, and we ask you to accept the new version at
your next sign-in (legal review §8.1, section 4). A change never applies to a billing cycle you have already paid
for.

**11.18 Business customers.** These plans are sold to businesses. We still follow the consumer rules for automatic
renewal: clear terms before payment, express consent, a confirmation, online cancellation and reminders. The federal
Act is not limited to consumers in its text (legal review §10, question 4).

### Question 7, item by item

| Q7 item | Clause | Checkout statement | State |
|---|---|---|---|
| 1. Billing date; renews until cancelled | 11.3 | `renewal`, `billingDay` | **[Proposed]** |
| 2. Price, tax, notice of a price change | 11.2, 11.4 | `price`, `taxes`, `priceChange` | Notice: **[Proposed]** 30 days |
| 3. Upgrade, prorated, shown before confirming | 11.5 | `upgrade` | **[Proposed]** |
| 4. Downgrade at renewal; landings and seats over the limit | 11.6 | `downgrade` | Timing **[Proposed]**; the over-plan rule is the store's |
| 5. Invitations on a plan change | 11.7 | `invitations` | Decided: F6 |
| 6. Failed payment, retries, grace, unpaid | 11.8 | `failedPayment` | **[Proposed]** 4 retries, 7 days, 90 days; **[Founder]** confirms |
| 7. Paused | 11.9 | `noPause` | Decided: F7 |
| 8. Cancellation at the end of the paid period | 11.10 | `cancellation` | **[Proposed]** |
| 9. Refunds | 11.11 | `refunds` | **[Proposed]**; **[Founder]** billing contact |
| 10. Boosts | 11.12 | `boostCheckoutDisclosure` | **[Founder]** unused days |
| 11. Suspension | 11.14 | `suspension` | **[Proposed]**, **[Counsel]** |
| 12. Disputed charges | 11.15 | `disputes` | **[Proposed]**, not built |

## 3. The founding offer

**It stays disabled.** COM-1 left three commercial terms to the founder, by 2026-11-24: the cohort unit (the lead
proposes the first 10 qualifying landing organizations per open basin), the eligibility window, and whether 50% for
six paid cycles still stands. Under COM-2, pilot landings may not be promised the offer. The builders take every
offer term as an input (`FoundingOfferDisclosureTerms`, `HeldFoundingOfferDisclosureTerms`), so the words follow
the founder's decision with no change to the code.

**How the store runs the offer today.** The words state these rules, because the store, not the page, decides who
gets the offer and what they pay (#409).

- **Only a billing admin grants it** (`admin_grant_founding_promotion`, `03_entitlements.sql`). The business must be
  active and business-verified, and its `home_state` must equal the promotion's `state_code`. Where its landings are
  does not matter, and there is no basin in the rule. The promotion must be open and have fewer unrevoked grants
  than its `max_redemptions`. **A grant takes a place before the business subscribes**: the store counts grants, not
  subscriptions.
- **A checkout never takes up an open offer.** When a subscription turns active, the store attaches any grant of the
  business that has cycles left (`apply_subscription_cycle`, `26_v2_team_seats_saved_jobs_outbox.sql`). It checks
  neither the places left nor the closing date then. So a business keeps its offer after the last place is granted
  and after the offer closes. One that cancels and subscribes again gets the cycles it had left.
- **Nothing ends an offer early.** No store function sets a redemption to `revoked`.

**Where it is shown.** Two builders, one for each side of the grant:

- **The offer page**, to a business that does not have the offer: `foundingOfferDisclosure`. It takes today's date,
  and refuses an offer with no place left or with a closing date before today.
- **The checkout**, to a business that holds the offer: `heldFoundingOfferDisclosure`, which
  `landingPlanCheckoutDisclosure` calls. It takes the cycles the business has left, never the places or the closing
  date, so it does not refuse a granted business once the offer is full or closed. Its statements come first and the
  plan's follow (§4).

| # | Question 4 item | What the disclosure says | Statement | Source |
|---|---|---|---|---|
| 1 | Who qualifies | Offer page: a landing business with a current business identity review by LogLoads and the promotion's state as the home state on its LogLoads account. One offer per legal organization, however many accounts it has. Checkout: LogLoads has granted the offer to the business. | `qualifier`; at checkout `held` | Decided: COM-1, UX-DEC-06. The store's `home_state` match |
| 2 | The limit and how it is counted | Offer page only: "LogLoads grants the offer to no more than N qualifying landing businesses whose home state is" the state. A place is taken at the grant, not when the business subscribes. The places left, as the store counts them when the page is shown. A business that holds the offer has its place, so the checkout states no limit. | `limit` | **[Founder]** N and the state. A basin needs a store change (F-1, §7) |
| 3 | The discount and the base price | The founding price and the plan's own price, each followed by "plus applicable taxes", and the percentage off. A taxes line follows: the offer page's own, and the plan's at checkout. | `price`, `taxes` | **[Founder]** the percentage. Prices from `LANDING_PLANS` |
| 4 | How long, and what counts as a cycle | Offer page: the first N paid monthly billing cycles. Checkout: the cycles left, and how many are used ("your next 4 ... You have used 2 of your 6 founding cycles"). A cycle counts once its payment goes through, so a failed payment does not use one up. | `duration` | Decided: F5. **[Founder]** N |
| 5 | What happens next | The plan renews automatically at the full price until cancelled. At checkout: the date of the first full-price charge, counted from the cycles left. On the offer page: which charge it is. | `renewal` | 15 U.S.C. 8403 |
| 6 | How to cancel | Online, at any time, in Billing, in no more steps than subscribing. Active to the end of the paid cycle. | `cancellation` | **[Proposed]** |
| 7 | A reminder before the discount ends | An email N days before the first full-price charge, with the price and the date. N is 7 to 21, and everyone gets it. | `reminder` | **[Proposed]** 14 days. Cal. Bus. & Prof. Code 17602 |
| 8 | Plan change, failed payment, cancellation; can it be regained | A plan change keeps the discount on the new plan's price for the cycles left and uses no cycle. A failed payment uses no cycle. After cancelling, the cycles left resume or the offer ends. | `planChange`, `duration`, `cancellation` | Decided: F5. **[Founder]** after cancelling |
| 9 | When it closes; no transfer, no combining | Offer page: closes to new businesses when the places are taken, or on a date if one is set, and closing does not end the offer for a business that already has it. Checkout: closing does not end the business's offer. Both: cannot be transferred or combined with any other discount, and does not apply to boosts. | `closing`; at checkout `held` | **[Founder]** a closing date. Blueprint §8.1 for boosts |
| 10 | No "lifetime", "locked" or "guaranteed" | No statement uses those words or "forever". The builders refuse them in every text input, and a test checks every statement. | all | Question 4, item 10 |
| — | What ends it | The founding price ends after the last founding cycle. No early end is stated, because nothing in the store ends an offer early (§7). | `ending` | The store today |

**The returning business** (the review of PR 399). An offer of 6 cycles, 2 of them paid, then a cancel, then a
new subscription on 2027-03-10. The store has 4 cycles left, so its charges on 2027-03-10, 04-10, 05-10 and 06-10
are at the founding price, and the first full-price charge is on **July 10, 2027**. The checkout says "your next 4
paid monthly billing cycles" and "July 10, 2027". Before #409 it said "your first 6" and September 10, 2027.

**Questions for the founder.**

- **F-1. The cohort.** Its unit and size. The lead's proposal is the first 10 qualifying landing organizations per
  open basin. The store today counts grants per promotion, matched to the business's home state. A basin, or a
  limit counted by subscriptions, needs a store change before gate D (§7).
- **F-2. The discount.** Whether 50% for six paid monthly cycles still stands (Blueprint §8.1).
- **F-3. The window.** A closing date, or only the place limit.
- **F-4. After cancelling.** Do the cycles left resume if the business subscribes again (`cycles_resume`), or does
  the offer end (`offer_ends`)? The store resumes them today: `apply_subscription_cycle` attaches any founding
  redemption with cycles left whenever a subscription turns active. Choosing `offer_ends` needs a store change
  before gate D.
- **F-5. A price change during the founding cycles.** The offer is a percentage off the plan's price, and the read
  model (`marketplaceFoundingOfferSummary`) takes it off the plan's price as it stands. So a new plan price would
  change the founding price too. Keep that and disclose it, or hold the founding price for the cycles left?
- **F-6. The reminder.** 14 days before the first full-price charge is proposed. Any number from 7 to 21 fits the
  review.

## 4. The checkout disclosures

`packages/contracts/src/v2/billing/disclosures.ts` builds every statement from the rules above. It reads each price
from `LANDING_PLANS` or `BOOST_PACKAGES` by code and types none. Every price is followed at once by "plus applicable
taxes", the founding price as well as the full price, and a test counts the prices against the tax words in every
line. It takes the offer terms and the billing settings as inputs, and it refuses a value it cannot state
truthfully: on the offer page, an offer with no places left or a closing date before today; at checkout, cycles left
outside 1 to the offer's cycles; anywhere, a discount of 0 or 100 percent, a state code that is not a US state, or a
contact that promises anything lifetime, locked or guaranteed. A held offer is never refused for being full or
closed. Every result carries `version: "billing-disclosures-draft-2026-11-18-r2"` and `counselApproved: false`.

| Builder | For | Answers |
|---|---|---|
| `foundingOfferDisclosure` | The offer page, with today's date, for a business without the offer | Question 4 |
| `heldFoundingOfferDisclosure` | The checkout of a business that holds the offer, with its cycles left | Question 4 |
| `landingPlanCheckoutDisclosure` | A plan checkout, with or without a held founding offer | Question 7, items 1 to 9, 11 and 12 |
| `boostCheckoutDisclosure` | A boost checkout | Question 7, item 10 |

**What the checkout must do with them** (to build before gate D):

1. Show every statement in `lines`, in order, before payment details are taken. The renewal statement sits next to
   the button that confirms, not behind a link. With the founding offer, so do its `price` and `renewal`. Pass the
   held offer's terms from its promotion and its cycles left from the store
   (`MarketplaceFoundingOfferSummaryView.cyclesRemaining`), so the dates match what the store will charge. With no
   cycles left, pass no founding offer.
2. Get express consent to the renewal. **[Counsel]** Is a button that names the renewal enough ("Subscribe at the
   price shown, renewing monthly until you cancel"), or is an unticked box also needed?
3. Record with the subscription the user, the time, the version and the lines shown, as ATT-2 does for the publish
   attestation.
4. Email a confirmation after the purchase with the same terms, how to cancel and the billing contact. **[Counsel]**
   Confirm this meets Cal. Bus. & Prof. Code 17602.
5. Email the reminder before the founding price ends to every founding business.
6. Cancel online in Billing, in no more steps than subscribing.
7. Never show a disclosure as approved terms while `counselApproved` is `false`. A version counsel signs off gets a
   new version id.

Nothing in the builders opens a checkout. Billing stays dark until the founder's separate live-money decision
([`ACTIVATION_STRIPE.md`](../ACTIVATION_STRIPE.md) §5).

The examples are the Basic plan as the builders word it today. The inputs are placeholders: 50% for 6 paid cycles as
Blueprint §8.1 states it, a promotion for Oregon (`OR`) limited to 10 grants with 4 places left, the [Proposed]
billing values, and `billing@example.test` as the contact. Pro and Regional differ only in the plan's name and
price.

### Example: the founding-offer page

Shown on 2026-11-18, to a business that does not have the offer.

1. Who qualifies: a landing business with a current business identity review by LogLoads and Oregon as the home
   state on its LogLoads account. Each legal organization can get one founding offer, however many accounts it has.
2. Limit: LogLoads grants the offer to no more than 10 qualifying landing businesses whose home state is Oregon. A
   place is taken when LogLoads grants the offer, not when the business subscribes. 4 of the 10 places are left.
3. Price: the Basic plan at $74.50 per month, plus applicable taxes, instead of $149 per month, plus applicable
   taxes. That is 50% off.
4. Prices are plus applicable taxes. Any tax is added to the charge and shown on its invoice.
5. How long: your first 6 paid monthly billing cycles. A cycle counts only once its payment goes through, so a
   failed payment does not use one up.
6. What happens next: after those 6 cycles, your Basic plan renews automatically at the full price of $149 per
   month, plus applicable taxes, each month until you cancel. Your first full-price charge is your 7th monthly
   charge, if each payment before it goes through.
7. If you change plans: the discount applies to the new plan's price for the cycles you have left, and the change
   does not use one up.
8. How to cancel: online, at any time, in Billing, in no more steps than it took to subscribe. Your plan stays
   active until the end of the billing cycle you paid for. If you subscribe again later, the founding price applies
   to the cycles you had left.
9. Reminder: we email you 14 days before your first full-price charge, with the full price and the date.
10. The founding price ends after your 6th paid monthly billing cycle.
11. The offer closes to new businesses when all 10 places are taken. Closing does not end the offer for a business
    that already has it. It can't be transferred to another business or combined with any other discount, and it
    does not apply to boosts.

With a closing date, item 11 reads "when all 10 places are taken or on March 31, 2027, whichever comes first". From
April 1, 2027 the page is refused, because the offer has closed.

### Example: the Basic plan checkout with a held founding offer

A business granted the offer checks out for the first time, with its first charge on 2026-12-18. It gets the same
lines if it was granted the 10th place, or if the offer has closed since its grant.

1. Founding offer: LogLoads has granted it to your business, and the offer closing to other businesses does not end
   yours. It can't be transferred to another business or combined with any other discount, and it does not apply to
   boosts.
2. Price: the Basic plan at $74.50 per month, plus applicable taxes, instead of $149 per month, plus applicable
   taxes. That is 50% off.
3. How long: your first 6 paid monthly billing cycles. A cycle counts only once its payment goes through, so a
   failed payment does not use one up.
4. What happens next: after those 6 cycles, your Basic plan renews automatically at the full price of $149 per
   month, plus applicable taxes, each month until you cancel. Your first full-price charge is on June 18, 2027, if
   each payment before then goes through.
5. If you change plans: the discount applies to the new plan's price for the cycles you have left, and the change
   does not use one up.
6. How to cancel: online, at any time, in Billing, in no more steps than it took to subscribe. Your plan stays
   active until the end of the billing cycle you paid for. If you subscribe again later, the founding price applies
   to the cycles you had left.
7. Reminder: we email you 14 days before your first full-price charge, with the full price and the date.
8. The founding price ends after your 6th paid monthly billing cycle.
9. You are billed on the 18th of each month.
10. Prices are plus applicable taxes. Any tax is added to the charge and shown on its invoice.
11. If the price changes, we email you at least 30 days before the new price applies, and you can cancel before
    then.
12. Upgrading takes effect at once. You pay a prorated charge for the rest of the current billing cycle, and you see
    the amount before you confirm.
13. Downgrading takes effect at your next renewal, with no refund for the current billing cycle. If you then have
    more active landings or team members than the new plan allows, nothing is deleted and nobody is removed. Until
    you are back within the plan, you can't start a landing, publish a job or send an invitation, and while you have
    too many team members you can't add one.
14. Targeted invitations belong to the billing cycle. A plan change moves this cycle's allowance to the new plan's
    number, and invitations you already sent still count. Unused invitations don't roll over.
15. If a payment fails, we try it again up to 4 times within 7 days, and your plan keeps working meanwhile. If it
    still hasn't gone through after 7 days, your plan stops: your jobs are unpublished, not deleted, and we keep
    your data for 90 days. Paying restores the plan, and you can then reactivate your landings and publish your jobs
    again.
16. LogLoads doesn't offer pausing a plan. To stop paying, cancel.
17. We don't refund part of a billing cycle unless the law requires it. If we charged you by mistake, we refund that
    charge. Ask about a refund at billing@example.test.
18. If we suspend your account for breaking the Terms, your plan stops renewing and no refund is due for the current
    billing cycle.
19. If a charge looks wrong, contact us first at billing@example.test. If you dispute it with your card issuer
    instead, the disputed billing cycle counts as unpaid until the dispute is closed.

**The returning business** (§3): 2 of 6 cycles paid, then a new subscription on 2027-03-10. Items 3, 4 and 8
become:

- **Item 3:** How long: your next 4 paid monthly billing cycles. You have used 2 of your 6 founding cycles, and 4
  are left. A cycle counts only once its payment goes through, so a failed payment does not use one up.
- **Item 4:** What happens next: after those 4 cycles, your Basic plan renews automatically at the full price of
  $149 per month, plus applicable taxes, each month until you cancel. Your first full-price charge is on July 10,
  2027, if each payment before then goes through.
- **Item 8:** The founding price ends after your 6th founding cycle in all, which is the 4th paid monthly billing
  cycle from this checkout.

Item 9 becomes "You are billed on the 10th of each month."

Without the founding offer, items 1 to 8 are replaced by three plan statements: the renewal at the full price from
the first charge ("Your Basic plan renews automatically at $149 per month, plus applicable taxes, each month until
you cancel. Your first charge is on December 18, 2026."), the price ("Price: $149 per month, plus applicable taxes,
for the Basic plan."), and how to cancel.

### Example: a Quick Boost

1. Quick Boost: $99, a one-time charge, plus applicable taxes. It never renews.
2. It shows one job as Sponsored to haulers within about 100 miles of the job's public landing area, for 7
   consecutive days from the moment your payment goes through.
3. A boost buys placement only. It does not promise views, inquiries, trucks or hires, and it adds no targeted
   invitations.
4. If the job is paused, filled or removed, the boost ends early and does not restart. Unused days are not
   refunded. (Or, if the founder chooses: "We refund the unused days, pro rata.")
5. The founding offer does not discount boosts.

## 5. Sales tax: questions for the accountant

LogLoads collects no sales tax, holds no tax registration and uses no tax software. Stripe Tax is not set up, and
this draft does not set it up. The legal review notes that several states tax software subscriptions, Washington and
Texas among them (§9.4), and that the operating company's state of formation and tax position are not known (§1).
Every public price says "plus applicable taxes". These answers are needed before gate D.

**What LogLoads would sell.**

- **A landing plan.** A monthly subscription to an online service. A landing business posts hauling jobs, sees
  hauler profiles and self-reported truck availability, messages haulers, and sends a capped number of job notices
  to haulers who opted in to them. LogLoads does not arrange transportation, handle freight money or take part in
  the hauling agreement.
- **A boost.** A one-time charge for Sponsored placement of one job in search results, on the map and in opt-in
  digests near the job, for a fixed number of days.
- **The buyers** are businesses: logging contractors, landing operators and mills. Haulers pay nothing.
- **The founding offer** is a percentage discount on the plan for a number of paid monthly cycles.

**General questions.**

- **G1.** In which states must LogLoads register to collect sales tax before its first charge: its home state, and
  any state where it has a physical presence or passes a remote-seller threshold? Which thresholds matter for the
  first basins?
- **G2.** In each basin state, is a landing plan taxable, and as what: software as a service, a digital automated
  service, a data processing or information service, or an advertising service? Do the job notices change the
  answer?
- **G3.** Is a boost an advertising service, and is it taxable where the buyer is?
- **G4.** Which location decides the tax for a business with landings in several states, or with a billing address
  in one state and its landings in another? Does the checkout need the buyer's landing addresses?
- **G5.** Is tax charged on the founding price actually paid, not on the full price?
- **G6.** What must each invoice and receipt show, and how long must tax records be kept (legal review §10,
  question 5)?
- **G7.** Do we need resale or exemption certificates from any buyer, for example a tribal or public entity?
- **G8.** Is a price shown without tax, with "plus applicable taxes", acceptable in each state, or must some prices
  include tax?
- **G9.** Should we use the payment provider's tax calculation (Stripe Tax) or another tool? What does it need from
  us: product tax codes, an origin address, registrations?
- **G10.** Where we do not collect tax, does the buyer owe use tax, and should the invoice say so?

**Washington.**

- **W1.** Is a landing plan a "digital automated service" or remote access software, and so a retail sale subject
  to retail sales tax and retailing B&O tax?
- **W2.** ESSB 5814 treats advertising services as a retail sale from October 1, 2025. The Department of Revenue's
  guidance on it notes ongoing legal proceedings (checked 2026-11-18). Is a boost an advertising service under it?
  Is any part of a plan, such as the job notices or the Sponsored placement, an advertising service?
- **W3.** What is the remote-seller threshold for registering for Washington sales tax and B&O tax, and does it count
  sales to businesses?
- **W4.** Does the multiple points of use exemption apply when a subscriber uses the plan at landings in several
  states, and what must the buyer give us to claim it?
- **W5.** Which local rate applies: the buyer's billing address, or where the plan is used?

**Texas.**

- **T1.** Is a landing plan a data processing service or an information service? Texas exempts 20 percent of the
  charge for a data processing service (Tex. Tax Code § 151.351; 34 Tex. Admin. Code § 3.330(b)). Would the plan be
  taxed on the other 80 percent?
- **T2.** Is a boost an advertising service and outside the tax, or is placement on our site a data processing or
  information service?
- **T3.** What is the Texas remote-seller threshold, and how would a Texas basin's sales count toward it?
- **T4.** Which Texas local tax applies for a business with landings in several Texas cities?

## 6. Questions for counsel

These add to the legal review's question 10 for technology and consumer counsel.

1. Is §2 enforceable as written, and what must change for each basin state?
2. Do you agree that we build to the consumer automatic-renewal standard for business buyers (legal review §10,
   question 4)? This draft assumes so.
3. Is a confirm button that names the renewal enough for express consent, or is an unticked box also needed (§4)?
4. Which basin states require a prorated refund on cancellation, or cancellation by email or phone as well as online?
5. Is a reminder 7 to 21 days ahead right in every basin state? Which other states require a notice before a
   promotional price ends?
6. Is the offer page's limit statement accurate: "LogLoads grants the offer to no more than N qualifying landing
   businesses whose home state is" the state, a place taken at the grant, with a live count of places left? Must the
   closing date be published? Is it enough that the checkout of a business that holds the offer states no limit?
7. Is "no refund" on a suspension for a breach enforceable (11.14)?
8. Is treating a disputed cycle as unpaid acceptable under consumer law and the card networks' rules (11.15)?
9. Does keeping an unpaid plan's data for 90 days fit the Privacy Policy's retention schedule (legal review §6.4)?

## 7. Gate D checklist for these terms

All of these are true before the first payment:

- [ ] Counsel has reviewed §2 to §4 and signed off a version. That version replaces
      `billing-disclosures-draft-2026-11-18-r2` and marks the disclosures approved.
- [ ] The founder has set the founding-offer terms (COM-1) and every **[Founder]** item in §2 and §3.
- [ ] **The limit is counted the way the founder chose (F-1), and the offer page says how.** Today the store counts
      admin grants of one promotion, not subscriptions, and matches the promotion's `state_code` to the business's
      `organizations.home_state`, not a basin or where its landings are (`admin_grant_founding_promotion`). The offer
      page says exactly that. A basin cohort, or a limit counted by subscriptions, needs a store change first, and
      then a new disclosure version that states it.
- [ ] **Ending an offer early is decided and built, or stays out of the words.** No store function sets a
      redemption to `revoked`, so the disclosures promise no early end. The store refuses a second grant only to the
      same organization record; a business under another account rests on the admin's review at the grant. If the
      founder wants an offer to end early for a business that does not qualify or already has an offer under
      another account, the store needs an audited revocation function first, and the disclosures a new version that
      says so.
- [ ] The checkout passes a held offer's cycles left from the store (`cyclesRemaining`), never the offer page's
      terms, so the date of the first full-price charge is the store's.
- [ ] The lead has confirmed every **[Proposed]** value, and the provider's retry schedule and the store's
      `past_due_grace_days` equal them.
- [ ] The accountant has answered §5, LogLoads is registered wherever it must be, and tax is calculated on each
      charge.
- [ ] The checkout does what §4 lists: it shows `lines` before payment details are taken, gets consent, records the
      version, sends the confirmation, and cancelling works online in Billing.
- [ ] The reminder before the founding price ends is built and tested.
- [ ] The store handles disputes as 11.15 says, and the rule after cancelling matches the founder's choice (F-4).
- [ ] The Terms rewrite (legal review P0 item 1) carries section 11 from this draft.
- [ ] [`ACTIVATION_STRIPE.md`](../ACTIVATION_STRIPE.md) §3 to §5 are met. The founder's live-money decision is
      separate from all of this.
