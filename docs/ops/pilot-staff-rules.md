# LogLoads pilot staff rules

> **Status:** TARGET. Written 2026-11-18 for [#340](https://github.com/AutomatedEmpires/logloads/issues/340). No
> pilot is operating. **Draft for counsel:** these rules come from an agent-written legal review, not from a
> licensed attorney. Follow them as written until counsel confirms or changes them.
>
> **Source:** [`2026-11-legal-review.md`](../legal/2026-11-legal-review.md) (P0 item 6, risk R1). Each rule cites
> the section it comes from. **Runbook:** [`PILOT_LAUNCH.md`](../PILOT_LAUNCH.md) Stage 1.

**Who this covers.** Anyone acting for LogLoads during the pilot: the founder, employees, contractors, and agents
that answer support or admin requests. "The two sides" are a landing organization and a hauling business.

## 1. Why these rules exist

LogLoads is a load board. A landing posts a job, a hauler responds, and the two make their own deal. That stays
true only if the people at LogLoads also stay out of the deal. A staff member who phones haulers to fill a
landing's job is arranging transportation by hand, which is what a freight broker does
([§3.2](../legal/2026-11-legal-review.md#32-analysis), risk R1 in
[§2](../legal/2026-11-legal-review.md#2-risk-register)). The cost of getting this wrong is a penalty for each
violation and personal liability, and liability for a bad haul can follow whoever chose the carrier.

**The test for anything not listed here:** would this make LogLoads, and not the landing or the hauler, the one
who chose the truck, set the price, or carried the conversation? If yes, do not do it.

## 2. What you may do

| # | You may | Why |
|---|---|---|
| A1 | Teach any user how to use the product: help a landing post its own job, help a hauler set up its own profile and availability, and answer product questions. | Teaching is allowed; the user still makes every choice ([§3.3](../legal/2026-11-legal-review.md#33-design-choices-that-keep-logloads-a-marketplace) item 9). |
| A2 | Confirm with a landing that its postings are genuine, and act on one that is not. | Real jobs are the product, but LogLoads never calls a job "verified" or says every job is real ([§9.4](../legal/2026-11-legal-review.md#94-other-risks-worth-a-line-each), R10). |
| A3 | Recruit haulers and landings to join LogLoads in a basin, without naming a particular landing's job to a hauler. | Recruiting to the board is not arranging a haul; naming one job to one hauler is (§3.3 item 9). |
| A4 | Give a landing the public link to its own job, for the landing to share. | The landing decides who hears about its job (§3.3 items 1 and 2). |

## 3. What you must never do

| # | Never | Why |
|---|---|---|
| N1 | Contact a hauler about a specific landing's job, by phone, text, email, message or in person. | This is arranging transportation by hand ([§3.2](../legal/2026-11-legal-review.md#32-analysis); §3.3 item 9). |
| N2 | Pick, rank or suggest haulers for a job, or tick invitation recipients for a landing. | LogLoads never chooses the hauler; the landing picks each one (§3.3 item 1). |
| N3 | Pass a message, an offer or contact details from one side to the other. | Relaying puts LogLoads in the middle of the deal (§3.3 item 9); a phone number is shown only when the landing chooses ([§9.3](../legal/2026-11-legal-review.md#93-required-product-changes) item 3). |
| N4 | Suggest a rate, say what others pay, or negotiate. | LogLoads does not negotiate and suggests no rate (§3.3 item 4); shared pay figures also raise a competition-law risk (§9.4, R13). |
| N5 | Speak for either side, or tell one side what the other "would accept". | No staff member speaks for a landing or a hauler (§3.3 item 4). |

If a user asks for any of these, say: "I can't do that for you, but I can show you how to do it yourself in
LogLoads." Then use A1.

## 4. Messages between users

| # | Rule | Why |
|---|---|---|
| M1 | Read users' messages only for one of three reasons: a report, a fraud or abuse check, or a legal duty. Never for curiosity, sales or marketing. | The law allows the provider to read stored messages, and users are told these are the only reasons ([§6.5](../legal/2026-11-legal-review.md#65-staff-reading-messages-and-public-hauler-listings) item 1). |
| M2 | Every read is logged with who read, which thread, when and why. If you cannot log it, do not read it. | The notice to users says each read is logged (§6.5 item 1). |
| M3 | Never forward, quote or paraphrase message content to another user. A reporter learns the outcome, not the other side's words. | Disclosing message contents to someone else is what the law restricts (§6.5 item 3). |
| M4 | Never promise a particular removal, a particular result, or a time to act. Say: "We'll review this report." | A promise to remove can be enforced against LogLoads (§9.4, R10). |
| M5 | A request from police or any agency needs valid legal process (a subpoena, warrant or court order). Log the request, release nothing, and send it to counsel first. | Written rule required by the review (§6.5 item 4). |

## 5. Basins

| # | Rule | Why |
|---|---|---|
| B1 | Only LogLoads platform staff change a basin's status (`closed`, `pilot` or `open`), and each change records its reason. | The pilot opens per basin, so each change is its own launch step (gate A in [§1](../legal/2026-11-legal-review.md#1-how-to-read-this)). Steps are in `PILOT_LAUNCH.md` Stage 1. |
| B2 | A basin's status is never changed to help one landing fill one job. | That would be staff arranging a haul by another route (§3.3 item 9). |

## 6. If you are unsure, or a rule was broken

Stop, do nothing further on that request, and tell the lead the same day. Write down what was asked, what was
done and who was involved. Do not try to undo a relay or a suggestion by contacting the other side again.

## 7. The "manual matching" pilot (#120)

[#120](https://github.com/AutomatedEmpires/logloads/issues/120) planned a 30-day "manual matching" pilot. That
conflicts with N1 to N3. The lead decided on 2026-11-11
([#120 comment](https://github.com/AutomatedEmpires/logloads/issues/120#issuecomment-6809385516)) that the pilot
drops manual matching and that staff only recruit and teach. #120 still carries the old title and scope: it must
be rescoped to assisted onboarding under these rules, or closed, before any pilot work starts under it.
