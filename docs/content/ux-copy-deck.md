# LogLoads UX copy deck

**Status:** Draft for founder review. Not approved. Not in the product. Do not publish, send, or turn on billing from this file.
**Issue:** [LogLoads #274](https://github.com/AutomatedEmpires/logloads/issues/274)
**Written against:** `origin/work/logloads-repair` at `bfef185c08b60efbfb242b8d612a362a6b5ce4a4`
**Voice rule:** Quality bar v1, rule U3 — plain, specific, active voice, consistent product terms. Every button names its outcome. No filler. Source: [issue 235, comment 6783016152](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6783016152).

## How to read this deck

Braces are live data, for example `{job title}`. The sample names below show the sentence with real words. They are not listings, customers, or counts.

| Sample | Use |
|---|---|
| North Ridge Logging | The landing organization already used on the design-system page |
| North Ridge Landing | One physical landing, public area "near Elk Creek, Oregon" |
| Cedar Ridge Hauling | A hauling business |
| Sam Carter, sam@example.com | The example person already on the design-system page. Not a customer. |

Product terms follow the UX spec glossary (Appendix B) and the writing rules in §12.4. Use those words in labels, buttons, emails, and empty states.

| Say | Do not say |
|---|---|
| Trucks requested | Trucks secured, trucks hired, slots filled |
| Availability updated today by hauler | Live now, truck online |
| Targeted invitation delivered | Hauler contacted and hired |
| Sponsored | Top recommended, featured pick |
| $475 per load | $475, when the basis is unstated |
| Expression of interest | Bid, booking, assignment, contract |
| Approximate location | Exact pin, for a public map |
| Active landing | A destination, a route, or a truck |

LogLoads publishes hauling opportunities and lets the parties talk. It does not dispatch trucks, track a haul, settle freight, or take a percentage of pay.

The November 2026 market-research note is not on this branch. This deck states no market size, no audience count, and no "haulers near you" number unless the screen is showing a count the system actually measured.

## Pricing wording: decision #108, options A and B

Founder decision [#108](https://github.com/AutomatedEmpires/logloads/issues/108) is still open. Wherever a price, plan name, or boost fee would appear, both wordings are side by side. Pick one. Do not mix them on one screen.

**Option A — interim, no prices.** The sentence proposed on #108, unchanged:

> Haulers and fleets are free. Paid landing memberships are planned and not yet available; LogLoads charges no per-load or percentage fees.

No dollar amounts. No plan cards. No boost checkout. No founding discount. The Terms notice about the closed pilot stays a legal decision, not a line in this deck.

**Option B — the adopted commercial language, still not a live checkout.** Prices are the locked November 1, 2026 blueprint. Say "$499 per month", never "$499/mo". Memberships are not purchasable until a separate billing activation. Buttons that would take money stay disabled, with the status line under the table.

| Surface | Option A | Option B |
|---|---|---|
| Home, price band | Haulers and fleets are free. Paid landing memberships are planned and not yet available; LogLoads charges no per-load or percentage fees. | Haulers and fleets are free. Landing plans, when billing is open: Basic $149 per month, Pro $299 per month, Regional $499 per month. |
| Plan cards | Omit the cards. One link: "Read how landing plans will work." | Three cards. Copy is in Marketing, below. |
| Boosts | "Sponsored placement is not offered yet." | 7 days $99, 14 days $149, 28 days $199. Copy is in Boosts, below. |
| Billing page title | Billing | Billing |
| Billing status | Paid landing memberships are planned and not yet available. LogLoads charges no per-load or percentage fees. | Status line: "Billing is not open. Nothing on this page charges you." Then the plan, allowances, and renewal terms. |
| First-run, landing path | "Create the business profile. A paid landing membership is not available yet." | "Create the business profile. You will choose Basic, Pro, or Regional when billing is open." |
| Hauler upsell | None. Haulers and fleets stay free. | None. Haulers and fleets stay free. |
| Button that would charge | Do not show it. | Label the future button "Continue to payment". Until activation, the control is disabled and reads "Payment is not open". |

Option B plan facts, for the cards and the billing page. Source: blueprint §3.1 and §7.1, UX spec §2.3.

| | Basic | Pro | Regional |
|---|---|---|---|
| Price | $149 per month | $299 per month | $499 per month |
| Active landings | 1 | 3 | Unlimited authentic landings |
| Team members, owner included | 2 | 5 | 10 |
| Targeted invitations each billing cycle | 3 | 10 | 30 |
| Unused invitations | They expire at the reset. They do not roll over. | Same | Same |
| Job posts, inbound inquiries, replies, trucks requested | No numerical cap on genuine use | Same | Same |
| Hauler directory | Included | Included | Included |
| Saved hauler searches, availability alerts, job templates | Not on Basic | Included | Included |
| Multi-landing inbox | Not on Basic | Included | Included |
| Regional capacity view and multi-site team tools | Not on Basic or Pro | Not on Pro | Included |
| Support | Standard | Standard | Priority |
| Boosts | Optional, one job at a time | Same | Same |

"Unlimited" means no numerical cap on genuine posts, inquiries, replies, and trucks requested at allowed active landings. It does not allow duplicate spam, fake landings, or harassment.

Founding offer, Option B only, and only after a launched state is defined. Issue #114 still owns that definition, so this sentence is not ready to publish:

> The first 10 qualifying landing organizations in each state LogLoads has opened get 50% off the plan they choose for the first 6 billing cycles. One offer per verified organization. Boosts stay at full price. The next invoice after the 6th cycle is the full plan price: Basic $149 per month, Pro $299 per month, or Regional $499 per month.

Hauler recognition, Option B, with no price:

> Hauling businesses are free. The first 1,000 qualifying hauling businesses may be marked Founding hauler. That mark is recognition. It is not a check of insurance, safety, or equipment.

## Shared strings

Use these whenever the situation matches. Screen sections add the title and the recovery button.

| Id | Situation | Copy |
|---|---|---|
| S1 | Loading | Loading {screen name}. The layout stays put. |
| S2 | Network error | {Screen name} didn't load. Try again. |
| S3 | Offline, form | You're offline. This draft stays on this device. Submit when you are back, so you don't send it twice. |
| S4 | Offline, read | You're offline. Showing the last saved {screen name} from {time}. |
| S5 | Permission | You don't have access to that in {organization}. Switch business if it belongs to another one. |
| S6 | Stale weather | Weather is unavailable. The last reading was {time} from {source}. It is not current. |
| S7 | Map down | The map didn't load. The list still has the jobs. |
| S8 | Sponsored mark | Sponsored |
| S9 | Freshness, job | Last confirmed {relative time} by {organization} |
| S10 | Freshness, truck | Availability updated {relative time} by hauler |
| S11 | Stale truck | Not recently confirmed |
| S12 | Pay missing | Pay not stated |
| S13 | Negotiable | Negotiable |
| S14 | Approximate place | Approximate location |
| S15 | Report received | Report received. We record it. We don't promise a particular result. |
| S16 | Saved | Saved. |
| S17 | Couldn't save | Couldn't save. Your entries are still in the form. Try again. |

Accessible names match the visible label unless a row below says otherwise. Loading regions use S1 as the accessible name. Buttons that are in progress read "{button} — working" and stay disabled until the request finishes.

## Navigation labels

Public: Home, Find work, For haulers, For landing operators, Trust, Help.

Landing, desktop: Overview, Landings, Job postings, Inquiries, Find trucks, Team, Billing, Settings.

Landing, phone: Home, Jobs, Inbox, Search, More.

Hauler and fleet: Find work, Inquiries, Invitations, Profile, Truck, Saved, Settings. A fleet with more than one truck also shows Equipment and Capacity. Fleet is the same free account, not a second product.

Account menu: Sign in. Switch business. Sign out. Current context reads "{organization} · {Landing or Hauling} · {Owner, Manager, or Staff}".

## Marketing pages

### Home

**Job to be done:** Tell a visitor what LogLoads is, then start Find work or the landing path.

**Title:** Find log-truck work. Or find log trucks.

**Body:** LogLoads is a timber-hauling load board. Landing businesses post the work. Hauling businesses see the pay, the equipment, and the area, then express interest. You arrange the haul yourselves.

**Primary button:** Find work
**Secondary button:** Post hauling work

**How it works, haulers:**

1. Look through jobs near the area you work.
2. Compare pay, equipment, and dates.
3. Express interest. It is not a contract.

**How it works, landings:**

1. Add the landing you are recruiting from.
2. Post the job with pay and equipment.
3. Read inquiries and reply.

**Proof band:** If the system has published jobs, the heading is "Recent jobs" and each card uses the Find work card strings. If it has none: "No jobs are published right now." Button: "Get an alert when jobs are posted in your area." Do not invent a listing, a review, a star rating, or a count of trucks.

**Price band:** Option A or Option B from the pricing table. No third sentence.

**Footer links:** For haulers, For landing operators, Trust, Help, Terms, Privacy.

### For haulers

**Title:** Hauling work, with the terms on the card.

**Body:** Find jobs, show your equipment, and set your own availability. Haulers and fleets are free. Expressing interest does not hire you, and it does not cost you.

**Primary button:** Create a hauler profile
**Secondary button:** Find work

**Points:**

- Pay is shown with its basis: per load, per ton, per hour, or per mile.
- You choose the area and the equipment you will take.
- A fleet can offer more than one truck on one expression of interest.
- Availability is what you report. LogLoads does not track the truck.

**Empty of regional work, if this page also lists jobs:** "No jobs are published in this area right now." Button: "Save this search".

### For landing operators

**Title:** Post the work. Hear from haulers who fit.

**Body:** Publish genuine hauling jobs, keep landings on file, and reply to every inquiry. Targeted invitations and Sponsored placement are optional tools for a landing plan. They do not hire a truck.

**Primary button:** Option A: "Create a landing profile". Option B: "See landing plans".
**Secondary button:** Find work

**Option A body addition:** the #108 sentence, and nothing about dollars.

**Option B cards.** Each card's button is "Choose {plan}" when billing is open, and "Payment is not open" while it is not.

- Basic. $149 per month. One active landing. Two team members, including you. Three targeted invitations each billing cycle. Unlimited genuine job posts and inquiries.
- Pro. $299 per month. Three active landings. Five team members. Ten targeted invitations. Saved searches, availability alerts, and job templates.
- Regional. $499 per month. Unlimited authentic active landings. Ten team members. Thirty targeted invitations. A regional view of self-reported capacity.

Under the cards: "Invitations that you do not send expire at the reset. They do not roll over. A boost is a separate purchase for one job: $99 for 7 days, $149 for 14 days, or $199 for 28 days. A boost does not add invitations, and it does not promise inquiries."

Founding sentence: the Option B founding paragraph. Hide it until #114 defines a launched state.

### Trust

**Title:** What LogLoads checks, and what it does not.

**Body:** A verified business mark names the check that was done, such as business identity. It does not mean LogLoads inspected the truck, the insurance, the license, or the road.

**Points:**

- Public maps show an approximate location.
- Gate codes, private roads, and private phone numbers stay off the public job.
- Expressing interest does not unlock those details. The landing shares them on purpose.
- Pay and availability are what the business stated, with the time they stated it.
- Sponsored means a landing paid to promote one job.

**Primary button:** Report a problem
**Secondary button:** Read Help

### Help

**Title:** Help

**Intro:** Search a question, or contact support.

**Contact label:** Contact support
**Help:** We reply to the address on your account. Support cannot see gate codes or private landing notes unless you put them in the message for an open case.

**Empty search:** "No articles match {query}." Button: "Contact support".

**Articles to title, not to draft here:** Express interest, Targeted invitations, Sponsored jobs, Availability, Active landings, Team members. Each article must use the glossary and must not promise a hire.

### Business profile, public

**Title:** {organization}

**Meta:** {Hauling business or Landing} · {service area} · Joined {month year}

**Verification:** "Business identity verified" only after that specific review. Otherwise "Not verified". Absence of the mark is not an accusation.

**Primary button, on a hauler profile viewed by a landing:** Prepare a targeted invitation
**Primary button, on a landing profile viewed by a hauler:** See jobs
**Disabled invitation:** "Targeted invitations need a landing plan and an eligible, opted-in hauler."

**Empty jobs:** "No published jobs right now."
**Empty equipment:** "No equipment listed."

## First run and sign-in

Sign-in and the verification email come from the identity provider. This deck covers the LogLoads screens around them. Sender defaults already in the repo are `LogLoads <notifications@logloads.com>` and reply-to `support@logloads.com` (`apps/web/lib/notify.ts` at this commit). Those are configuration defaults, not a claim that a person reads every message.

### Sign in

**Title:** Sign in to LogLoads
**Primary button:** Sign in
**Secondary button:** Create an account
**Text link:** Email me a sign-in link

**Fields**

| Label | Help | Validation |
|---|---|---|
| Email | Use the email you want on this account. | Enter an email address. That email is not valid. |
| (no password field on the link path) | We email a one-time link. The link expires. | The link expired. Email a new sign-in link. |

**Loading:** "Sending a sign-in link."
**Error:** "The sign-in link didn't send. Try again."
**Unverified email, after return:** "Confirm your email to finish sign-in." Button: "Resend confirmation".
**Success:** "Check {email} for a sign-in link."

### Choose a path

**Title:** What do you need to do?
**Body:** You can belong to more than one business. You will switch between them on purpose.

**Choice cards:**

- Title: "I have trucks". Description: "I am looking for hauling work." Button inside the card is the card itself. Accessible name: "I have trucks. I am looking for hauling work."
- Title: "I need log trucks". Description: "I post hauling jobs." Accessible name: "I need log trucks. I post hauling jobs."

**Primary button:** Continue
**Error:** "Choose the work you are here to do."

### Hauler setup

**Title:** Set up your hauling business
**Body:** This account is free. You can look for work before every optional field is filled in.

**Fields**

| Label | Help | Validation |
|---|---|---|
| Business name | The name landings should see. | Enter the business name. |
| Your name | The person responsible for this account. | Enter your name. |
| Service area | A town, a county, or a region you will travel for work. This is not your home address, and it is not a live location. | Enter a service area. |
| Work you can take | Choose the truck and trailer types you run. | Choose at least one equipment type, or skip and add it under Truck. |

**Primary button:** Save and find work
**Secondary button:** Skip equipment for now
**Loading:** "Saving your profile."
**Error:** S17
**Interrupted:** "Your setup is saved. Continue where you left off." Button: "Continue setup".

### Landing setup

**Title:** Set up your landing business
**Body, Option A:** Create the business profile. A paid landing membership is not available yet. You can still record the business name and the landing.
**Body, Option B:** Create the business profile. You will choose Basic, Pro, or Regional when billing is open.

**Fields**

| Label | Help | Validation |
|---|---|---|
| Business name | The name haulers should see on the job. | Enter the business name. |
| Your name | The owner of this landing organization. | Enter your name. |
| Landing name | The name your crew uses for this place. | Enter a landing name. |
| Public area | Town or area haulers may see. Not the gate location. | Enter the public area. |
| State | Used later for a founding offer, once a launched state is defined. | Choose a state. |

**Primary button:** Save landing profile
**Secondary button:** I'll finish this later
**Checklist after save:** "Add the public description." "Post a job." "Invite a teammate." Option B adds "Choose a plan when billing is open."

### No organization yet

**Title:** This sign-in is not on a business yet
**Body:** Join the business you were invited to, or create one.
**Primary button:** Create a hauling business
**Secondary button:** Create a landing business
**If an invite is waiting:** "You were invited to {organization} as {role}." Button: "Join {organization}".

### Duplicate invite

**Title:** You are already on {organization}
**Body:** This invitation was already used, or you are already a member.
**Primary button:** Open {organization}

### Switch business

**Title:** Switch business
**Body:** You are in {organization}. Switching clears private details from the previous business.
**Rows:** "{organization} · {Landing or Hauling} · {role}"
**Primary button on the row:** Switch to {organization}
**Empty:** "You belong to one business."
**Error:** S5
**Confirm, if a form is dirty:** Title: "Switch business without saving?" Body: "Changes on this page will be lost." Buttons: "Stay and keep editing" and "Switch without saving".

## Landing overview

**Job:** See what needs attention in this landing organization.

**Title:** {organization}
**Eyebrow, Option A:** Landing workspace
**Eyebrow, Option B:** {Basic, Pro, or Regional} · {role}

**Primary button:** Post a job
**Secondary buttons:** Review inquiries, Find trucks

**Metric labels:**

- Active landings: "{n} of {allowance}" or, on Regional, "{n} active". Help: "Only landings that are recruiting count. Saved and archived landings do not."
- Published jobs: "{n}"
- New inquiries: "{n}"
- Invitations left: "{n} of {allowance}". Help: "Resets {date}. Unused invitations do not roll over." Option A, before a plan exists: hide the invitation metric and show "Targeted invitations are part of a landing membership, which is not available yet."

**Attention chips:** "Draft not published", "Job not confirmed since {date}", "Inquiry waiting", "Landing paused".

**Empty, no landing:** Title: "Create your first landing". Body: "A landing is a real place you recruit trucks from." Button: "Add a landing".
**Empty, no jobs:** Title: "No jobs posted". Body: "Post the work haulers need in order to decide." Button: "Post a job".
**Empty, no inquiries:** Title: "No inquiries yet". Body: "When a hauler expresses interest, it shows up here."
**Loading:** S1 with "overview".
**Error:** "Overview didn't load. The last summary, from {time}, is still here." Button: "Try again".
**Offline:** S4.
**Permission, foreman:** "You are seeing the landings assigned to you."
**Success, after publishing from here:** "Job posted. Haulers can find it now."

## Landings

**Title:** Landings
**Primary button:** Add a landing

**Tabs:** Active, Saved, Archived
**Row:** "{landing name} · {public area} · {n} published jobs · {foreman name or Unassigned} · Updated {date}"

**Row actions:** Edit landing, Activate landing, Pause recruiting, Archive landing, Assign staff

**Activate confirm:** Title: "Activate {landing name}?" Body, Option B: "This uses 1 of your {allowance} active landings. Jobs at this landing can be published." Body, at the cap: "Your plan has {allowance} active landings, and all of them are in use. Pause another landing, or change plan when billing is open." Buttons: "Activate landing" and "Cancel". Option A: "Activating a landing will count toward a membership that is not available yet. You can save the landing now."

**Archive confirm:** Title: "Archive {landing name}?" Body: "Archived landings do not count as active. Published jobs at this landing come off Find work. The record stays." Buttons: "Archive landing" and "Keep it active". If jobs are published, add: "Pause or archive {n} published jobs with the landing."

**Duplicate warning:** "{landing name} matches a landing you already saved. Open that landing instead of adding a second one."

**Empty, Active:** "No active landings." Button: "Add a landing".
**Empty, Saved:** "No saved landings."
**Over the cap:** "You have {n} active landings. This plan allows {allowance}. Pause one before you activate another."
**Loading / error:** S1 / S2.

### Landing detail

**Title:** {landing name}
**Tabs:** Summary, Jobs, Site notes, Access

**Visibility labels:** "Public" and "Private to your landing team".

**Summary fields:** Public area, Description, Days and hours, Time zone, Typical equipment, Approach warning haulers may see.

**Access fields:** Precise location, Gate or road instructions, Private contact. Help: "Haulers do not see this tab. Sharing it is a separate action on an inquiry."

**Primary button:** Edit landing
**Secondary:** Pause recruiting, Reconfirm site notes

**Missing precise location:** "No precise location yet. Jobs can still show the public area."
**Weather:** S6 when missing. When present: "{summary}. {source}, {time}."
**Error:** S2.

## Job postings

**Title:** Job postings
**Primary button:** Post a job

**Tabs:** Draft, Published, Paused, Expired, Archived
**Search label:** Search jobs
**Filters:** Landing, Equipment, Status

**Row:** "{job title} · {landing name} · {product} · {pay and basis, or Negotiable, or Pay not stated} · Starts {date or Ongoing} · {n} trucks requested · {n} inquiries · {Sponsored or Not sponsored} · Last confirmed {date}"

**Row buttons:** Edit job, Preview as hauler, Publish job, Pause job, Publish again, Archive job, Duplicate as a new job, Promote this job

**Pause confirm:** Title: "Pause {job title}?" Body: "Haulers will not be able to express interest. The job stays on file. A Sponsored job stops being promoted while it is paused." Buttons: "Pause job" and "Keep it published".

**Archive confirm:** Title: "Archive {job title}?" Body: "It leaves Find work. Inquiries you already have stay in the inbox." Buttons: "Archive job" and "Cancel".

**Empty, Draft:** "No drafts." Button: "Post a job".
**Empty, Published:** "No published jobs." Button: "Post a job".
**Empty, search:** "No jobs match {query}." Button: "Clear search".
**Landing just paused:** "This job is unlisted because {landing name} is paused."
**Staff without access:** hide the button. If they open the URL: S5.
**Draft restored:** "Draft saved {time}."
**Loading / error:** S1 / S2.

### Job editor

**Title, new:** Post a job
**Title, edit:** Edit {job title}
**Steps:** Basics, Pay and scope, Equipment, Review

**Primary buttons by step:** Continue, Continue, Continue, Publish job
**Secondary:** Save draft, Back
**Preview toggle:** Preview the public card, Preview the public job, Preview what only your team sees

**Autosave:** "Draft saved {time}." Do not autosave gate codes into the public draft.

#### Basics

| Label | Help | Validation |
|---|---|---|
| Job title | Name the work so a hauler can tell jobs apart. | Enter a job title. A published job at this landing already uses this title. Open that job, or change this title. |
| Landing | The job is tied to one active landing. | Choose a landing. This landing is paused. Activate it or choose another. This landing is archived. |
| Public area | Filled from the landing. Haulers see this, not the gate. | Add a public area on the landing before you publish. |
| Product | Sawlogs, pulpwood, poles, or another type in the list. | Choose a product. |
| Start | A date, a range, or Ongoing. Times use the landing's time zone, {zone}. | Choose when the work starts. |
| Expected duration | How long you expect to need trucks. | Enter a duration, or choose Ongoing. |

#### Pay and scope

| Label | Help | Validation |
|---|---|---|
| Pay amount | Optional if you mark pay as negotiable. Do not invent a number. | Enter a number greater than zero, or mark pay as negotiable. |
| Pay basis | Per load, per ton, per hour, per mile, or other. $475 per load is not $475 per day. | Choose a pay basis whenever an amount is entered. |
| Pay is negotiable | Shows "Negotiable" on the card. It does not show a dollar figure. | Clear the amount, or turn this off. A job cannot be both a stated rate and negotiable. |
| Trucks requested | How many trucks you want. This is not a count of trucks hired. | Enter at least 1. |
| Estimated loads per day | Optional. Your estimate. LogLoads does not count the loads. | Enter a number, or leave this blank. |
| Estimated haul distance | Optional. Say what the number measures. | Add the basis, such as "about 42 miles by the county road", or leave both blank. |
| Destination | Optional. A mill or area. Keep private access out of this field. | — |
| Road note haulers may see | Optional. Safe summary only. | Move gate codes and private road names to the landing's Access tab. |

#### Equipment

| Label | Help | Validation |
|---|---|---|
| Truck and trailer | Types you will load. | Choose at least one type. |
| Notes | Weight, length, or configuration limits a hauler should know. | — |
| How haulers reach you | The route for this job. A public page does not gain a private number unless you select that method. | Choose a contact method. |

#### Review

**Summary headings:** Public card, Public job, Private to your team.
**Confirm line:** "Publishing makes the public card and the public job visible on Find work."
**Publish blocked, Option A, if a paid entitlement is required to publish:** "Publishing a recruiting job needs a landing membership. That membership is not available yet. Your draft is saved."
**Publish blocked, inactive landing:** "Activate {landing name} before you publish."
**Publish blocked, missing fields:** "Add {field} before you publish." The field error also sits on the field.
**Success:** "Job posted. Haulers can find it now." Button: "View job".
**Offline:** S3. Button stays "Publish job" and does not fire twice.

### Job management

**Title:** {job title}
**Status chip:** Draft, Published, Paused, Expired, or Archived
**Header facts:** {landing name} · {pay and basis} · {equipment} · {n} trucks requested · S9

**Tabs:** Public preview, Inquiries, Updates, Promotion, Activity

**Primary button:** Edit job
**Secondary:** Pause job, Publish again, Reconfirm this job, Promote this job

**Reconfirm:** "Confirm that the pay, dates, equipment, and trucks requested are still right." Button: "Reconfirm job". Success: "Job reconfirmed {date}."

**Material change confirm:** Title: "Tell haulers the terms changed?" Body: "Pay, dates, or equipment changed. Haulers with an open inquiry can be emailed." Buttons: "Save and notify haulers" and "Save without notifying".

**Inquiries tab empty:** "No expressions of interest yet."
**Promotion tab, no boost:** Option A: "Sponsored placement is not offered yet." Option B: "This job is not sponsored." Button: "Promote this job".
**Expired boost:** "The Sponsored period ended {date}. The job stays published."
**Paused while sponsored:** "A paused job is not sponsored. Promote it again after you publish it."
**Failed purchase:** "Payment didn't complete. The job is unchanged and it is not sponsored."
**Activity row:** "{person} {action} · {time}". Actions: published, paused, reconfirmed, edited pay, edited dates, edited equipment.

## Express interest

Presented as a sheet over the job. The job summary stays visible.

**Title:** Express interest
**Job line:** "{job title} · {pay and basis} · {public area} · {n} trucks requested"

**Body:** "Tell {organization} what you can bring. This is not a haul agreement, and it does not reserve the job."

**Fields**

| Label | Help | Validation |
|---|---|---|
| Business | The hauling business offering the trucks. | Choose a business. You don't have a hauling business yet. Create one. |
| Truck and trailer | A configuration on that business's profile. | Choose a configuration. Add equipment on Truck before you offer it. |
| Trucks offered | How many of that configuration you are offering. | Enter at least 1. That is more trucks than {business} lists for this configuration. Update the profile, or offer fewer. |
| Available from | The first day you can start. | Choose a date. |
| Note | Optional. Keep it short. Don't send gate requests here. | — |
| How {organization} may reach you | Phone, email, or in LogLoads. | Choose one. |

**Profile line:** "They will see your public business profile."
**Primary button:** Send interest
**Secondary button:** Cancel
**Loading:** "Sending interest."
**Success:** "Interest sent to {organization}. You can follow it under Inquiries."
**Duplicate:** "You already sent interest in this job. Update that inquiry instead of sending a second one." Button: "Update inquiry".
**Job closed while open:** "This job is not accepting interest. It is {paused, expired, or archived}." Button: "Back to Find work".
**Offline or double tap:** S3. One submit creates one inquiry.
**Unsigned visitor:** Title stays "Express interest". Body: "Sign in to send interest. The job stays public." Button: "Sign in".

## Inquiries

### Landing inbox

**Title:** Inquiries
**Tabs:** New, Replied, Waiting, Closed
**Filters:** Job, Landing

**Row:** "{hauling business} · {equipment} · {n} trucks offered · Available {date} · {job title} · {time}"
**Unread:** "New"

**Primary button on a row:** Reply
**Also:** Ask for a detail, Mark closed, Reopen inquiry, Report abuse, Assign (Pro and Regional, Option B)

**Reply field label:** Reply
**Help:** "Sent to {business}. This reply does not use a targeted invitation."
**Primary button:** Send reply
**Validation:** Enter a reply.
**Success:** "Reply sent."

**Ask for a detail button:** Ask for a detail
**Templates, labels only:** "What trailer are you running?", "What day can you start?", "We don't need more trucks on this job."

**Close confirm:** Title: "Close this inquiry?" Body: "The thread stays in Closed. The hauler is not hired or declined unless you said so in the reply." Buttons: "Close inquiry" and "Keep it open".

**Withdrawn by hauler:** "Cedar Ridge Hauling withdrew this interest."
**Job paused:** "The job is paused. This inquiry stays on file. New interest is off."
**Grouped duplicate:** "{n} messages from {business} on this job, shown as one inquiry."
**Empty, New:** "No new inquiries."
**Empty, filter:** "No inquiries for {job title}."
**Permission:** S5
**Loading / error:** S1 / S2.

### Hauler inquiries

**Title:** Inquiries
**Tabs:** Active, Replied, Withdrawn, Closed
**Row:** "{job title} · {landing organization} · Sent {date} · {last response or No reply yet}"

**Primary button:** Open inquiry
**Also:** Update trucks offered, Withdraw interest

**Withdraw confirm:** Title: "Withdraw your interest?" Body: "{organization} will see that you withdrew. The job is not cancelled by this." Buttons: "Withdraw interest" and "Keep it active".
**Success:** "Interest withdrawn."
**Expired job:** "This job is no longer published. Your inquiry stays here."
**Hidden organization:** "This business is unavailable."
**Empty:** "You haven't expressed interest yet." Button: "Find work".
**Status words allowed:** Sent, Replied, Waiting on you, Withdrawn, Closed. Do not use Hired, Booked, or Completed.

## Find trucks and targeted invitations

### Find trucks

**Title:** Find trucks
**Body:** "Hauling businesses that published a profile. Availability is what they last reported."

**Search label:** Search by business or area
**Filters:** Equipment, Public area, Availability updated within
**Option B, Pro and Regional:** button "Save this search". Option B, Basic, and all of Option A: "Saved searches are on Pro and Regional." Do not show a broken control. Show the sentence and no disabled mystery button.

**Card:** "{business} · {service area} · {equipment} · {n} trucks, self-reported · S10 or S11 · {Business identity verified or Not verified}"

**Primary button:** View profile
**Secondary:** Invite to this job

**Empty:** "No hauling businesses match." Body: "Widen the area. LogLoads will not invent a match." Button: "Clear filters".
**Stale row badge:** S11
**Map failure:** S7
**Loading / error:** S1 / S2.
**Location prompt:** "Search by town or area. LogLoads does not need your GPS."

### Invitation composer

**Title:** Send a targeted invitation
**Steps:** Choose job, Eligible haulers, Recipients, Preview, Confirm

**Allowance bar, Option B:** "{n} of {allowance} invitations left. Resets {date}. Unused invitations do not roll over."
**Allowance bar, Option A:** "Targeted invitations are part of a landing membership, which is not available yet." Primary action is absent.

**Step 1.** Label: "Job". Help: "Only a published job at an active landing." Validation: "Choose a published job."

**Step 2.** Heading: "Eligible haulers". Body: "{n} opted-in hauling businesses match this job's equipment and area." Empty: "No eligible haulers. An invitation is only sent to a business that opted in and fits. Your allowance is not used." Button: "Back to Find trucks".

**Step 3.** Label: "Recipients". Help: "One invitation per business. Sending again to the same business for this job does not send a second invitation." Validation: "Choose at least one business." "You selected {n}, and you have {remaining} invitations left. Remove {extra}."

**Step 4.** Heading: "What they will receive". Show the exact subject and the first paragraph from the invitation email. Line: "This sends {n} targeted invitations. It does not hire anyone."

**Step 5 confirm.** Title: "Send {n} targeted invitations?" Body: "Each delivered invitation uses one from this cycle. A failed delivery does not." Buttons: "Send invitations" and "Cancel".

**Result, all delivered:** "Delivered {n} targeted invitations. {remaining} left this cycle."
**Result, mixed:** "Delivered {delivered}. {failed} failed and did not use an invitation. {remaining} left."
**Result, none eligible:** "Nothing sent. {n} businesses were eligible."
**No allowance:** "No invitations left. They reset on {date}. LogLoads will not add extra invitations or charge an overage."
**Job paused at send:** "This job is paused. Publish it before you invite anyone."
**Offline:** S3. The button does not create a second send.

### Hauler invitation inbox

**Title:** Invitations
**Body:** "Jobs a landing sent you because you opted in. An invitation is not a hire, and you don't pay to receive it."

**Card:** "{job title} · From {organization} · {public area} · {equipment} · {pay and basis} · Matches {equipment} in {area} · Respond by {date or No deadline}"

**Buttons:** View job, Express interest, Decline invitation, Mute {organization}, Report spam

**Decline confirm:** Title: "Decline this invitation?" Body: "{organization} is not told a reason unless you add one." Field: "Note to {organization}" optional. Buttons: "Decline invitation" and "Keep it".

**Expired:** "This job is no longer accepting interest."
**Muted:** "You muted {organization}. New invitations from them stay off until you unmute them in Settings."
**Empty:** "No targeted invitations."
**Loading / error:** S1 / S2.

## Boosts

### Option A

**Title:** Sponsored jobs
**Body:** "Sponsored placement is not offered yet."
No prices, no checkout, no countdown.

### Option B

**Title:** Promote {job title}
**Body:** "A boost sponsors one published job for a fixed number of days, about 100 straight-line miles from the public landing area. It is labeled Sponsored. It does not add invitations, and it does not promise views, inquiries, or trucks."

**Choices:**

- 7 days · $99. Button: "Sponsor this job for 7 days".
- 14 days · $149. Button: "Sponsor this job for 14 days".
- 28 days · $199. Button: "Sponsor this job for 28 days".

**Summary before pay:** "One job. {n} consecutive days. ${price}. Starts when payment completes, ends {date}. No automatic renewal."
**Audience line, when a real count exists:** "{n} hauling businesses in this area updated a profile in the last {period}."
**Low audience:** "Sponsored placement is turned off for this area. There isn't a large enough audience to promote this job honestly." Hide the price buttons.
**Already sponsored:** "{job title} is sponsored through {date}."
**Primary, billing closed:** "Payment is not open"
**Primary, billing open:** "Continue to payment"
**Refund line:** "If you pause or withdraw the job, promotion stops. Refunds follow the terms published at checkout. Those terms are not written yet."
**Success:** "{job title} is Sponsored through {date}."
**Failure:** "Payment didn't complete. The job is not sponsored."
**Performance, only with measured numbers:** "{n} views · {n} inquiries · since {date}." If measurement is down: "Performance figures are unavailable. We will not estimate them."

The public card always shows S8, "Sponsored", as text, not color alone.

## Team

**Title:** Team
**Body, Option B:** "{n} of {allowance} seats, including the owner."
**Body, Option A:** "Teammates you add will count toward a landing membership that is not available yet."

**Primary button:** Invite a teammate

**Row:** "{name} · {email} · {Owner, Manager, or Staff} · {landing names or All landings} · Last sign-in {date or Not yet}"
**Pending row:** "Invite pending · expires {date}"

**Invite fields**

| Label | Help | Validation |
|---|---|---|
| Email | The person who will sign in. A seat is a person, not a truck. | Enter an email address. {email} is already on this team. |
| Role | Owner manages billing and seats. Manager runs assigned landings, jobs, and invitations if you allow it. Staff replies to inquiries you assign. | Choose a role. |
| Landings | Which landings this person may open. | Choose at least one landing, or All landings. |
| Can send targeted invitations | Uses this organization's allowance. | — |

**Send button:** Send invite
**At the cap:** "All {allowance} seats are in use. Remove a teammate before you invite another."
**Resend:** Button: "Resend invite". Success: "Invite sent again to {email}."
**Revoke confirm:** Title: "Remove {name}?" Body: "They lose access to {organization} immediately." Buttons: "Remove teammate" and "Cancel".
**Sole owner:** "Add another owner before you leave. A landing organization needs one owner."
**Wrong organization:** "That invite is for {other organization}. Switch business to open it."
**Expired invite:** "This invite expired. Ask the owner to send a new one."
**Empty:** "You are the only person on this landing organization." Button: "Invite a teammate".

### Fleet team

Same screen pattern, with this body: "This hauling business is free. Teammates here do not use landing seats."
Roles: Owner, Manager, Staff.
Permissions to name in the form: "Update equipment and availability" and "Reply to inquiries".
**Empty:** "You are the only person on this hauling business."

## Billing

**Title:** Billing
**Who sees it:** The landing owner. Everyone else gets "Billing is managed by the owner of {organization}."

### Option A

**Status:** "Paid landing memberships are planned and not yet available. LogLoads charges no per-load or percentage fees."
**Hauler who opens the URL:** "Hauling businesses are free. There is no plan to buy."
No card form. No invoices for a new plan. If historical pilot invoices exist, the heading is "Older billing records" and the row is "{date} · {document name} · View". Do not describe them as a current percentage fee.

### Option B

**Status while billing is closed:** "Billing isn't active yet. You can set up landings and draft jobs." Nothing on this page charges the business. With no plan, the allowance lines read "0 active landings", "1 member", and "No targeted invitations". Change plan, update payment method, and purchase a boost stay disabled. This matches the settings frames on `docs/product/figma/FG04-settings/README.md`.
**When a subscription is active:** "{plan} · ${price} per month · Renews {date}."
**Usage:** "Active landings {n} of {allowance}." "Seats {n} of {allowance}." "Invitations {n} of {allowance} left · resets {date}."
**Founding, when granted:** "Founding rate ${intro} per month through {end date}. Then ${full} per month."
**Payment method:** "Payment method ending {last4}, expires {month year}." Button: "Update payment method". The card form is the payment provider's, not a LogLoads form. LogLoads does not ask for the full card number.
**Invoices:** "{date} · ${amount} · {Paid, Open, or Failed}." Button: "View invoice".
**Empty invoices:** "No invoices yet."

**Change plan button:** "Change plan"
**Confirm upgrade:** Title: "Change to {plan}?" Body: "You will be billed ${price} per month starting {date}, minus any credit the payment provider applies. You gain {landing allowance} active landings, {seat allowance} seats, and {invitation allowance} invitations this cycle. Invitations still do not roll over." Buttons: "Change plan" and "Cancel".
**Confirm downgrade:** Title: "Change to {plan}?" Body: "The lower plan starts {date}. Before then, choose which landings stay active and which teammates keep a seat. Jobs and inquiry history stay." Buttons: "Choose what to keep" and "Cancel".
**Past due:** "The last payment failed. Update the payment method by {date} to keep posting and inviting. Find work for haulers is unaffected."
**Cancel:** Button: "Cancel membership". Confirm title: "Cancel {plan}?" Body: "Access continues through {date}. After that, publishing and targeted invitations stop. Jobs and records stay. Haulers you already replied to keep the thread." Buttons: "Cancel membership" and "Keep the membership".

**Hauler account that hits this URL:** "Hauling businesses are free. There is nothing to bill."

## Settings

### Landing settings

**Title:** Settings
**Sections:** Business profile, Notifications, Privacy, Support

**Business fields:** Business name, Public description, Contact method, Time zone.
**Validation:** Enter a business name.

**Notification toggles, each with On and Off:**

| Label | Help |
|---|---|
| New inquiries | Email me when a hauler expresses interest. |
| Inquiry replies | Email me when a hauler writes back. |
| Invitation delivery | Email me when a targeted invitation is delivered or fails. |
| Job confirmation reminders | Email me when a published job has not been reconfirmed. |
| Billing | Email the owner about invoices and failed payments. This one stays on for the owner. |
| Product news | Occasional product notes. Optional. |

**Frequency, for optional mail:** Immediately, Daily digest, Off.
**Quiet hours:** "Start" and "End". Help: "Optional mail waits. A failed payment email does not."

**Privacy:** "Show the business name on jobs" is required for a published job. "Show a phone number on the public job" is off unless chosen.

**Support button:** Contact support
**Delete is not on this page for a landing with billing history.** "To close the organization, contact support. Records we must keep stay in the billing archive."

### Hauler settings

**Title:** Settings
**Sections:** Account, Businesses, Notifications, Privacy, Your data, Support

**Account:** Email, Sign-out of other sessions. Button: "Sign out other sessions". Success: "Other sessions are signed out."
**Free line:** "This hauling business is free."

**Notification toggles:**

| Label | Help |
|---|---|
| Job alerts | Email me about new jobs that match a saved search. |
| Targeted invitations | Landings may send me a targeted invitation. Off means I am not eligible. |
| Inquiry replies | Email me when a landing replies. |
| Job changes | Email me if a job I inquired about changes pay, dates, or equipment. |
| Product news | Optional. |

**Frequency:** Immediately, Daily digest, Off.
**Quiet hours:** same as landing.
**Unsubscribe line, also in every optional email:** "You can turn this off in Settings."

**Your data:** Button: "Download my data". Button: "Request deletion". Help: "Deletion does not erase billing records another organization must keep, or an inquiry thread the other party holds."
**Confirm deletion:** Title: "Request deletion of your account?" Body: "We will close your sign-in and take your public profile off Find trucks. Open inquiries stay visible to the landing that received them, without your private contact details." Buttons: "Request deletion" and "Cancel".
**Success:** "Deletion requested. We will email {email} when it is done."

**Empty businesses:** "You are not a member of a business." Button: "Create a hauling business".

### Saved jobs and alerts

**Title:** Saved
**Tabs:** Jobs, Searches

**Job row:** "{job title} · {pay and basis} · {public area} · Saved {date}"
**Closed job:** "No longer published."
**Button:** Remove saved job
**Empty jobs:** "No saved jobs." Button: "Find work".

**Search fields:** Name, Area, Radius, Equipment, Product, Pay basis, Alert.
**Alert choices:** Off, Daily digest, Immediately.
**Help:** "Alerts are free. They use the area you typed. They do not follow your phone."
**Primary button:** Save search
**Validation:** Name this search. Enter an area.
**Empty searches:** "No saved searches."
**No matches:** "Nothing new matches {search name}."
**High volume:** "This search matches many jobs. It will arrive as a daily digest."

### Truck and availability

**Title:** Truck
**Primary button:** Save equipment

**Fields:** Truck type, Trailer type, Notes, Photo.
**Photo help:** "A photo of the truck or trailer. We compress it on this device."
**Photo error:** "That file can't be used. Choose a JPEG or PNG under the size shown on the picker."
**Photo progress:** "Uploading photo, {percent}."

**Availability label:** Availability
**Choices:** Available, Not available, Not sure.
**Available from:** date.
**Service area:** text.
**Help:** "This is what you report. It is not a GPS location, and it is not a dispatch status."
**Primary button:** Update availability
**Success:** "Availability updated {time} by you."
**Stale banner:** "You have not confirmed availability since {date}. Fresh searches hide this truck until you do. The profile stays up." Button: "Update availability".
**Empty:** "Add the truck you haul with." Button: "Add a truck".

### Hauler profile

**Title:** Profile
**Preview heading:** "What a landing sees"
**Primary button:** Save profile

**Fields:** Business name, Your name, Service area, Description, Equipment summary, Photo.
**Visibility on each public field:** "Shown on your public profile" or "Kept private".
**Required private fields:** Email. Help: "Used for sign-in and notices. Not shown on the public profile."
**Verification button:** Request a business-identity review
**Help:** "If approved, the mark says business identity. It does not rate your work."
**Incomplete banner:** "Add {field} so landings can see it. You can still use Find work."
**Empty description:** the field is blank, not filler text.
**Success:** "Profile saved."

## Find work

**Title:** Find work
**Search label:** Search jobs
**Chips:** {equipment}, Within {radius} of {area}, Saved only
**Header prompt if availability is stale:** "Update availability" using the truck banner sentence.

**Card, in this order:** {product and title}. {public area}. {pay amount} {basis}, or Negotiable, or Pay not stated. {equipment}. {duration}. {n} trucks requested. {distance} if the poster supplied one, labeled "Poster estimate". S9. S8 when sponsored.

**Card button:** View job
**Icon button accessible names:** Save job, Remove saved job.

**Primary results note:** "{n} jobs". Sponsored jobs are in the list with the Sponsored label. They do not replace the list.

**Empty area:** "No jobs are published in this area right now." Buttons: "Widen the area", "Save this search".
**Empty equipment filter:** "No jobs need {equipment}. " Button: "Clear equipment".
**Loading:** S1, "jobs". The typed search stays.
**Error:** S2.
**Offline:** S4, and the list remains if it was already loaded.
**Map toggle:** "List" and "Map". Map empty error: S7.

### Filters

**Title:** Filters
**Fields:** Area, Radius, Equipment, Product, Pay basis, Start, Duration, Updated since.
**Pay basis help:** "Jobs stay in their own units. A per-load rate is not sorted as if it were per mile."
**Buttons:** Show {n} jobs, Reset filters
**Unknown area:** "Enter a town or area. We won't guess from GPS."
**No results:** "No jobs match these filters." Button: "Widen the area".

### Job detail, hauler

**Title:** {job title}
**Header:** {organization}. {pay and basis}. {public area}, labeled Approximate location. {equipment}. Starts {date or Ongoing}. {duration}. {n} trucks requested.

**Primary button:** Express interest
**Secondary:** Save job, Share summary, Report this job

**Sections:** Haul terms, Location and weather, Road notes, About {organization}.

**Haul terms include only what the poster entered:** product, estimated loads per day, destination, distance and its basis, loading hours.
**Distance help:** "The poster supplied this figure. It is not a routed guarantee."
**Road note:** "Confirm road suitability with {organization}. A public note is not a promise the road is open."
**Weather:** "{summary}. {source}, {time}." or S6.
**Private block, signed out or not shared:** "Precise directions and gate details are not on this page. The landing shares them if they choose to."
**Closed:** "This job is {paused or expired}. Interest is closed." Replace the primary button with "Find other work".
**Unspecified pay:** S12 or S13, never a calculated daily gross.
**Share text:** "{job title} · {pay and basis} · {public area} · on LogLoads". No gate text in the share.
**Report reasons:** Fake work, Pay looks wrong, Stale, Suspicious contact, Abusive language, Wrong equipment, Private information exposed.
**Report field:** Details, optional.
**Report button:** Submit report
**Report success:** S15.

## Fleet

Fleet copy is the hauler copy plus the lines below. Do not say Fleet plan, Dispatch, or a fee.

**Overview title:** {business}
**Primary button:** Update capacity
**Counts:** "{n} trucks listed · {n} available · {n} not sure · {n} not available · Confirmed {date}."
**Help:** "These counts are what your business reported. They are not a GPS location."
**Empty:** "Add the first truck." Button: "Add a truck".
**Stale:** "Capacity has not been confirmed since {date}." Button: "Update capacity".

**Equipment title:** Equipment
**Primary button:** Add a truck
**Row:** "{truck type} · {trailer type} · {Available, Not available, Not sure, or Not recently confirmed}"
**Archive confirm:** Title: "Archive this truck?" Body: "It leaves your live equipment. Inquiries that already named it keep the description you sent." Buttons: "Archive truck" and "Cancel".

**Capacity title:** Capacity
**Columns:** Configuration, Listed, Available now, Available from, Last confirmed.
**Button:** Update availability
**Unknown:** show S11, not "0 available", when the number was not confirmed.
**Validation:** "Available trucks can't exceed the number listed for {configuration} unless you add the trucks first."
**Success:** "Capacity updated {time}."

**Multi-truck interest:** same sheet as Express interest. Label "Trucks offered" repeats per configuration. Button stays "Send interest". Help: "One expression of interest can name several trucks. It still is not a dispatch."

**Fleet inbox extra:** "Assigned to {name}" and button "Assign follow-up". Conflict: "{name} sent a reply {time}. Read it before you send another."

## Admin

Internal. Every page starts with "LogLoads staff". Actions that change a customer require a reason field: label "Reason", validation "Enter the reason. It is stored with your name and the time."

### Overview

**Title:** Review queue
**Links:** Business identity, Reports, Stale jobs, Billing exceptions, Support.
**Counts are numeric, including zero.** Empty: "Nothing waiting." Do not write a launch metric.
**Provider down:** "{source} is unavailable. Counts may be behind."

### Business identity

**Title:** Business identity
**Tabs:** Pending, Verified, Denied, Suspended
**Decision buttons:** Verify business identity, Ask for more information, Deny, Suspend the mark.
**Mark text the public will see:** "Business identity verified".
**Deny reason the customer sees:** "We couldn't verify the business identity from what was submitted."
**Ask:** "Send {organization} a request for {document}."
**Empty:** "No businesses waiting for review."

### Jobs and reports

**Title:** Jobs and reports
**Buttons:** Ask the poster to edit, Pause listing, Remove listing, Restore listing, Warn {organization}.
**Pause confirm:** Title: "Pause this listing?" Body: "It leaves Find work. The poster is emailed. Pay text is not rewritten." Buttons: "Pause listing" and "Cancel".
**Remove confirm:** Title: "Remove this listing?" Body: "It leaves Find work. Say why."
**Empty:** "No open reports."

### Subscriptions

**Title:** Subscriptions
**Read-only line:** "{organization} · {plan} · {payment state} · Landings {n}/{allowance} · Seats {n}/{allowance} · Invitations {n}/{allowance}."
**Button:** Open in the payment provider
**Override, rare:** "Adjust entitlement". Fields: Allowance, Expires, Reason. Help: "This does not edit the card. It expires on {date} unless you set a new date."
**Historical obligation:** "Older pilot records stay. Do not recast them as this plan."
**Empty:** "No landing subscription on file."

### Invitation quality

**Title:** Invitations
**Columns:** Organization, Cycle, Sent, Delivered, Failed, Complaints.
**Failed help:** "Failed deliveries did not use the allowance."
**Low area:** "Do not sell extra invitations here. Add-on packs are not approved."
**Empty:** "No invitations sent this cycle."

### Promotions

**Title:** Promotions
**Row:** "{job} · {start}–{end} · {radius} · ${price} · {Active, Paused, or Ended}"
**Button:** Pause promotion
**Confirm:** "Pause stops Sponsored placement. It does not rewrite the job."
**No audience:** "Purchase was correctly blocked. No eligible audience."
**Empty:** "No promotions."

### Founding offers

**Title:** Founding offers
**Body:** "First 10 qualifying landing organizations per opened state. 50% off for 6 billing cycles. One per verified organization. State-open rules are not settled (#114). Do not grant from this screen until they are."
**Buttons, after the rule exists:** Grant founding rate, Revoke as a duplicate.
**Revoke confirm:** "Revoke the founding rate for {organization}? The next invoice uses the full plan price. Enter the reason."
**Empty:** "No founding offers."

### Support

**Title:** Support
**Case row:** "{organization} · {category} · {Open or Closed} · {time}"
**Reply button:** Send reply
**Close button:** Close case
**Sensitive open:** "Open private landing details". Confirm: "This access is logged. Open only for this case." Buttons: "Open for this case" and "Cancel".
**Empty:** "No open cases."

### Marketplace health

**Title:** Marketplace health
**Intro:** "Counts of registered businesses, opted-in recipients, recently confirmed availability, published jobs, and inquiries. A registration is not an eligible recipient."
**Low sample:** "Too few businesses to judge this area."
**Empty:** "No activity in this area."
Do not show a map of private landings.

### Security audit

**Title:** Audit
**Filters:** Actor, Organization, Action, From, To.
**Row:** "{actor} · {action} · {object} · {time} · {result}"
**Empty:** "No events in this range."
**If the log is down:** "The audit log is unavailable. High-risk actions stay disabled until it is back."

## Emails

Optional mail includes a one-click unsubscribe for that category and the sentence "You can turn this off in Settings." Security and failed-payment mail do not include an unsubscribe. Every message names the business and the job. None of them say the truck is hired.

From-name: LogLoads. Address: the configured sender, currently `notifications@logloads.com` in `apps/web/lib/notify.ts`. Reply-to for inquiry mail is the other party's chosen contact method. Reply-to for everything else is `support@logloads.com`.

### Targeted invitation

**Subject:** {organization} invited you to a job near {public area}
**Preheader:** {job title} · {pay and basis} · not a hire

{organization} sent you a targeted invitation because you opted in and your equipment fits.

{job title}
{pay and basis}
Approximate location: {public area}
{equipment}
Starts {date or Ongoing}
{n} trucks requested

This is not a haul agreement. You can ignore it.

Button: View the job
Secondary link: Decline the invitation

You are receiving this because targeted invitations are on for {hauling business}.

### Invitation failed, to the landing

**Subject:** An invitation was not delivered
**Preheader:** Your allowance was not used

The targeted invitation to {hauling business} for {job title} was not delivered. It does not count against the {allowance} for this cycle. {remaining} invitations are left. They reset {date}.

Button: Review invitations

### Inquiry received, to the landing

**Subject:** {hauling business} is interested in {job title}
**Preheader:** {n} trucks offered · available {date}

{hauling business} expressed interest. This is not a hire.

{equipment}
{n} trucks offered
Available {date}
Note: {note or None}

Button: Reply to {hauling business}

Replying does not use a targeted invitation.

### Inquiry reply, to the hauler

**Subject:** {organization} replied about {job title}
**Preheader:** Open the inquiry to read it

{organization} replied to your expression of interest in {job title}.

"{first 140 characters of the reply}"

Button: Read the reply

The reply is about this job. It is not a contract.

### Inquiry reply, to the landing when the hauler writes again

**Subject:** {hauling business} replied about {job title}
**Preheader:** Open the inquiry to read it

Button: Read the reply

### Interest withdrawn

**Subject:** {hauling business} withdrew interest in {job title}
**Preheader:** The inquiry stays in your Closed or Withdrawn list

Button: Open the inquiry

### Job alert, immediate

**Subject:** New job near {area}: {job title}
**Preheader:** {pay and basis} · {equipment}

A published job matches {search name}.

{job title}
{pay and basis}
Approximate location: {public area}
{equipment}
{S8 if sponsored}

Button: View the job

You are receiving this because job alerts are on for {search name}.

### Job alert, daily digest

**Subject:** {n} jobs match {search name}
**Preheader:** Daily digest · {date}

{For each job, one block: title, pay and basis, public area, equipment, Sponsored if applicable, and a View the job link.}

If a search matched nothing: do not send the digest.

You are receiving this because {search name} is set to a daily digest.

### Job terms changed

**Subject:** {organization} updated {job title}
**Preheader:** Pay, dates, or equipment changed

{organization} changed this job after you expressed interest.

{What changed, one line each: Pay is now {rate}. Start is now {date}. Equipment is now {list}.}

Your inquiry is still open. The change is not a new agreement.

Button: Review the job

### Reconfirm a job, to the landing

**Subject:** Reconfirm {job title}
**Preheader:** Haulers still see the last confirmation from {date}

{job title} at {landing name} is published. The last confirmation was {date}. If the pay, dates, equipment, or trucks requested changed, update the job. If they are right, reconfirm it.

Button: Reconfirm this job
Secondary: Pause job

### Team invite, landing

**Subject:** {inviter} invited you to {organization} on LogLoads
**Preheader:** {role} · landing team

{inviter} invited you to the landing organization {organization} as {role}. A seat is for a person on that business. It is not a haul.

Button: Join {organization}

This invite expires {date}. If you were not expecting it, ignore it.

### Team invite, hauling business

**Subject:** {inviter} invited you to {hauling business} on LogLoads
**Preheader:** Free hauling business · {role}

{inviter} invited you to {hauling business} as {role}. This business is free. You can {permission list}.

Button: Join {hauling business}

### Boost started, Option B only

**Subject:** {job title} is Sponsored through {date}
**Preheader:** {n} days · ${price} · one job

Payment completed. {job title} is labeled Sponsored through {date}, about 100 straight-line miles from {public area}. This does not add targeted invitations and does not promise inquiries.

Button: View promotion

Do not send this email under Option A.

### Payment failed, Option B only, owner, no unsubscribe

**Subject:** Payment failed for {organization}
**Preheader:** Update the payment method by {date}

The payment for {plan} at ${price} per month did not go through. Update the payment method by {date} to keep publishing and sending targeted invitations. We do not charge a per-load fee.

Button: Update payment method

### Business identity result

**Verified subject:** Business identity verified for {organization}
**Body:** LogLoads verified the business identity of {organization}. The public mark says "Business identity verified". It does not cover insurance, equipment, or safety.

**Denied subject:** Business identity was not verified
**Body:** We couldn't verify the business identity of {organization} from what was submitted. The public profile stays up without the mark. You can submit again.

Button: Open the profile

### Listing paused by staff

**Subject:** {job title} was paused by LogLoads
**Preheader:** It is off Find work

LogLoads paused {job title}. Reason: {reason}. The pay text was not changed. You can edit it and ask for a review.

Button: Open the job

### Report received

**Subject:** We received your report
**Preheader:** {job title or organization}

We recorded your report about {job title or organization}. We don't promise a particular result. You will not be copied on the other party's private details.

## Confirmations index

| Action | Title | Confirm button | Dismiss |
|---|---|---|---|
| Switch with unsaved edits | Switch business without saving? | Switch without saving | Stay and keep editing |
| Activate landing | Activate {landing name}? | Activate landing | Cancel |
| Archive landing | Archive {landing name}? | Archive landing | Keep it active |
| Pause job | Pause {job title}? | Pause job | Keep it published |
| Archive job | Archive {job title}? | Archive job | Cancel |
| Notify on term change | Tell haulers the terms changed? | Save and notify haulers | Save without notifying |
| Send invitations | Send {n} targeted invitations? | Send invitations | Cancel |
| Decline invitation | Decline this invitation? | Decline invitation | Keep it |
| Close inquiry | Close this inquiry? | Close inquiry | Keep it open |
| Withdraw interest | Withdraw your interest? | Withdraw interest | Keep it active |
| Remove teammate | Remove {name}? | Remove teammate | Cancel |
| Cancel membership | Cancel {plan}? | Cancel membership | Keep the membership |
| Delete account | Request deletion of your account? | Request deletion | Cancel |
| Pause a listing, staff | Pause this listing? | Pause listing | Cancel |
| Open private details, staff | Open private landing details? | Open for this case | Cancel |

Destructive buttons use the danger style. The confirm button repeats the verb in the title.

## Open points for the founder

1. Pick Option A or Option B on #108. Until then, prices do not ship.
2. Define a launched state on #114 before any founding sentence is public.
3. Write boost refund and early-cancellation terms before the Option B checkout lines are public. This deck refuses to invent them.
4. Write the downgrade rule for extra landings and seats in the published billing policy. This deck only says the owner chooses what to keep and that history stays.
5. Give the postal address required on commercial email, if counsel wants one. It is not in the product spec, so it is not invented here.
6. Sign-in mail stays with the identity provider unless you want LogLoads to replace it.

## Sources

- UX spec `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, including §2, §3.1–§3.4, §4, §5, §6, §7, §8.19, §8.21, §12.4, and Appendix B. Commit `bfef185c08b60efbfb242b8d612a362a6b5ce4a4`. The spec file is unchanged from `10187e99fd8397300cd413f4d18ff13d5aa444ff`.
- Blueprint `docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md` §3.1, §3.2, §6, §7, §8. Same commit.
- Settings frames: `docs/product/figma/FG04-settings/README.md` at the same commit. Example person Sam Carter is taken from that page and from FG00.
- Quality bar v1, rule U3: [issue 235 comment 6783016152](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6783016152).
- Pricing options A and B: [issue 108](https://github.com/AutomatedEmpires/logloads/issues/108).
- Launched state still open: issue #114, as recorded in `AGENTS.md` §1.6.
- Sender defaults: `apps/web/lib/notify.ts` at the same commit.
- The November 2026 market-research note is absent on this branch, so no research statistics are cited.
