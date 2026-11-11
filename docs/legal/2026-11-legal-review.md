# LogLoads legal review, November 2026

> **Status:** TARGET. Agent analysis for [#293](https://github.com/AutomatedEmpires/logloads/issues/293), written
> 2026-11-10 against `work/logloads-repair` at `6e71614`. **This is not legal advice.** It was written by an AI
> agent (Claude), not by a licensed attorney, and nobody has an attorney-client relationship with its author. It
> changes no code, approves no Terms text, and activates nothing. Section 12 lists what licensed counsel must
> confirm.

The founder asked agents to "act as lawyer and do extensive review"
([#235, decision 6](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784468462)). This
document does that for LogLoads. It names each risk, rates it, states the product change that reduces it, and says
whether licensed counsel must confirm before launch.

## 1. How to read this

**What I relied on.** The founder decisions of 2026-11-10 (no tickets, tracking or settlement; many regions, gated
per basin; SMS approved with the send budget capped at 0; phone shown only after the landing replies and only if
the landing opts in). The pricing ruling on
[#108](https://github.com/AutomatedEmpires/logloads/issues/108#issuecomment-6785833334). The register on
[#114](https://github.com/AutomatedEmpires/logloads/issues/114#issuecomment-6786484699) and PR #311. The
[strategy](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784066522). Blueprint §1.3, §5–§7,
§10, §15 and §16. UX spec §7.10, §8.12, §8.17–§8.19, §10.23, §10.28, §11.3–§11.6 and §12.4. The live legal pages
in `apps/web/lib/v3-shared.ts` and the notification outbox in
`architecture/normalized-v2/26_v2_team_seats_saved_jobs_outbox.sql`.

**Severity.**

| Level | Meaning |
|---|---|
| Critical | Could stop the business or create liability larger than the business can absorb. |
| High | Statutory damages, regulator action or a loss of user trust that the wedge depends on. |
| Medium | Real exposure, but bounded or unlikely at pilot scale. |
| Low | Hygiene. Cheap to fix and unlikely to be enforced at this size. |

**Gates.** "Launch" is not one event here, so each change names the gate it must precede.

| Gate | Event |
|---|---|
| A | The pilot opens to real users in any basin (free, no texts, no payments). |
| B | The first text message is sent, which means the SMS budget cap is raised above 0. |
| C | The first non-transactional email goes to a real recipient. |
| D | The first payment is taken (plans, boosts or the founding offer). |

**Limits of this review.**

- It covers US federal law and samples state law, mostly Washington, California and Texas. The basin list is not
  decided, so no state has had a full review. Each basin's state needs one before that basin opens.
- I do not know the operating company's state of formation or tax position.
- Three points rest on law-firm summaries because I could not open the primary document: the FCC's October 2026
  revocation order, and the two 2026 appellate TCPA decisions in §4.2. They are marked "secondary".
- Law changes. Section 13 records what was checked on 2026-11-10.

## 2. Risk register

| ID | Risk | Severity | Counsel must confirm before launch? |
|---|---|---|---|
| R1 | LogLoads is treated as an unregistered freight broker | High | **Yes**, before gate D and before targeted invitations are sold. Recommended before gate A. |
| R2 | Public Terms, Privacy Policy and Marketplace Rules describe the retired product | High | **Yes**, before gate A (the rewritten text). |
| R3 | Text messages sent without provable consent, or outside carrier rules | High | **Yes**, before gate B (consent wording and state registration). |
| R4 | Verification marks read as safety or reliability claims | High | **Yes**, a short review of the wording before gate A. |
| R5 | Contact harvesting, fake landings and message abuse | High | No. Counsel reviews only the Terms clauses. |
| R6 | Privacy: inaccurate policy, no retention schedule, outbox never purged | Medium | **Yes** for the policy text (part of R2). No for the engineering. |
| R7 | Commercial email without the required footer, opt-out or suppression | Medium | No. |
| R8 | Pricing page and "free forever" read as promises | Medium | **Yes**, brief, for "free forever". No for the price list. |
| R9 | Subscription renewal, proration and the founding offer sold without the required disclosures | High at gate D | **Yes**, before gate D. |
| R10 | False postings and LogLoads' own freshness statements | Medium | No, if the changes in §9.3 are made. |
| R11 | Staff reading messages; public hauler listings without clear notice | Medium | No, if the notices in §6.5 ship. |
| R12 | "Reputation as dated facts" becomes a consumer report | Medium (P1 feature) | **Yes**, before that feature is built. |
| R13 | Pay benchmarks in landing analytics as an information exchange between competitors | Medium (P1 feature) | **Yes**, before that feature is built. |
| R14 | The retired per-load fee program left open obligations | Unknown | **Yes**, after the LEG-2 check. |
| R15 | One-tap links act for a user without a login | Medium | No. |

## 3. FMCSA broker status (R1)

### 3.1 The law

- **Statute.** A broker is "a person, other than a motor carrier or an employee or agent of a motor carrier, that
  as a principal or agent sells, offers for sale, negotiates for, or holds itself out by solicitation,
  advertisement, or otherwise as selling, providing, or arranging for, transportation by motor carrier for
  compensation." [49 U.S.C. 13102(2)](https://www.govinfo.gov/link/uscode/49/13102).
- **Regulation.** A broker is "a person who, for compensation, arranges, or offers to arrange, the transportation
  of property by an authorized motor carrier", and brokerage is "the arranging of transportation or the physical
  movement of a motor vehicle or of property."
  [49 CFR 371.2(a) and (c)](https://www.ecfr.gov/current/title-49/section-371.2).
- **Registration and bond.** Brokers register under [49 U.S.C. 13904](https://www.govinfo.gov/link/uscode/49/13904)
  and keep $75,000 of financial security under
  [49 U.S.C. 13906(b)](https://www.govinfo.gov/link/uscode/49/13906). They keep transaction records for three years
  under [49 CFR 371.3](https://www.ecfr.gov/current/title-49/section-371.3).
- **Penalty.** Unauthorized brokering carries a civil penalty of up to $10,000 per violation and liability "to the
  injured party for all valid claims incurred without regard to amount". The liability is joint and several and
  reaches officers, directors and principals.
  [49 U.S.C. 14916](https://www.govinfo.gov/link/uscode/49/14916).
- **FMCSA's 2023 guidance.** *Definitions of Broker and Bona Fide Agents*,
  [88 FR 39368 (June 16, 2023)](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents).
  Four points matter here:
  1. Load boards. "[M]erely making information about potential shippers publicly available, regardless of whether a
     fee is charged, does not require an entity to obtain broker authority as long as the entity making the leads
     available is not otherwise involved in any transaction between the shipper and a motor carrier."
  2. Money. "Handling money exchanged between shippers and motor carriers is one factor that strongly suggests the
     need for broker authority, but it is not an essential requirement for one to be considered a broker."
  3. Discretion. "Allocating traffic" means "any exercise of discretion, choice, or decision-making on the agent's
     part about which motor carrier to assign a load."
  4. Factors that point to needing authority include dealing with or negotiating a shipment directly with the
     shipper, taking compensation tied to a load, accepting a shipment and then finding a truck for it, and
     "soliciting to the open market of carriers for the purposes of transporting a freight shipment" (Part IV.F).
- **Bona fide agent.** The exception covers people "who are part of the normal organization of a motor carrier"
  and act under the carrier's direction (49 CFR 371.2(b)). LogLoads works for neither side under an agency
  agreement and is paid by the landing, so this exception does not fit. The marketplace distinction in point 1 is
  the one LogLoads relies on.
- **Exempt commodities.** FMCSA states: "if the underlying transportation is exempt from commercial jurisdiction
  and you would not need motor carrier operating authority (MC number) to transport the commodity, you don't need
  broker authority to broker it."
  ([FMCSA FAQ](https://www.fmcsa.dot.gov/faq/am-i-required-have-broker-authority-if-i-am-brokering-loads-non-regulated-exempt-commodity-such))
  The exemption is [49 U.S.C. 13506(a)(6)](https://www.govinfo.gov/link/uscode/49/13506). FMCSA's
  [Administrative Ruling 119](https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/Administrative_Ruling_119.pdf)
  lists as exempt: trees "cut to length, peeled, or split", "timber - rough logs or bolts cut in random lengths,
  with bark removed", untreated poles and pilings, bark, sawdust, and "wood chips - including those for making wood
  pulp". It lists as **not** exempt: trees "sawed into lumber", treated poles and pilings, shakes and shingles, and
  mine timbers. [49 CFR 372.115](https://www.ecfr.gov/current/title-49/section-372.115) lists further non-exempt
  items.
- **Interstate limit.** Federal broker rules reach interstate transportation
  ([49 U.S.C. 13501](https://www.govinfo.gov/link/uscode/49/13501)). A haul that stays inside one state falls to
  that state. Washington, for example, requires a bond of at least $5,000 from "a person who provides brokering or
  forwarding services for the transportation of property in intrastate commerce"
  ([RCW 81.80.430](https://app.leg.wa.gov/rcw/default.aspx?cite=81.80.430)).
- **Tort exposure.** On May 14, 2026 the Supreme Court held unanimously that federal law does not preempt a state
  negligent-hiring claim against a broker that selected an unsafe carrier
  ([*Montgomery v. Caribe Transport II, LLC*, No. 24-1238](https://supreme.justia.com/cases/federal/us/608/24-1238/)).
  Whoever selects or vouches for a carrier can now be sued over that carrier's crash in every state.

### 3.2 Analysis

**The core product sits inside FMCSA's load-board statement.** A landing publishes a job. A hauler reads it and
sends interest. They talk and make their own deal. LogLoads is paid a flat subscription, handles no freight money,
is not a party to the haul and keeps no record of the hauling contract. During the free pilot nobody pays LogLoads
at all, and both definitions require compensation.

**Most of what LogLoads lists is an exempt commodity.** Rough logs, pulpwood and chips are on FMCSA's exempt list,
and FMCSA says brokering exempt freight needs no broker authority. This is a strong second defence. It is not a
complete one, for three reasons:

1. The product list has an "Other" option (UX-DEC-03), and landings also move lumber, treated poles and logging
   equipment. None of those is exempt.
2. State law governs intrastate hauls and does not follow the federal exempt list.
3. *Montgomery* liability does not depend on registration. It depends on who chose the carrier.

**Five features bear on "arranging".** Highest risk first:

| Feature | Why it matters | Assessment |
|---|---|---|
| Targeted invitations | The landing pays (through its plan) for LogLoads to deliver a job to chosen haulers. Blueprint §6.3 says LogLoads will "recommend appropriate hauling businesses". If LogLoads chooses who gets the job, that is discretion over which carrier hauls, on behalf of a shipper, for compensation. | Acceptable **only** if the landing picks every recipient from a filtered list and LogLoads never picks, ranks by a hidden score or sends on its own. Counsel must confirm. |
| "Smart matching recommendations" (spec §10.34, LATER) | An algorithm that proposes specific carriers for a specific job is the nearest thing in the spec to allocation. | Do not build without a transportation-law opinion. |
| Staff help during the pilot | A staff member who phones haulers to fill a landing's job is arranging transportation by hand. | Forbid it in the pilot runbook. |
| Sponsored boosts | Paid placement of a job. | Advertising. Low risk if labelled and sold with no promise of trucks. |
| Phone reveal after a reply | LogLoads passes on a number when the landing chooses. | A directory function. Low risk. |

**The retired product was closer to the line.** The archived Terms of August 3, 2026 had a "Host platform fee"
charged per completed load, "assignments" that recorded "the coordination terms both sides accepted", and trip
events. Compensation tied to a load plus a record of the arrangement is the pattern the guidance warns about.
Whether anyone was ever charged under it is not known (LEG-2). That is R14, and it is a question for counsel.

### 3.3 Design choices that keep LogLoads a marketplace

These are requirements. Each is concrete enough to open a task.

1. **LogLoads never chooses the hauler.** In Find Trucks and in the invitation composer, results are a filter over
   facts the hauler entered (equipment, service area, availability date, freshness). The sort order is one of a
   few named keys the landing can see and change, such as distance or last confirmed. There is no "best match", no
   numeric score (already banned by `tools/check-guardrails.mjs`) and no pre-selected recipients. The landing
   ticks each recipient.
2. **LogLoads never sends a job to haulers on its own initiative for a paying landing.** Ordinary job alerts go to
   haulers because the hauler saved a search. Invitations go because a landing selected that hauler.
3. **No fee depends on a hire, a load or a haul.** This is already locked (Blueprint §16.1). An invitation is
   counted on delivery, never on acceptance (spec §8.12). Keep it that way in every future pricing change.
4. **LogLoads does not negotiate.** No suggested rate, no counter-offer tool, no staff member speaking for either
   side. Reply templates written by the user are fine.
5. **No record of the hauling agreement.** No "accepted", "awarded", "assigned", "booked" or "hired" state on an
   inquiry. Statuses describe the conversation only. No rate confirmation, bill of lading, ticket or settlement.
   Founder decision 1 already sets this boundary. Any "export to ticketing tools" proposal needs counsel first.
6. **No holding out.** Public copy never says LogLoads finds, provides, arranges, supplies, books, dispatches or
   guarantees trucks or loads. It says the landing posts and the hauler responds. Add these phrases to
   `tools/check-guardrails.mjs`. Do not publish the legal conclusion "LogLoads is not a broker" either (spec §11.5
   forbids promising an exemption). Describe the conduct instead.
7. **No carrier vetting.** LogLoads does not check or display operating authority, insurance or safety records
   (see §7). Checking them would make LogLoads look like the party that selects carriers.
8. **Sort jobs by commodity.** Mark each entry in the controlled product list as an unmanufactured forest product
   or not. A job whose product is "Other", lumber, treated poles or equipment shows the poster a notice that
   LogLoads only advertises the job and that the parties are responsible for any authority the haul needs. Report
   the share of such jobs to the lead each month.
9. **Staff rule.** The pilot runbook (`docs/PILOT_LAUNCH.md`) says staff may teach a user to use the product and
   may not contact a hauler about a specific landing's job, pass messages between the two, or suggest a rate.
10. **Terms.** The Terms say LogLoads is an advertising and communication service, is not a carrier, broker or
    freight forwarder, does not arrange transportation, is not a party to any hauling agreement, and that each
    user is responsible for its own operating authority, insurance, permits and compliance (§8.1).

| | |
|---|---|
| Severity | High. The likelihood is low with the choices above. The consequence is a per-violation penalty, personal liability for principals and uncapped claims. |
| Product change | Items 1–10. Items 1, 2, 5, 6, 8 and 9 before gate A. Item 10 with the Terms rewrite. |
| Counsel | **Yes.** A transportation attorney confirms the invitation flow, the commodity point and the state position for each basin before invitations are sold and before gate D. Blueprint §15 already requires this. |

## 4. Text messages: TCPA, 10DLC and carrier rules (R3)

Nothing is sent while the cap is 0, so there is no exposure today. The exposure starts at gate B. But consent
collected now must still be valid then, so the consent screen must be right before it collects a single opt-in.

### 4.1 The law

- **Autodialed calls and texts.** [47 U.S.C. 227(b)(1)(A)(iii)](https://www.govinfo.gov/link/uscode/47/227) bars
  calls to a cell phone using an automatic telephone dialing system or an artificial or prerecorded voice without
  "prior express consent". *Facebook, Inc. v. Duguid*, 592 U.S. 395 (2021), limits "autodialer" to equipment that
  uses a random or sequential number generator. A platform texting stored numbers probably falls outside that
  definition. Plaintiffs still plead around it, and state laws use wider definitions, so LogLoads should not rely
  on it.
- **Do-not-call.** [47 U.S.C. 227(c)](https://www.govinfo.gov/link/uscode/47/227) and
  [47 CFR 64.1200(c)–(e)](https://www.ecfr.gov/current/title-47/section-64.1200) bar "telephone solicitations" to
  numbers on the National Do Not Call Registry without written consent, and require an internal do-not-call list.
  The FCC applies these rules to texts and to cell phones.
- **Consent levels.** Informational messages need "prior express consent". Messages that include advertising or
  telemarketing need "prior express written consent": a signed (electronic is fine) agreement with a clear
  disclosure that the person agrees to receive marketing texts at that number, and a statement that consent is
  not a condition of purchase. 47 CFR 64.1200(a)(1)–(2) and (f)(9).
- **Quiet hours.** No telephone solicitation "before the hour of 8 a.m. or after 9 p.m. (local time at the called
  party's location)". 47 CFR 64.1200(c)(1).
- **Opt-out.** Since April 11, 2025 a sender must honour a revocation made in any reasonable way within 10
  business days, must treat "stop", "quit", "end", "revoke", "opt out", "cancel" and "unsubscribe" as revocations,
  and may send one confirmation text within five minutes. 47 CFR 64.1200(a)(10)–(12). The part that would make one
  STOP revoke every kind of message was delayed to January 31, 2027
  ([FCC fact sheet, September 2026](https://docs.fcc.gov/public/attachments/DOC-424844A1.pdf)). On October 1, 2026
  the FCC adopted an order (FCC 26-67) that replaces that part with a category-by-category rule and lets a sender
  name an exclusive opt-out method if it discloses the method in the message. It takes effect 30 days after
  Federal Register publication, which I could not confirm (secondary:
  [Manatt summary](https://www.manatt.com/insights/newsletters/client-alert/fcc-replaces-revoke-all-rule-and-permits-callers-to-designate-an-exclusive-revocation-method)).
- **Damages.** $500 for each violation, which a court may triple for a wilful or knowing one. 47 U.S.C. 227(b)(3)
  and (c)(5). There is no cap, and class actions are the norm. The limitation period is four years
  ([28 U.S.C. 1658(a)](https://www.govinfo.gov/link/uscode/28/1658)).
- **The law is unsettled.** *McLaughlin Chiropractic Associates v. McKesson Corp.*, 606 U.S. 146 (2025), held that
  courts are not bound by the FCC's reading of the TCPA. Since then the Seventh Circuit has held that a text is
  not a "telephone call" for the do-not-call private right of action, while the Ninth Circuit has held that a text
  is a "call" under section 227(b) (secondary:
  [K&L Gates, August 2026](https://www.klgates.com/thought-leadership/Litigation-Minute-Seventh-Circuit-Rules-That-Text-Messages-Are-Not-Telephone-Calls-Under-the-TCPAWhat-To-Know-and-What-Comes-Next-8-5-2026)).
  The Eleventh Circuit vacated the FCC's one-to-one consent rule in *Insurance Marketing Coalition v. FCC*, 127
  F.4th 303 (2025). Build to the strictest reading.
- **State law.** Several states regulate texts more strictly than the TCPA. Washington bars a commercial text to a
  Washington resident unless the recipient "clearly and affirmatively consented in advance"
  ([RCW 19.190.060](https://app.leg.wa.gov/rcw/default.aspx?cite=19.190.060)). Texas extended its telephone
  solicitation law to texts on September 1, 2025 (SB 140; Tex. Bus. & Com. Code chs. 301–305), with registration
  and bond duties for some sellers. Florida (Fla. Stat. 501.059) and Oklahoma (15 O.S. 775C.1 and following) have
  shorter calling hours and frequency limits. Most of these aim at consumer sales, and LogLoads' users are
  businesses. But an owner-operator's cell is usually a personal phone, so the business-to-business argument is
  weak.
- **Carrier rules (not law, but enforced by blocking).** US carriers require every application-to-person sender on
  ten-digit numbers to register a brand and a campaign with The Campaign Registry. Unregistered traffic is blocked
  or surcharged. Registration and the
  [CTIA Messaging Principles and Best Practices](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-interoperability-sms-mms)
  require an opt-in for all recurring messages, a call to action that names the program, message frequency, "Msg
  & data rates may apply", HELP and STOP instructions, a public privacy policy that says mobile opt-in data is not
  shared with third parties for their marketing, and no public URL shorteners.

### 4.2 Which LogLoads texts are marketing?

| Message | Category | Consent to collect |
|---|---|---|
| Phone verification code | One-time, user-initiated | Entering the number and asking for the code. |
| "A landing replied to you" / "A hauler is interested" | Informational | Express opt-in to conversation alerts. |
| Reconfirm reminders and one-tap confirm links (flows D and E) | Informational, if the text has no promotion in it | Express opt-in to listing and availability reminders. |
| Job alerts from a saved search | Treat as marketing | Written consent. |
| Targeted invitations | Treat as marketing. A landing pays for it and it promotes a commercial opportunity. Courts have often treated recruiting messages as non-solicitation, but that is not settled. | Written consent, separate from the others. |
| Digests, boosts shown in a text, product news | Marketing | Written consent. |

The simplest safe design collects written-grade consent for every category, one unticked box per category.

### 4.3 The consent and opt-out evidence to keep

The ledger in [#291](https://github.com/AutomatedEmpires/logloads/issues/291) must be able to prove each of these
for any message, four years later:

| Evidence | Fields |
|---|---|
| Who consented | User id, organization id, phone number in E.164 form. |
| That they control the phone | Verification code sent and confirmed, with times. |
| What they agreed to | The exact disclosure text, stored by version id and hash. The categories ticked. Proof the boxes were unticked by default (the UI version). |
| When and how | Timestamp, screen or keyword, IP address, user agent. |
| Each message | Template id and version, category, send time, recipient's local time, provider message id, delivery status. |
| Each opt-out | Timestamp, the words received, the channel (reply, settings, support), the scope, the confirmation sent. |
| HELP requests | Timestamp and the reply sent. |
| Number changes | Deactivation or reassignment signals and the re-verification that followed. |

Keep every row for five years after the last message to that number. Do not delete it when the account is deleted;
it is the defence.

### 4.4 Required product changes

1. **Consent screen.** Shown at phone verification. One unticked box per category. Above the boxes: the program
   name, "Message frequency varies, up to N a week", "Msg & data rates may apply", "Reply STOP to stop, HELP for
   help", "Consent is not a condition of using LogLoads", and links to the SMS terms and the Privacy Policy. The
   box that accepts the Terms of Service is a different box on a different step.
2. **STOP stops everything.** Any of the seven words, in any letter case, ends all texts to that number at once,
   and one confirmation goes out. This is safe under both the current rule and the October 2026 order. Finer
   control lives in settings. START or a new opt-in in the product turns texts back on.
3. **HELP** returns the program name, a support contact and the STOP instruction.
4. **Quiet hours by the recipient's own time zone.** Marketing categories go out between 9 a.m. and 8 p.m. only,
   which satisfies the federal rule and the stricter state windows found so far. Informational categories default
   to 8 a.m.–9 p.m. A user may set an earlier window for conversation alerts (loggers start before dawn), and that
   choice is recorded in the ledger.
5. **Caps.** A per-recipient weekly cap for each category and a hard cap of three marketing texts in 24 hours.
6. **Template lint.** An informational template may not contain a price, an upsell, a boost or another landing's
   job. A test fails the build if it does.
7. **No sharing.** Phone numbers and SMS consent are never passed to a landing, a partner or an advertiser. The
   Privacy Policy says so in the words carriers look for.
8. **Sender setup before gate B.** Brand and campaign registered; sample messages match the templates; a public
   SMS terms page; links on the product's own domain.
9. **A release check on the cap.** The setting that raises the budget above 0 refuses unless the items above pass
   and the counsel sign-off is recorded. This keeps founder decision 3 from being undone by a config edit.
10. **Reassigned numbers.** Re-verify a phone that has had no successful delivery or login for 90 days before
    texting it again. Consider the FCC Reassigned Numbers Database (47 CFR 64.1200(m)) at P1.
11. **Protect the code endpoint.** Rate-limit by IP, device and number, and allow only US and Canadian numbers, so
    that verification cannot be used for toll fraud or to harass a third party.

| | |
|---|---|
| Severity | High from gate B. Statutory damages multiply per text. |
| Product change | Items 1–7 and 11 in #291 before any consent is collected. Items 8 and 9 before gate B. Item 10 at P1. |
| Counsel | **Yes**, before gate B: the consent wording, whether invitations and job alerts need written consent, and the registration duties in each basin's state. |

## 5. Email: CAN-SPAM (R7)

### 5.1 The law

- [15 U.S.C. 7701–7713](https://www.govinfo.gov/link/uscode/15/7704) and
  [16 CFR Part 316](https://www.ecfr.gov/current/title-16/part-316). The Act covers business-to-business email.
- Every **commercial** email needs: accurate header and routing information; a subject line that does not
  mislead; a clear notice that it is an advertisement (unless the recipient gave affirmative consent); a working
  opt-out that stays live for 30 days; opt-outs honoured within 10 business days; and "a valid physical postal
  address of the sender". 15 U.S.C. 7704(a).
- An opt-out may not require a fee, a login or any information beyond the address and preferences. 16 CFR 316.5.
- **Transactional or relationship** messages are exempt from most of this, but may not have false headers. The
  category covers messages that complete an agreed transaction, give account or security information, or deliver
  something the recipient is entitled to under a transaction they agreed to. 15 U.S.C. 7702(17). Mixed messages
  are judged by their "primary purpose". 16 CFR 316.3.
- Harvesting addresses from a site that posts a notice that it does not share them is an aggravated violation.
  15 U.S.C. 7704(b)(1).
- Each non-compliant email is a separate violation. The maximum civil penalty was $53,088 per violation after the
  January 2025 adjustment ([90 FR 5580](https://www.federalregister.gov/documents/2025/01/17/2025-01361/adjustments-to-civil-penalty-amounts)).
  I did not confirm the 2026 figure.
- State law is mostly preempted, except for rules against falsity and deception (15 U.S.C. 7707(b)). Washington's
  [RCW 19.190.020](https://app.leg.wa.gov/rcw/default.aspx?cite=19.190.020) bars false or misleading subject lines
  in email sent to Washington residents, with statutory damages per email.

### 5.2 Classification

| Email | Class |
|---|---|
| Sign-in, security, account and billing notices | Transactional |
| Team invitation to a person with no account | Sent at a user's request. Treat as transactional, but see change 4. |
| "A landing replied" / "A hauler is interested" | Transactional |
| Reconfirm reminders | Relationship, if the email has no promotion in it |
| Job alerts from a saved search | Treat as commercial |
| Targeted invitations, digests, boosted jobs, product news, re-engagement | Commercial |

### 5.3 Required product changes (for [#253](https://github.com/AutomatedEmpires/logloads/issues/253))

1. **A class on every template.** Each template declares `commercial` or `transactional` in code. Commercial
   templates cannot render without the footer. A test enforces it.
2. **Footer.** The company's legal name, a postal address that receives mail (a registered agent address or a PO
   box is acceptable), why the person is getting the email, and an unsubscribe link.
3. **Unsubscribe.** One click, no login, effective at once. Also send the `List-Unsubscribe` and
   `List-Unsubscribe-Post` headers, which the large mailbox providers require of bulk senders.
4. **Suppression list.** A table of hashed addresses that have opted out or bounced, checked before every send,
   including sends to people with no account. A team invitation carries a "do not email me again" link. Reminders
   for one invitation are capped.
5. **LogLoads is the sender of a targeted invitation.** The From line is LogLoads, the landing is named in the
   body, and an opt-out applies to all invitations, not to one landing.
6. **True subject lines.** No count, urgency or name in a subject unless it is literally true when the email is
   sent. No "Re:" on a first message.
7. **Authentication.** SPF, DKIM and DMARC on the sending domain before gate C.

| | |
|---|---|
| Severity | Medium. |
| Product change | Items 1–7 before gate C. |
| Counsel | No. Counsel may confirm the classification of job alerts when reviewing the Terms. |

## 6. Privacy (R6, R11)

### 6.1 Which laws apply now

- **California (CCPA/CPRA).** A "business" is one that has annual gross revenue above $26,625,000, or buys, sells
  or shares the personal information of 100,000 or more consumers or households, or earns half its revenue from
  selling or sharing personal information.
  [Cal. Civ. Code 1798.140(d)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140.);
  [California Attorney General FAQ](https://oag.ca.gov/privacy/ccpa). LogLoads meets none of these. If it ever
  does, the CCPA covers business contacts too.
- **Other states.** About twenty states now have a comprehensive privacy law. Almost all apply only above a
  threshold of 25,000 to 100,000 residents, and most define "consumer" to exclude a person acting in a commercial
  or employment role. Texas and Nebraska have no size threshold but exempt small businesses, except that even a
  small business may not sell sensitive data without consent (Tex. Bus. & Com. Code 541.107). **Conclusion: none
  of these laws binds LogLoads at pilot scale. Recheck when any state passes 25,000 users or when the company
  outgrows the small-business definition.**
- **What does apply today:**
  - [FTC Act section 5](https://www.govinfo.gov/link/uscode/15/45). A privacy policy is a public promise. A false
    one is a deceptive practice, and poor security can be an unfair one. State consumer protection acts say the
    same.
  - Privacy policy posting laws: Cal. Bus. & Prof. Code 22575–22579, Nev. Rev. Stat. 603A.340 and 6 Del. C. 1205C.
    They are aimed at consumer sites. Comply anyway; the cost is a correct policy.
  - Breach notification laws in every state where a user lives, for example
    [RCW 19.255.010](https://app.leg.wa.gov/rcw/default.aspx?cite=19.255.010) (Washington, 30 days), Cal. Civ.
    Code 1798.82, Or. Rev. Stat. 646A.604, Idaho Code 28-51-105, Mont. Code 30-14-1704 and Tex. Bus. & Com. Code
    521.053. They are triggered by a name combined with items such as a driver's licence number, a Social Security
    number or account credentials.
  - Reasonable-security and disposal duties, for example Cal. Civ. Code 1798.81.5, Or. Rev. Stat. 646A.622 and Tex.
    Bus. & Com. Code 521.052.
  - The Stored Communications Act for messages (§6.5).

### 6.2 Finding: the published Privacy Policy is wrong

The live policy (effective "August 3, 2026") says LogLoads collects "route instructions, trip events", "accepted
fee agreements, completed-load fee records", shares "driver location" with trip participants, and that "Stripe
processes host payment methods and LogLoads platform-fee collections". The current product does none of this. The
page's metadata description also promises limits on "driver location". The policy omits things the product does
do: public hauler listings, staff access to messages, verification evidence, map and weather providers, and SMS.

An inaccurate policy is the most direct privacy exposure LogLoads has. It must be rewritten before gate A (§8.2).

### 6.3 Finding: the outbox is never purged

`marketplace.notification_outbox` (stage 26) keeps every row for ever. Each row holds a recipient, a `payload` of
up to 4 KB, a `last_failure` string from the provider, and for team invitations the `recipient_email` of a person
who may never have had an account. There is no retention column, purge function or scheduled job. When SMS is
added, the same table will hold phone numbers and message bodies.

Required change, as a schema task:

1. Add a purge job. Thirty days after a row reaches a final status, blank `payload` and `last_failure`. Delete the
   row after 13 months. In-app notices the user has not dismissed are exempt until the account is deleted.
2. For team invitations, blank `recipient_email` 30 days after the invitation is accepted, cancelled or expired.
   The suppression list (§5.3) keeps only a hash.
3. Keep message bodies out of `payload`. Store ids and render at send time.
4. SMS consent and send evidence goes in the consent ledger (§4.3), which has its own five-year rule, not in the
   outbox.

### 6.4 A retention schedule to adopt

These periods are my proposals. Counsel confirms the ones marked.

| Data | Keep for | Then |
|---|---|---|
| Account and organization profile | Life of the account | Delete or anonymize 30 days after a deletion request |
| Jobs and landings | Life of the account, plus 24 months for closed jobs | Delete |
| Exact landing coordinates, gate codes, access notes | While the job is active, plus 90 days | Delete |
| Messages and inquiries | Life of both accounts, plus 12 months | Delete, unless under a report or legal hold |
| Verification evidence files | 90 days after the decision | Delete the file; keep the decision record (type, source, date, reviewer) |
| Notification outbox | See §6.3 | |
| SMS consent ledger and send log | 5 years after the last message | Delete |
| Email suppression list (hashed) | Indefinitely | It exists to honour the opt-out |
| Publish and reconfirm attestations | Life of the job, plus 4 years | Delete |
| Terms acceptance records | Life of the account, plus 6 years (counsel) | Delete |
| Admin audit log | 3 years | Delete |
| Product events and analytics | 25 months, with no contact fields | Aggregate |
| Security logs | 12 months | Delete |
| Backups | 35 days rolling | Expire |
| Legacy billing and security evidence | See §10, question 5 (counsel) | |

### 6.5 Staff reading messages, and public hauler listings

- **Messages.** The Stored Communications Act lets the provider of a messaging service access stored messages
  ([18 U.S.C. 2701(c)(1)](https://www.govinfo.gov/link/uscode/18/2701)). It restricts **disclosing** their
  contents to anyone else, with exceptions for consent, for what is necessary to provide the service or protect
  the provider's rights, and for legal process ([18 U.S.C. 2702](https://www.govinfo.gov/link/uscode/18/2702)).
  So audited staff reads for moderation are lawful. What is needed is notice and limits:
  1. The Privacy Policy and Terms say that authorized staff can read messages to investigate reports, prevent
     fraud and abuse, and comply with law, that each read is logged, and that messages are not read for marketing.
  2. The first time a user opens the composer, one line says: "LogLoads staff can read messages when a report or a
     safety check requires it."
  3. Staff never forward message content to another user. A reporter learns the outcome, not the other side's
     words.
  4. A written rule for law-enforcement requests: valid legal process only, logged, and counsel consulted.
- **Recording tools.** California (Cal. Penal Code 631) and Washington (RCW 9.73.030) wiretap laws have been used
  against sites that let a third-party script capture what users type. Do not run session replay, chat widgets or
  advertising pixels on message, sign-in, verification or consent screens. With no advertising pixels at all,
  LogLoads does not "share" personal information in the CCPA sense.
- **Public hauler listings.** An owner-operator's business name is often the person's own name. Before a hauler
  profile is published:
  1. A just-in-time notice lists the exact fields that will be visible and who can see them.
  2. Publishing is the hauler's choice (SQL-DEC F1, "private until consent", is already ratified) and can be
     reversed in one tap.
  3. A hauler can express interest in jobs without being in the directory.
  4. The directory is visible to signed-in landing organizations only. Hauler profile pages carry `noindex` and are
     absent from the sitemap. No phone or email appears on any public page (UX-DEC-04).
  5. The Privacy Policy says a shared link or a search cache may outlive unpublishing.

### 6.6 Other required changes

1. **A privacy request path.** An address and an in-app form for access, correction, export and deletion. Verify
   identity. Answer within 45 days. Spec §11.6 already calls for deletion and export.
2. **Do not collect what triggers breach laws.** No Social Security numbers, driver's licence images or bank
   details in verification. If a document shows one, the reviewer rejects it and the user redacts it and uploads
   again.
3. **Provider list and contracts.** A data processing agreement with each provider that holds user data (identity,
   database, email, SMS, payments, maps, error monitoring, analytics), and the list published in the policy. Map
   tiles expose a viewer's IP address and viewport to the tile provider, so name that provider.
4. **Location.** Browser location is asked for only on a tap, used for that search, and not stored at better than
   city precision.
5. **Adults only.** Accounts are for people 18 or older acting for a business. The site is not directed at
   children.
6. **A one-page incident plan** before gate A: who decides, who is told, and each state's notice deadline.

| | |
|---|---|
| Severity | Medium overall. The inaccurate policy alone is High, and is counted under R2. |
| Product change | §6.3 items 1–4; §6.5; §6.6 items 1–6. All before gate A, except that §6.3 item 4 goes with #291. |
| Counsel | **Yes** for the policy text and the retention periods marked "counsel". No for the engineering. |

## 7. Verification marks read as safety claims (R4)

### 7.1 Why this is a legal risk

- A verification mark is LogLoads' own statement. The immunity for user content in
  [47 U.S.C. 230(c)(1)](https://www.govinfo.gov/link/uscode/47/230) does not cover it.
- Under FTC Act section 5 and state consumer protection acts, a claim is judged by the net impression on a
  reasonable reader, not by the fine print (*FTC Policy Statement on Deception*, 1983). A tick or a shield next to
  a trucking company reads as "this carrier is safe to hire" unless the words say otherwise.
- A business that supplies false information for others to rely on in a transaction can be liable for negligent
  misrepresentation (Restatement (Second) of Torts §552), and one that undertakes a check and performs it
  carelessly can be liable to those who relied on it (§323, §324A).
- After *Montgomery* (§3.1), a crash victim can sue whoever selected the carrier. A mark that reads as an
  endorsement invites the argument that LogLoads took part in the selection.
- The FTC's rule on reviews and testimonials ([16 CFR Part 465](https://www.ecfr.gov/current/title-16/part-465),
  in force since October 2024) bans fake or undisclosed-insider reviews and suppressing negative ones. It will
  apply to any future reputation feature.

### 7.2 What is already right

UX-DEC-06 requires a mark to name its type, source and month, and the contract strings read "Business identity
reviewed by LogLoads on Oct 14, 2026." Blueprint §10.2 and spec §8.17 forbid implying checks that were not done. A
name change removes the mark (B-8). Keep all of this.

### 7.3 Required product changes

1. **Never the bare word.** "Verified", "Trusted", "Approved", "Vetted", "Safe", "Certified" and "Background
   checked" are banned as labels on an organization, profile, job or truck. Add them to
   `tools/check-guardrails.mjs` for those components. The label is always the full sentence.
2. **Neutral icon.** No shield, no green tick, no star. The mark looks the same wherever it appears.
3. **A "what this means" sheet** opens on tap: what LogLoads looked at, on what date, and "LogLoads did not check
   insurance, operating authority, licences, safety record, equipment condition or ability to do the work. Check
   these yourself before you agree to a haul."
4. **Marks expire.** A review older than 12 months is shown as "last reviewed" with its date, in grey, or is
   removed.
5. **A mark does not drive ranking.** Search does not rank marked profiles higher by default. A filter named
   "Identity reviewed" is allowed.
6. **No third-party safety data.** Do not show or summarize FMCSA, insurance or court records. If the founder
   later wants them, that is a new feature with its own counsel review (§3.3, item 7).
7. **Absence is neutral.** An unmarked profile says "Not yet reviewed", never anything that suggests a problem.
8. **Review record.** Each mark links internally to who reviewed, which document types and when. The evidence
   file itself follows §6.4.
9. **Terms.** The Terms repeat the limits (§8.1, section 9).
10. **Freshness has the same problem.** "Confirmed 3 days ago" must name who confirmed: "Confirmed by {landing} 3
    days ago". The same goes for "available" on a truck.

| | |
|---|---|
| Severity | High. It is central to the trust wedge and is LogLoads' own speech. |
| Product change | Items 1–10 before gate A. |
| Counsel | **Yes**, a short review of the mark sentence and the "what this means" sheet. |

## 8. Terms of Service and Privacy Policy

### 8.0 Findings in the live documents (R2)

1. **They describe the retired product.** The Terms speak of "assignments", "coordination terms both sides
   accepted" and "the legally identified carrier ... is paid directly by the host". The page metadata calls
   LogLoads "safe timber hauling coordination". Language about coordinating hauls is also the wrong language for
   the broker question (§3.3, item 6).
2. **The Marketplace Rules (dated July 6, 2026) still tell users to "Commit through LogLoads"** and threaten
   "feature limits, loss of network visibility, or account review" for moving work "off the record". The current
   model wants the parties to deal directly. These rules contradict the product and must be replaced.
3. **The liability cap is "the platform fees you paid us in the twelve months before the claim".** Haulers pay
   nothing, so their cap is zero. A zero cap is the kind of term a court may refuse to enforce, and "platform
   fees" is vocabulary from the retired model.
4. **The effective date is wrong.** The page says August 3, 2026, but the text changed on November 2, 2026.
5. **"Continued use after an update is acceptance."** Courts have refused to enforce changed terms that a user
   was never told about (*Douglas v. U.S. District Court*, 495 F.3d 1062 (9th Cir. 2007)), and they look for clear
   notice and an unambiguous act of assent (*Berman v. Freedom Financial Network*, 30 F.4th 849 (9th Cir. 2022);
   *Meyer v. Uber Technologies*, 868 F.3d 66 (2d Cir. 2017)).
6. **Missing sections.** Governing law, dispute resolution, a warranty disclaimer, indemnity, posting rules,
   verification limits, messaging rules, copyright complaints, and termination effects.

These are all "do before gate A". The ruling on #108 froze `/terms` until this review. This review recommends that
the lead open a task to draft the replacement text from the outline below and send it to counsel.

### 8.1 Terms of Service outline

1. **Who we are and what this is.** The legal entity. LogLoads is an online advertising and communication service
   for timber-hauling work.
2. **What LogLoads is not.** Not a motor carrier, broker, freight forwarder, dispatcher, employer or agent of any
   user. It does not arrange transportation, select carriers, negotiate, set rates, handle freight money or become
   a party to any hauling agreement.
3. **Eligibility and accounts.** Adults acting for a business. Authority to bind the organization. Accurate
   information. Roles and seats. One person, one login.
4. **Acceptance and changes.** Agreement by ticking the box. Version id and date. For a material change: notice
   by email and in the product at least 30 days ahead, and a new acceptance at the next sign-in.
5. **Posting rules for landings.** The publish attestation (ATT-2) is incorporated here. Jobs must be real,
   current, the poster's own, and state pay and its basis. Reconfirm on schedule. No bait jobs, no duplicate
   jobs, no jobs for work outside timber hauling.
6. **Rules for haulers and fleets.** Accurate equipment and availability. What publishing a profile makes visible.
   The hauler alone is responsible for operating authority, insurance, licences, permits, weight and securement.
7. **Your own deals.** Users contract with each other. LogLoads does not guarantee jobs, trucks, pay, conduct,
   road conditions or results. Disputes about a haul are between the users.
8. **Messages, invitations and contact details.** Use contact details only to discuss the job in question. No
   harvesting, scraping, resale, bulk solicitation, or texting or emailing users outside LogLoads for marketing.
   Invitations go only to haulers who opted in. Authorized staff may review messages (§6.5).
9. **Verification marks and freshness labels.** What a mark means and does not mean (§7). Freshness labels repeat
   what the user said.
10. **Sponsored placement.** Labelled. Placement only. No promise of views, inquiries or hires.
11. **Plans and billing.** A placeholder that says billing is not open and that plan terms will be published
    before any plan is sold. Counsel drafts the full section before gate D (§10, question 7).
12. **Acceptable use.** Fraud, impersonation, harassment, automated access, security testing without permission,
    and evading limits or suspensions.
13. **Your content and our licence.** The user owns it. LogLoads has a licence to host, show and share it as the
    product does, including on share links and preview cards. Feedback.
14. **Copyright complaints.** A designated agent under
    [17 U.S.C. 512(c)(2)](https://www.govinfo.gov/link/uscode/17/512) and a repeat-infringer rule.
15. **Moderation, suspension and appeals.** Reports, holds, removal, suspension, and how to appeal. No promise to
    act on a particular report within a particular time.
16. **Disclaimers.** The service is provided as is. Maps, distances and weather are estimates and are not road or
    safety advice.
17. **Limit of liability.** No indirect or consequential damages. A cap of the greater of the fees paid in the
    last 12 months or a fixed floor (I suggest $100), with the carve-outs the law requires.
18. **Indemnity.** By the user, for its postings, its hauls and its breach.
19. **Governing law, venue and disputes.** Counsel decides the state, and whether to use arbitration and a class
    waiver. If arbitration is used: an opt-out window and a small-claims carve-out.
20. **Electronic communications.** Consent to electronic records ([15 U.S.C. 7001](https://www.govinfo.gov/link/uscode/15/7001)).
    Texts are covered by the separate SMS terms and their own consent.
21. **Ending the agreement.** Closing an account, what happens to data (pointing to the Privacy Policy), and
    which sections survive.
22. **Earlier versions.** How these Terms relate to the archived August 3, 2026 version (§10, question 2).
23. **General.** Entire agreement, severability, assignment, notices, contact.

Separate short pages: **SMS terms** (program name, frequency, STOP and HELP, carriers not liable, support contact)
and **Posting rules** in plain words, which replace the Marketplace Rules.

### 8.2 Privacy Policy outline

1. Who is responsible for the data, and how to reach them.
2. What we collect: account and organization details; landings, jobs and pay; equipment and availability;
   messages and inquiries; verification evidence; phone number and SMS consent; device, log and approximate
   location data; support requests. What we do not collect: live GPS, load tracking, tickets, freight payments.
3. Where it comes from: the user, the user's organization, other users (invitations and reports), and providers.
4. What is public, what signed-in users see, and what stays private (the table in spec §11.3, in plain words).
5. How we use it: running the service, notifications, safety and fraud prevention, measurement, legal duties.
6. Staff access to messages and the audit log (§6.5).
7. Text messages: categories, consent, STOP, and the sentence that mobile numbers and SMS consent are not shared
   with third parties for their marketing.
8. Email: which emails are optional and how to stop them.
9. Who we share with: named providers by purpose; other users as the user directs; legal process; a successor in
   a sale. "We do not sell personal information, and we do not share it for cross-context advertising."
10. A notice that LogLoads does not give, sell or transfer email addresses to anyone else for sending email. This
    notice is what makes harvesting an aggravated violation under 15 U.S.C. 7704(b)(1).
11. Retention: the schedule in §6.4.
12. Your choices and rights: access, correction, export, deletion, unpublishing a profile, how to ask, how
    identity is checked, and the response time. A short California section. How the site responds to
    do-not-track and opt-out signals.
13. Security: a summary, with no absolute promises. How a breach would be notified.
14. Earlier programs: records kept from the per-load fee program that ended on November 2, 2026, and why.
15. Children: not for anyone under 18.
16. Changes to the policy, the version id and the effective date.

## 9. Contact harvesting and abuse (R5), and other risks

### 9.1 Threats

- A fake or throwaway landing account that browses Find Trucks to build a call list for factoring, insurance or
  fuel-card sales, or for double-brokering fraud.
- A fake hauler that sends interest to many landings to collect phone numbers through the reveal.
- Scrapers on public job pages and share links.
- Phishing and advance-fee scams in messages. Impersonation of a real mill or contractor.
- Invitation spam by a paying landing.
- Abuse of the phone-verification endpoint to run up SMS cost or to text a stranger.
- One-tap links forwarded or opened by a link scanner.

### 9.2 The law

- **Computer Fraud and Abuse Act**, [18 U.S.C. 1030](https://www.govinfo.gov/link/uscode/18/1030). *Van Buren v.
  United States*, 593 U.S. 374 (2021), reads "without authorization" as a gate that is up or down. *hiQ Labs v.
  LinkedIn*, 31 F.4th 1180 (9th Cir. 2022), held that scraping pages open to the public is probably not a
  violation. **So contact data must sit behind a login. A notice on a public page protects nothing.**
- **Contract.** Terms bind only someone who accepted them. A logged-out scraper has accepted nothing. This is one
  more reason for the login gate and for a recorded acceptance.
- **CAN-SPAM and TCPA** liability for messages sent to harvested contacts falls on the harvester. The privacy
  notice in §8.2, item 10 raises the harvester's exposure.
- **LogLoads' own exposure** is under FTC Act section 5 and state law if it promises protection it does not
  deliver, and in lost trust. "Never public" is a promise.

### 9.3 Required product changes

1. **No contact fields on any signed-out surface.** This covers job pages, share links, preview cards, structured
   data and the sitemap. Add a test that scans rendered public pages for phone and email patterns.
2. **Scrub public text fields.** Job descriptions, business descriptions and equipment notes reject or mask
   phone numbers, emails and links on save, and tell the user why.
3. **Phone reveal.** Only after the landing replies and opts in (founder decision 4). Each reveal is logged. A
   landing can turn the reveal off again. A hauler account that triggers many reveals in a short time is paused
   for review. The number is shown to that hauler organization only and is not in any list or export.
4. **Directory limits.** Find Trucks needs a landing organization that has passed identity review. Per-seat daily
   view and page limits. No bulk export. No endpoint that returns contact details in a list.
5. **Message limits.** New accounts have a daily cap on first contacts. Links in a first message are not
   clickable. Report and block are on every thread.
6. **Invitations.** Opted-in haulers only, one per job per hauler in the dedupe window, a per-hauler weekly cap
   across all landings (spec §10.23), and a "stop invitations from this landing" control.
7. **Verification endpoint.** See §4.4, item 11.
8. **One-tap links (R15).** Each link is tied to one user and one listing, does one thing, expires (72 hours is a
   reasonable default), and is single-use. Opening the link shows a page with the statement and a button. The
   action happens on the button press, not on the page load, because carriers and mail scanners open links. The
   page shows no contact details and creates no signed-in session. The press is recorded as the user's
   attestation with the token id.
9. **Impersonation.** A report reason for "this is not really that company", and a hold on a job when the
   organization name matches a known business that has not been identity-reviewed.
10. **Terms.** The clauses in §8.1, sections 8 and 12.

| | |
|---|---|
| Severity | High. The wedge is trust, and one harvested list ends it in a basin. |
| Product change | Items 1–10. Items 1–5 and 8 before gate A. Item 6 before invitations ship. |
| Counsel | No. The Terms clauses are reviewed with the Terms. |

### 9.4 Other risks worth a line each

- **False postings (R10).** User content is protected by 47 U.S.C. 230(c)(1). LogLoads' own statements about it
  are not. Attribute every freshness and availability label (§7.3, item 10). Never say "verified job" or "every
  job is real". Never seed listings (Blueprint §10.6 already forbids it). Support staff do not promise a specific
  removal; a broken promise can be enforced (*Barnes v. Yahoo!*, 570 F.3d 1096 (9th Cir. 2009)).
- **Reputation features (R12, P1).** A "consumer report" is information from a reporting agency bearing on a
  person's "character, general reputation, personal characteristics, or mode of living" that is used for, among
  other things, employment purposes ([15 U.S.C. 1681a(d)](https://www.govinfo.gov/link/uscode/15/1681a)). Courts
  disagree on whether vetting an independent contractor counts. An owner-operator is an individual. Keep
  reputation to facts LogLoads observed itself about a business's use of LogLoads (joined date, last confirmed,
  median reply time), which the Act excludes as first-hand experience information (1681a(d)(2)(A)(i)). Ratings by
  other users, and any outside record, need counsel first.
- **Pay analytics (R13, P1).** Showing landings an average or suggested pay rate for a basin is an exchange of
  price information among competing buyers of hauling. The federal agencies withdrew their information-exchange
  safe harbours in 2023, and the Sherman Act ([15 U.S.C. 1](https://www.govinfo.gov/link/uscode/15/1)) applies.
  Each job's posted pay is public and is fine. Benchmarks and suggestions need counsel first.
- **Employee driver jobs.** LogLoads lists work for hauling businesses. A posting for a W-2 driver brings in
  employment-advertising and pay-transparency law, and LogLoads could be called an employment agency
  ([42 U.S.C. 2000e(c)](https://www.govinfo.gov/link/uscode/42/2000e)). The posting rules should exclude employee
  recruiting until that is reviewed.
- **Sales tax.** Several states tax software subscriptions, Washington and Texas among them. Ask an accountant
  before gate D and show "plus applicable taxes" wherever a price appears.
- **Accessibility.** The design bar (WCAG 2.2 AA and the field rules) is the right mitigation for claims under the
  Americans with Disabilities Act. Keep the release tests in spec §12.5.

## 10. The nine questions deferred to this review

These are the questions listed in PR #311 and in the
[#114 register](https://github.com/AutomatedEmpires/logloads/issues/114#issuecomment-6786484699).

### Question 1. Does a public price list marked not for sale create advertising or offer duties, and may LogLoads say "free forever" to haulers?

**The price list.** It is not an offer that someone can accept. An advertisement is generally an invitation to
deal, and "not for sale yet" removes any doubt. It **is** advertising, so it must be true and not misleading (FTC
Act section 5 and state consumer protection acts). The FTC's fee rule ([16 CFR Part 464](https://www.ecfr.gov/current/title-16/part-464))
covers only live-event tickets and short-term lodging and does not apply. The ruling's restrictions are sound.
Three additions:

1. Add: "Prices and plan features can change before plans go on sale." Without it, a landing that plans around
   $149 has a complaint if the price moves.
2. The cards list features that are not built, such as targeted invitations. Add: "Plan features are planned and
   are not all available yet."
3. Add "plus applicable taxes" next to the prices.

"LogLoads charges no per-load, percentage or transaction fees" is a statement of present fact. Make sure it is
true for every account before it stays up, which is the LEG-2 check.

**"Free forever."** I recommend against the bare phrase. "Free" is acceptable when it is true and its conditions
are stated up front ([16 CFR 251.1](https://www.ecfr.gov/current/title-16/section-251.1)). "Forever" is a promise
with no end date and no escape. It would be broken by any later paid hauler feature, by a sale of the business or
by a shutdown, and a broken public promise is a deception claim and a possible contract claim. Use instead: "Free
for haulers and fleets. Finding work, listing your trucks and messaging landings will not cost you anything." The
Terms then define those core features, promise not to charge for them, and reserve the right to offer optional
paid extras and to end the service. The ruling's choice of "Free" on `/pricing` is right. Change the remaining
"free forever" strings at the next copy pass.

Counsel: a brief confirmation of the "free" promise wording. None needed for the price list.

### Question 2. The Terms: the liability cap, the effective date, the billing-record wording, the acceptance checkbox, the `percentage-v1-2026-08-03` acceptances, and the change notice

- **Liability cap.** "Platform fees you paid" gives a hauler a cap of zero and uses retired vocabulary. Replace it
  with the greater of the fees paid in the prior 12 months or a fixed floor, with the carve-outs the governing
  state requires. Counsel sets the floor and the carve-outs.
- **Effective date.** Wrong today (§8.0, item 4). Every change to the text gets a version id and its own effective
  date. The page shows both.
- **Billing-record wording in the Privacy Policy.** Inaccurate for the current product, but records from the old
  program may exist. Reword into two statements: what is kept from the program that ended on November 2, 2026 and
  why, and that billing is not open now and that Stripe will process payments when it opens.
- **The checkbox "accept the current LogLoads Terms".** "Current" does not identify a document. The label should
  read "I agree to the LogLoads Terms of Service and have read the Privacy Policy", with both linked. The box is
  unticked by default. The record stores the user, the version id of each document, the time and the IP address.
  SMS consent is never bundled into this box.
- **The `percentage-v1-2026-08-03` acceptances.** Those users agreed to a contract with fee terms. Removing a fee
  in the user's favour is low risk. Do three things: keep the archive at `/terms/2026-08-03` (already done); have
  the new Terms say they replace the earlier version from their effective date and that nothing new accrues under
  it; and ask those accounts to accept the new version at their next sign-in. Whether anything accrued under the
  old version depends on LEG-2.
- **Is the November 2 change notice enough?** As notice that two sections were removed, yes. As agreement to the
  Terms going forward, no, because "continued use is acceptance" is weak (§8.0, item 5). The rewrite ships with a
  recorded re-acceptance.

Counsel: **yes**, for the whole Terms rewrite.

### Question 3. Do targeted invitations, Sponsored boosts or the phone reveal change broker status?

- **Sponsored boosts: no.** Selling placement is advertising. Keep the label, and never sell a boost with a
  promise of trucks, inquiries or hires (Blueprint §7.4 already says this).
- **Phone reveal: no.** Passing on a number at the landing's choice is what a directory does. LogLoads takes no
  part in what the two then agree.
- **Targeted invitations: possibly, depending on who chooses.** This is the one feature where a shipper-side
  customer pays and LogLoads delivers its job to particular carriers. It stays on the marketplace side if the
  landing chooses every recipient from neutral, visible filters, LogLoads never chooses or recommends a specific
  carrier for a specific job, the count is on delivery and not on outcome, and staff never match by hand (§3.3,
  items 1, 2 and 9). The phrase "recommend appropriate hauling businesses" in Blueprint §6.3 should be built as
  "show the haulers that match the landing's filters".

Counsel: **yes**, before invitations are sold.

### Question 4. What must a founding offer disclose before it is switched on?

On the offer page, and again at checkout before payment details are taken:

1. Who qualifies: a landing organization with a current business-identity review, one offer per legal
   organization (COM-1).
2. The limit, and how it is counted: for example "the first 10 landing organizations to subscribe in each open
   basin", with the basin named. It must be literally true, and the remaining count shown must be real.
3. The discount and the base price: "50% off Pro: $149.50 a month instead of $299, plus tax".
4. How long: six paid billing cycles, and what counts as a cycle (SQL-DEC F5).
5. **What happens next: the plan renews at the full price each month until cancelled.** Give the amount and the
   date of the first full-price charge. This is the material term under the Restore Online Shoppers' Confidence
   Act ([15 U.S.C. 8403](https://www.govinfo.gov/link/uscode/15/8403)) and the state renewal laws.
6. How to cancel: online, in as few steps as signing up, effective at the end of the paid period.
7. A reminder before the discount ends. California requires one for promotional prices (Cal. Bus. & Prof. Code
   17602). Send it 7 to 21 days ahead to everyone.
8. What a plan change, a failed payment or a cancellation does to the discount, and whether it can be regained.
9. When the offer closes, and that it cannot be transferred or combined.
10. Nothing called "lifetime", "locked" or "guaranteed" unless the Terms make it so.

The 2024 federal "click-to-cancel" rule was vacated in July 2025 and the FTC restarted the rulemaking in 2026, so
the statute and the state laws are what govern today. Most state renewal laws protect household consumers, but the
federal Act is not limited that way in its text and the vacated rule expressly covered business customers. Build
to the consumer standard.

Counsel: **yes**, before the offer is switched on. The open commercial terms stay with the founder (deferred to
2026-11-24).

### Question 5. How long must the legacy billing and security evidence be kept (RET-2)?

No single law sets one period. The reference points:

| Source | Period |
|---|---|
| Federal tax records ([26 U.S.C. 6501](https://www.govinfo.gov/link/uscode/26/6501)) | 3 years from filing in the ordinary case; 6 years if income was understated by more than a quarter |
| Claims on a written contract | 4 years in California (Code Civ. Proc. 337), 5 in Idaho (Idaho Code 5-216), 6 in Washington ([RCW 4.16.040](https://app.leg.wa.gov/rcw/default.aspx?cite=4.16.040)) and Oregon (ORS 12.080), 8 in Montana (Mont. Code 27-2-202) |
| Federal civil penalty actions ([28 U.S.C. 2462](https://www.govinfo.gov/link/uscode/28/2462)) | 5 years |
| Broker transaction records, if the old program were ever treated as brokerage (49 CFR 371.3) | 3 years |
| Card disputes | Up to about 18 months under network rules |

**My recommendation:** keep the legacy billing records, fee agreements, acceptance records, Stripe references and
the security record for **7 years from the date LEG-2 confirms the old program is closed**, with access limited to
the founder and counsel, and then delete them. Seven years covers the longest ordinary contract period in the
states sampled, except Montana, and the six-year tax period. Use 8 years if a Montana basin opens and any legacy
customer was there. Until LEG-2 is done, nothing is deleted, which is the present rule (RET-1). A litigation hold
overrides the schedule.

Counsel: **yes.** Counsel names the minimum once the company's state and the LEG-2 result are known.

### Question 6. Should the publish attestation cite the Terms, and what is LogLoads' exposure for a false posting?

**Yes, it should.** Add one line under the three statements: "Publishing is subject to the LogLoads Posting
Rules", linked. That turns a false statement into a breach of contract, supports removal and suspension, and
supports the indemnity. Store each attestation with the user, the time and the version of the text shown.

**Exposure.** For the poster's false content, LogLoads has the immunity in 47 U.S.C. 230(c)(1), and the
attestation helps show the content is the poster's. The remaining exposure is in LogLoads' own conduct:

1. Its own statements about a listing: a freshness label, a mark or an audience count that is not attributed or is
   wrong (§7.3, item 10).
2. Its own marketing about listing quality, such as "real jobs only".
3. A specific promise to remove something that is not kept.
4. Continuing to sell placement for a posting it knows is fraudulent. Section 230 does not protect against
   federal criminal law, and knowing profit from fraud invites consumer protection claims.

A hauler who drives to a job that does not exist has a claim against the poster. The Terms should say so plainly
(§8.1, section 7).

Counsel: no, if the changes are made. It is reviewed with the Terms.

### Question 7. What terms are needed for proration, failed-payment grace, and `paused` or `unpaid` plans?

The Terms and the checkout must both state the following before gate D:

1. The billing date and that the plan renews each month until cancelled.
2. The price, that tax is added, and how much notice is given of a price change (I suggest 30 days).
3. **Upgrade:** effective at once, with a prorated charge for the rest of the period, shown before the user
   confirms.
4. **Downgrade:** effective at the next renewal, with no refund for the current period. What happens to landings
   and seats over the new limit (spec §9.15).
5. **Invitations on a plan change:** the allowance belongs to the billing period, the cap moves and the used count
   does not (F6). No rollover.
6. **Failed payment:** how many retries, over how many days, and the grace period. I suggest 7 days of full access
   while retries run. Then the plan is `unpaid`: entitlements stop (F7), jobs are unpublished and not deleted,
   and data is kept for a stated period (I suggest 90 days) so the landing can return.
7. **Paused:** LogLoads does not offer pausing (F7). If a provider status of `paused` ever appears, it is treated
   as no entitlement.
8. **Cancellation:** online, effective at the end of the paid period, with no partial-month refund unless the law
   requires one.
9. **Refunds:** the rule, and who to contact.
10. **Boosts:** a one-time charge, when the run starts, and what happens to unused days if the job is paused,
    filled or removed (Blueprint §7.5).
11. **Suspension for a breach:** whether any refund is due.
12. **Disputed charges:** contact LogLoads first; what a chargeback does to the account.

Governing law: 15 U.S.C. 8403, the state renewal laws and card network rules. Counsel: **yes**, before gate D.
`docs/ACTIVATION_STRIPE.md` §3 already gates this.

### Question 8. What notice is needed for admins reading messages and for public hauler listings?

See §6.5. In short:

- **Messages.** Staff access is lawful under 18 U.S.C. 2701(c)(1). Give notice in three places: the Privacy
  Policy, the Terms, and one line at first use of the composer. Limit the purposes to reports, fraud and abuse,
  and legal duties. Log every read (B-4 is already decided). Never pass message content to another user. Release
  to outsiders only on valid legal process.
- **Public hauler listings.** A just-in-time notice at publish that lists the visible fields and who sees them.
  Publishing is the hauler's choice and reversible. The directory is for signed-in landings, with `noindex`. No
  phone or email on public pages. The policy says a share link or cache can outlast unpublishing.

Counsel: no, beyond the Privacy Policy review.

### Question 9. Are reconfirm reminders and one-tap confirm links transactional, and what consent do they need?

- **By email: yes.** A reminder about a listing the user posted is a transactional or relationship message under
  15 U.S.C. 7702(17), provided it contains nothing promotional (16 CFR 316.3). No unsubscribe is legally required.
  Offer a way to change the channel or frequency anyway. A user who stops reminders must be told the listing will
  go stale and drop out of Find Work at 14 days.
- **By text: the TCPA has no transactional exemption.** The category only decides the level of consent. A
  reminder with no promotion in it is informational and needs prior express consent. The carriers require an
  opt-in for any recurring text in any case. So: an explicit, unticked opt-in to "listing and availability
  reminders by text", with the frequency stated, collected at phone verification and stored in the ledger (§4.3).
  Do not rely on the user merely having given a number.
- **Keep it clean.** If a reminder carries a boost offer, an upgrade prompt or another landing's job, it becomes
  marketing and needs written consent and the marketing quiet hours. The template lint in §4.4, item 6 enforces
  this.
- **The link.** Tapping it makes the user's attestation ("I confirm this job is currently available as
  described") without a login. Build it as in §9.3, item 8, so the confirmation is attributable and a link
  scanner cannot confirm a job by accident.

Counsel: **yes**, as part of the SMS consent review before gate B.

## 11. Prioritized product changes

### P0: before the gate named

| # | Change | Gate | Risk | Where |
|---|---|---|---|---|
| 1 | Rewrite the Terms, Privacy Policy and page metadata to the current product; replace the Marketplace Rules with Posting Rules; add SMS terms. Send to counsel. | A | R2, R6 | §8 |
| 2 | Versioned acceptance: unticked box, linked documents, stored version id, time and IP; re-acceptance on a material change and for legacy accounts. | A | R2 | §10 Q2 |
| 3 | Broker guardrails in the product: the landing picks every invitation recipient; named, visible sort keys only; no auto-selection; no outcome status on inquiries. | A (before invitations ship) | R1 | §3.3 |
| 4 | Add broker "holding out" phrases and bare verification words to `tools/check-guardrails.mjs`. | A | R1, R4 | §3.3, §7.3 |
| 5 | Mark each product in the controlled list as an unmanufactured forest product or not; show the notice on "Other", lumber, treated poles and equipment jobs. | A | R1 | §3.3 |
| 6 | Pilot staff rule: no manual matching, relaying or rate suggestions. | A | R1 | §3.3 |
| 7 | Verification marks: full-sentence label, neutral icon, "what this means" sheet, 12-month expiry, no ranking effect, attributed freshness labels. | A | R4, R10 | §7.3 |
| 8 | Anti-harvest pack: no contact on signed-out surfaces (with a test), scrub public text fields, reveal log and limits, directory limits and identity review for Find Trucks, new-account message caps. | A | R5 | §9.3 |
| 9 | One-tap links: single purpose, expiring, single-use, action on a button press, no session, recorded as an attestation. | A (with #292) | R15 | §9.3 |
| 10 | Outbox retention: purge job, blank invitee emails, no message bodies in `payload`. Adopt the retention schedule. | A | R6 | §6.3, §6.4 |
| 11 | Privacy notices and requests: composer notice about staff access, publish notice for hauler profiles, `noindex` on profiles, a privacy request path, an incident plan. | A | R11, R6 | §6.5, §6.6 |
| 12 | No session replay, chat widget or advertising pixel on message, sign-in, verification and consent screens. | A | R6 | §6.5 |
| 13 | Verification intake rejects documents showing Social Security, driver's licence or bank numbers. | A | R6 | §6.6 |
| 14 | Pricing copy: add the "can change", "planned features" and tax lines; replace "free forever" with the defined promise. | A | R8 | §10 Q1 |
| 15 | Publish attestation links the Posting Rules and stores the text version. | A | R10 | §10 Q6 |
| 16 | Posting rules exclude employee-driver recruiting. | A | §9.4 | §9.4 |
| 17 | SMS consent screen and ledger, STOP and HELP, quiet hours, caps, template lint, endpoint protection. | Before any SMS consent is collected (#291) | R3 | §4.3, §4.4 |
| 18 | A release check so the SMS budget cannot be raised above 0 until brand and campaign registration, the SMS terms page and counsel sign-off are recorded. | B | R3 | §4.4 |
| 19 | Email: template class, footer with postal address, one-click unsubscribe, suppression list, true subject lines, domain authentication. | C (#253) | R7 | §5.3 |
| 20 | Billing terms and checkout disclosures; founding offer disclosures; sales-tax setup. | D | R9 | §10 Q4, Q7 |

### P1: after launch

1. Review each basin's state for intrastate broker, texting and renewal law as the basin list is decided.
2. Reputation features: first-hand facts only until counsel has reviewed them (R12).
3. Landing analytics: no pay benchmarks or suggested pay until counsel has reviewed them (R13).
4. "Smart matching" and any export to ticketing tools: a transportation-law opinion first (R1).
5. Reassigned-number checks for SMS.
6. Register a copyright agent.
7. Close out the legacy program after LEG-2 and start the retention clock (R14).
8. Recheck state privacy thresholds at 25,000 users in any state.
9. An accessibility statement and a contact route.
10. Recheck the law in this document every six months. The TCPA items change fastest.

## 12. Questions for licensed counsel

**Transportation counsel**

1. With the design choices in §3.3, is LogLoads outside 49 U.S.C. 13102(2) and 49 CFR 371.2 when it sells targeted
   invitations? What would you change?
2. Does the exempt-commodity position (rough logs, pulpwood, chips) hold for our job mix, and what should we do
   about lumber, treated poles and equipment moves?
3. For each planned basin state: does state law regulate an intrastate load board or broker, and does any of it
   reach us?
4. Did the retired per-load fee program (the Terms of August 3, 2026) create exposure under 49 U.S.C. 14916, and
   how should it be closed out?
5. After *Montgomery v. Caribe Transport II*, do our marks, filters or invitations create a negligent-selection
   risk, and is the wording in §7.3 enough?

**Technology, privacy and consumer counsel**

6. Please review the rewritten Terms and Privacy Policy. In particular: the liability cap and its floor, governing
   law, arbitration or not, and the re-acceptance plan for legacy accounts.
7. Is the SMS consent wording sufficient for written consent, and do targeted invitations and job alerts need
   it? Which state registration or bond duties apply to us (Texas first)?
8. May we promise haulers free core features in the form proposed in §10, question 1?
9. What minimum retention period applies to the legacy billing and security evidence (RET-2), and are the periods
   in §6.4 acceptable?
10. What must the founding offer and the plan checkout disclose in our states, and do you agree we should build
    to the consumer renewal standard?
11. Is the verification mark wording acceptable, and should the identity review itself change?
12. Before we build them: reputation facts under the Fair Credit Reporting Act, and pay benchmarks under antitrust
    law.

## 13. Sources and what was checked

Checked on 2026-11-10. "Primary" means I opened the government text. "Secondary" means I relied on a law-firm
summary.

| Source | Checked | Note |
|---|---|---|
| 49 U.S.C. 13102(2), 14916 | Primary | Quoted from the current US Code. |
| 49 CFR 371.2, 371.3; 49 U.S.C. 13501, 13506, 13904, 13906 | Cited from the current code | Text of 371.2 confirmed through the 2023 guidance, which quotes it. |
| FMCSA, *Definitions of Broker and Bona Fide Agents*, 88 FR 39368 (2023) | Primary | Final guidance; still FMCSA's position. |
| FMCSA FAQ on exempt commodities; Administrative Ruling 119 | Primary | Forest products entries read in full. |
| *Montgomery v. Caribe Transport II*, No. 24-1238 (U.S. May 14, 2026) | Primary (syllabus) | Unanimous. |
| RCW 81.80.430; RCW 19.190.060 | Primary | Washington only. |
| 47 U.S.C. 227; 47 CFR 64.1200 | Cited from the current code | Not re-read line by line today. |
| FCC fact sheet, September 2026; FCC 26-67 (October 1, 2026) | Fact sheet primary; order secondary | Federal Register publication of FCC 26-67 not confirmed. |
| *Steidinger* (7th Cir. 2026); *Howard v. RNC* (9th Cir. 2026) | Secondary | Not opened. |
| *Facebook v. Duguid* (2021); *McLaughlin Chiropractic* (2025); *Insurance Marketing Coalition v. FCC* (11th Cir. 2025) | From knowledge, consistent with 2026 summaries | |
| CTIA Messaging Principles; carrier registration | Industry rules, not law | Requirements change; check with the SMS provider at registration. |
| 15 U.S.C. 7701–7713; 16 CFR Part 316 | Cited from the current code | |
| FTC civil penalty adjustment, 90 FR 5580 (January 2025) | Primary | The 2026 adjustment was not confirmed. |
| Cal. Civ. Code 1798.140(d); California Attorney General CCPA page | Threshold confirmed by a 2026 summary | The dollar threshold is adjusted in odd-numbered years. |
| State privacy laws in force in 2026 | Secondary | Thresholds vary; see §6.1. |
| Negative option rule: Eighth Circuit vacatur (July 2025); FTC advance notice (March 2026) | Secondary | No replacement rule is in force. |
| 15 U.S.C. 8403; 18 U.S.C. 1030, 2701, 2702; 47 U.S.C. 230; 15 U.S.C. 1681a; 17 U.S.C. 512; 15 U.S.C. 7001 | Cited from the current code | |
| Texas, Florida and Oklahoma texting laws; state limitation periods in §10, question 5; state breach laws in §6.1 | From knowledge | Counsel should confirm each before a basin opens there. |
| Case law in §8.0 and §9 (*Douglas*, *Berman*, *Meyer*, *Van Buren*, *hiQ*, *Barnes*) | From knowledge | Well-established holdings; not re-read today. |

**Reminder.** An AI agent wrote this. It is a map for the founder and for counsel, not a substitute for counsel.
Where it says "counsel: yes", the product should not pass that gate on the strength of this document alone.
