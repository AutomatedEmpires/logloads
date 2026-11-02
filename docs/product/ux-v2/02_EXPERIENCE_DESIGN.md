# V2 experience design

> **Status:** PROPOSED design, 2026-11-02. It is not user-validated; see [04_EVALUATION_PLAN.md](./04_EVALUATION_PLAN.md).
> **Inputs:** UX spec v1.0, Blueprint v1.0, and the audit in [01_AUDIT_AND_GAP_MATRIX.md](./01_AUDIT_AND_GAP_MATRIX.md).
> **Clickable prototype:** the "LogLoads V2 Prototype" artifact, linked from #116. It uses fictional sample businesses and does not touch the application.
> **Boundary:** no new features beyond the Blueprint and spec, no pricing changes, no database design. Fields and flows reuse what the spec defines.

---

## 1. Design principles

1. **The decision comes first.** On every job surface, a hauler sees pay with its basis, equipment, approximate area, start and duration, trucks requested and freshness **before** anything else, including the map.
2. **One obvious action per screen.** A phone screen has one primary button. Secondary actions are quiet.
3. **The context is always visible.** Every signed-in screen names the business you are acting as and your role in it. Switching is deliberate.
4. **Public and private are visibly different.** Every profile and site form shows which fields other businesses can see. Private fields sit in a separate, labelled panel.
5. **Self-reported means labelled.** Availability, truck counts and estimates always carry a source and a date.
6. **Text first, the rest on request.** The list is complete without the map, the weather or images. Forms work without JavaScript.
7. **One application, progressive disclosure.** A one-truck owner-operator and a ten-truck fleet use the same screens. Fleet tools appear when a second truck or a second member exists. Basic, Pro and Regional share one landing workspace, and higher tiers add panels rather than separate apps.

---

## 2. Information architecture

### 2.1 Global structure

```text
Public (signed out or in)
  Home · Find work (list | map) · Job detail · For haulers · For landing operators (plans)
  · Business profile · Trust & help

Signed in: top bar = [LogLoads] [Business switcher: "Ridgeline Hauling · Hauler · Owner"] [Account]

Hauler workspace (free; also the fleet workspace)
  Find work · Saved · Inquiries (Inquiries | Invitations) · My trucks (equipment + availability;
  becomes a "Fleet" capacity board at 2+ trucks) · Business profile · Alerts & settings · Team (2+ members)

Landing workspace (paid; one app for Basic, Pro and Regional)
  Overview · Jobs · Inbox · Find trucks · Landings · Team · Billing & boosts · Settings

Admin (separate privilege boundary; out of scope here)
```

The hauler set follows Blueprint §546 ("Find Work; Map; Saved Jobs/Alerts; My Profile; Equipment & Availability; and Inquiries"). The landing set follows spec §4.0.

### 2.2 Navigation by device

| | Mobile (< 960 px) | Desktop (≥ 960 px) |
|---|---|---|
| Hauler | Bottom tabs: **Find work · Inquiries · My trucks · Profile**. "Saved" is a filter chip in Find work, and Alerts sit under Profile. | Left sidebar, 232 px: all seven items with unread counts. |
| Landing | Bottom tabs: **Home · Jobs · Inbox · Find trucks · More**. More holds Landings, Team, Billing & boosts and Settings. | Left sidebar with the eight items from spec §4.0. A plan chip at the foot shows "Basic · 1 of 1 landings". |
| Both | Top bar, 56 px: logo, business switcher chip, account. No preview banner inside workspaces; the "preview" note moves into the account menu while the flag is on. | Same top bar. Find work and Inbox use master–detail at ≥ 1280 px. |

**Fixed rule:** no V2 screen links to `/host/*`, `/fleet/command`, `/driver/*` or `/workspace`. Switching goes to `/v2/switch`, which lists only real memberships, revalidates access, clears cached private data and opens the last safe screen for the new context (spec §2.6).

### 2.3 Proposed route map (V2 namespace)

| Route | Screen | Replaces |
|---|---|---|
| `/v2/start` | Choose path (have trucks / need trucks) | legacy `/onboarding` |
| `/v2/start/hauler`, `/v2/start/landing` | Setup flows | — |
| `/v2/switch` | Business switcher | `/workspace` link |
| `/v2/work`, `/v2/work/[id]` | Find work, job detail | unchanged URLs |
| `/v2/hauler/inquiries` | Inquiries and invitations | `/v2/inquiries` (redirect) |
| `/v2/hauler/trucks` | Equipment, availability, fleet capacity | `/fleet/trucks` link |
| `/v2/hauler/profile` | Business profile (public + private) | — |
| `/v2/landing` | Overview | — |
| `/v2/landing/landings`, `/v2/landing/landings/[id]` | Landings, site detail | — |
| `/v2/landing/jobs`, `/new`, `/[id]` | Jobs list, job editor, manage view | the preview page becomes step 4 |
| `/v2/landing/inbox` | Inquiry inbox | `/v2/landing/inquiries` (redirect) |
| `/v2/b/[slug]` | Public business profile | — |

After sign-in with the V2 flag on, the session's home path resolves to `/v2/work` for a hauling context and `/v2/landing` for a landing context. A user with no organization goes to `/v2/start`.

---

## 3. Journey A — hauler (owner-operator or fleet)

Account creation → business type → company/profile → equipment → operating area and availability → discover jobs → express interest → receive response.

The default path takes about 3 minutes and 6 screens to reach a useful job list. Every step after A2 can be skipped and resumed from a checklist on Find work; job search is never blocked by an incomplete profile (spec §5.7, §10.20).

### A1 — Choose a path (shared with Journey B)

```text
┌──────────────────────────────┐
│ LogLoads                     │
│                              │
│ What brings you here?        │
│ ┌──────────────────────────┐ │
│ │ I have trucks            │ │
│ │ I'm looking for hauling  │ │
│ │ work. Free, always.      │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ I need log trucks        │ │
│ │ I post hauling jobs.     │ │
│ │ Plans from $149/month.   │ │
│ └──────────────────────────┘ │
│ Have an invitation code?     │
└──────────────────────────────┘
```

The card copy is the spec's §2.1 wording. "Free, always" is the LOCKED hauler promise.

### A2 — Business type

Three options, one data model (a hauling organization):

- **Just me.** I own and run my own truck(s).
- **A hauling company.** Several trucks, or office staff who help.
- **I work for a hauling company.** Join with an invitation. This creates no organization and asks no truck questions (Blueprint §93: "Individuals must not be required to represent that they own trucks when they do not").

Choosing "Just me" or "A hauling company" changes only the copy and whether the Team step is offered. It does not create a different account type.

### A3 — Your business (public and private)

```text
┌──────────────────────────────┐
│ ● ● ○ ○  Step 2 of 4         │
│ Your business                │
│ ┌ SEEN BY LANDING OPERATORS ┐│
│ │ Business name             ││
│ │ [Ridgeline Hauling      ] ││
│ │ Home base (town only)     ││
│ │ [Sweet Home, OR         ] ││
│ │ About (optional)          ││
│ │ [                       ] ││
│ └───────────────────────────┘│
│ ┌ PRIVATE · only your team ─┐│
│ │ Phone  [               ]  ││
│ │ Email  jamie@…  (account) ││
│ │ How landings reach you    ││
│ │ (•) LogLoads messages     ││
│ │ ( ) Phone, after I inquire││
│ └───────────────────────────┘│
│ [ Continue ]        Skip     │
└──────────────────────────────┘
```

The public panel has a paper background and an eye icon. The private panel has a tinted background and a lock icon, and its heading names who can see it. The home base is a town, never an address (spec §5.7).

### A4 — Your trucks (equipment presets)

```text
│ What do you run?             │
│ Log truck + pole trailer  [−] 2 [+] │
│ Self-loader               [−] 0 [+] │
│ Log truck + bunk/short-log[−] 0 [+] │
│ Chip truck + chip van     [−] 0 [+] │
│ Lowboy / heavy haul       [−] 0 [+] │
│ + Another configuration      │
│ Extras: [ ] On-board scales  │
│         [ ] Central tire inflation │
│ Photos can be added later.   │
```

Presets implement §10.9 from the `MARKETPLACE_EQUIPMENT_TYPES` categories: a truck, an optional trailer, then attachments. Steppers are 44 px. "Another configuration" opens a truck × trailer picker with "Other (describe)" text (§8.5, moderated). A company sees the same list; the counts are simply higher.

### A5 — Where and when (operating area and availability)

```text
│ Where do you take work?      │
│ From [Sweet Home, OR]        │
│ Up to (50) (100•) (150) (250+) miles │
│                              │
│ Are trucks available?        │
│ (•) Available now            │
│ ( ) Available from [date]    │
│ ( ) Not available right now  │
│ Trucks available [−] 2 [+] of 2 │
│ ┌──────────────────────────┐ │
│ │ Self-reported. Landings  │ │
│ │ see "Updated today by    │ │
│ │ you". We'll ask you to   │ │
│ │ reconfirm in 7 days.*    │ │
│ └──────────────────────────┘ │
│ Notify me                    │
│ [x] New jobs that fit my trucks │
│ [ ] Invitations from landings│
│ [ Finish ]                   │
```

\* The freshness period is an open founder decision (spec §14, "Availability freshness threshold"). Seven days is a placeholder.

- The available count cannot exceed the registered count. If a user tries, the stepper stops and explains why (§6.1).
- Both notification opt-ins are separate and explicit. Targeted invitations require consent (LOCKED, §1.4).
- No GPS is requested. The location is a typed town or ZIP.

### A6 — Find work (hauler home)

```text
┌──────────────────────────────┐
│ LogLoads  [Ridgeline ▾]  (◉) │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ Near Sweet Home · 100 mi  │ │  ← tap opens filter sheet
│ │    My trucks · Any pay    │ │
│ └──────────────────────────┘ │
│ 4 jobs · Newest ▾   [Map]    │
│ ┌──────────────────────────┐ │
│ │ $525 per load            │ │
│ │ Oak saw-log morning run  │ │
│ │ Cedar Fork Logging ✓ID   │ │
│ │ Near Oakridge → Springfield · 54 mi │
│ │ [Log truck + pole trailer ✓ fits] │
│ │ 3 trucks/day · Starts Nov 3 · 1 day │
│ │ Confirmed 2 days ago     │ │
│ └──────────────────────────┘ │
│ … more cards …               │
├──────────────────────────────┤
│ Find work│Inquiries│Trucks│Profile │
└──────────────────────────────┘
```

- The first card starts at about y = 200 on a 390 × 844 screen. Today it is about y = 680.
- The summary bar shows the active filters as text and opens a **bottom sheet** with Location, Radius, Equipment (grouped, with "My trucks" preselected), Product, Pay basis, Start window, and Include closed. The sheet has a sticky **Show 4 jobs** button and **Reset** (§3.5).
- Card hierarchy: pay and basis (Archivo 22/28, tabular figures); title; poster and verification scope; area → destination · miles; equipment chips, with a fit chip when the job matches the hauler's own equipment; demand · start · duration; freshness. A "Sponsored" label sits top-left when boosted, which is a later phase.
- **Fit** is advisory: "Fits your Log truck + pole trailer". It is never "Qualified" (§10.4).
- **Sort:** Newest confirmed, Nearest, Pay (within one basis only; across bases it shows "Rates use different bases" per §10.5).
- **Empty state:** "No jobs within 100 miles match your trucks. [Widen to 150 mi] [Any equipment]". It names the active constraints and offers one-tap changes (§3.4). It never invents results.
- **Map:** a full-screen toggle, not an inline block. Approximate pins are at least 32 px; tapping a pin opens the card as a bottom sheet. The list stays one tap away. The map loads only on toggle.

### A7 — Job detail (hauler view)

```text
│ ← Jobs                 Share │
│ Cedar Fork Logging · ID verified │
│ Oak saw-log morning run      │
│ $525 per load                │
│ Stated by the poster. Not a LogLoads guarantee. │
│ ┌──────────┬───────────────┐ │
│ │Equipment │Log truck + pole│ │
│ │          │trailer ✓ fits  │ │
│ │Area      │Near Oakridge, OR (approx.) │
│ │To        │Springfield · 54 mi one way │
│ │Starts    │Nov 3 · 1 day   │ │
│ │Trucks    │3 per day       │ │
│ │Fresh     │Confirmed 2 days ago │
│ └──────────┴───────────────┘ │
│ ▸ Haul details (product, tons/load…) │
│ ▸ Road & access (public notes)       │
│ ▸ Weather near the landing (on tap)  │
│ ▸ About Cedar Fork Logging           │
│ Report this listing          │
├──────────────────────────────┤
│ Free · nonbinding [I'm interested] │  ← sticky after the summary scrolls away
└──────────────────────────────┘
```

- The seven decision facts sit above the fold. Fields the poster did not provide are grouped as one line, "Not stated by the poster: loads per day, tons per load", instead of five rows.
- "Road & access" shows only the public summary, plus: "Exact access is shared by the landing if they choose, after you've been in touch." That reflects the REVIEW policy in `AGENTS.md` §7.4.
- **Report** (§8.18, §10.27) offers short reasons: no longer available, inaccurate pay, fake work, wrong equipment, privacy risk, other. The acknowledgement is factual: "Thanks. LogLoads staff review reports. The listing stays up until reviewed."
- **Share** (§10.6) copies a public-safe link and shows the URL as selectable text.
- A closed or paused job replaces the sticky bar with "Not accepting interest · Paused by the poster on Nov 4" and links to similar jobs (§5.3).

### A8 — I'm interested (bottom sheet)

```text
│ Interest in "Oak saw-log morning run" │
│ As Ridgeline Hauling ▾       │
│ Trucks you can offer         │
│ Log truck + pole trailer [−] 2 [+] of 2 available │
│ Available from  [Nov 3 ▾]  (from your availability) │
│ Reach me by     LogLoads messages ▾   │
│ Note (optional) [            ]        │
│ [ Send interest ]            │
│ Free and nonbinding. The landing reviews and replies. │
```

- Defaults come from the profile and the availability snapshot, so the default path is one tap (C7).
- Only equipment configurations the job asks for are listed. "Show my other trucks" reveals the rest.
- Offering more than the reported available count shows "You reported 2 available. Update availability?" (§6.4 contradiction rule).
- The submit button disables on tap and shows "Sending…". The interest ID makes a retry safe (§5.4).
- **Missing equipment:** "Add your trucks to offer them by type" links to A4 in V2. It never links to the legacy fleet page.
- **Confirmation state:** "Sent to Cedar Fork Logging, 2 trucks, from Nov 3" with links to Inquiries and Similar jobs. No "hired" or "booked" wording (§12.4).

### A9 — Inquiries and conversation

```text
│ Inquiries                    │
│ [Active 2] [Replied 1] [Closed] │   ← segmented tabs
│ ┌──────────────────────────┐ │
│ │ ● Your turn · Cedar Fork Logging │
│ │ Oak saw-log morning run  │ │
│ │ You offered 2 trucks · Nov 2 │
│ │ "Can you start Tuesday at 5?" │
│ └──────────────────────────┘ │
│ Thread view:                 │
│   [them] Can you start Tuesday at 5 a.m.?  Nov 2, 6:48 PM │
│                 [you] Yes, both trucks.  Nov 2, 7:02 PM │
│ [ Write a reply…            ] [Send] │
│ Withdraw interest            │
```

- Messages are aligned by side, with the sender named and a local time.
- Each row shows whose turn it is: "Your turn", "Waiting for the landing", or "Closed".
- Withdraw asks for confirmation in the page (no browser `confirm()`), states its effect, and offers an optional reason.

### A-fleet — Capacity board (a hauling company with 2+ trucks)

```text
│ Fleet · Ridgeline Hauling    │
│ Updated today by Jamie       │
│ Configuration      Have  Avail  From  │
│ Log truck + pole     6    [4]   now   │
│ Self-loader          2    [0]   Nov 12│
│ Chip truck + van     2     ?    not recently confirmed │
│ [ Confirm all as shown ]  [ Update ] │
```

- This is the same "My trucks" tab. It becomes a board when there are two or more trucks (§6.1, §6.3).
- An unknown or stale row says "not recently confirmed". It is never shown as zero (§6.3, §8.6).
- One tap reconfirms the whole snapshot (§10.10).
- There are no driver names, GPS, trips or schedules (§6.2, Blueprint §109).

### Journey A on desktop

- **Find work** at ≥ 1280 px is master–detail: the filter rail on the left (240 px), the list in the middle (420 px), and the selected job's detail on the right with the same interest sheet inline. At 960–1279 px the detail opens as its own page.
- **Setup** uses one centred 560 px column with the public/private panels side by side.
- **Inquiries** is two-pane: the list, and the thread.

---

## 4. Journey B — landing operator

Account creation → organization setup → create landing → create job → preview → explicitly attest availability → publish → review equipment-specific inquiries → respond.

### B1 — Organization

```text
│ ● ○ ○ ○  Your organization   │
│ ┌ SEEN BY HAULERS ──────────┐│
│ │ Business name [Cedar Fork Logging] ││
│ │ Type (•)Logging contractor ( )Landing operator ││
│ │      ( )Mill or yard ( )Other ││
│ │ Region [Lane County, OR]  ││
│ │ About (optional) [      ] ││
│ └───────────────────────────┘│
│ ┌ PRIVATE ──────────────────┐│
│ │ Legal name, billing contact││
│ │ How haulers reach you     ││
│ │ (•) LogLoads messages     ││
│ │ ( ) Phone shown to haulers who inquire ││
│ └───────────────────────────┘│
```

The contact route is set here and applies to every job by default (C10). The policy on contact visibility is an open decision (spec §14), so the phone option is labelled "policy pending" in the prototype.

### B2 — Plan

Three plan cards with the LOCKED values. No numbers are changed.

| | Basic | Pro | Regional |
|---|---|---|---|
| Positioning | Advertise | Recruit | Coordinate |
| Price | $149/month | $299/month | $499/month |
| Active landings | 1 | 3 | Unlimited |
| Team members (incl. you) | 2 | 5 | 10 |
| Targeted invitations / month | 3 | 10 | 30 |

Under every card: "Unlimited job posts, inquiries and replies." Below all three, one line: "Founding offer: the first 10 qualifying organizations in a launched state may get 50% off for six billing cycles. LogLoads confirms eligibility." In the preview build the payment step reads **"Billing isn't active yet. You can set up landings and draft jobs."** It never shows a fake checkout (§2.5, §4.12).

### B3 — First landing (site)

```text
│ Add your landing             │
│ ┌ SEEN BY HAULERS ──────────┐│
│ │ Name [Hills Creek Unit 4] ││
│ │ Area [Oakridge, OR]       ││
│ │ [map: shaded ~2 km circle]││
│ │ "Haulers see this circle, not your pin." ││
│ │ Typical hours [5 a.m.–3 p.m.] ││
│ │ Public road notes [Gravel last 6 mi] ││
│ └───────────────────────────┘│
│ ┌ PRIVATE · your team only ─┐│
│ │ Exact location [drop pin] ││
│ │ Gate / access instructions││
│ │ Site contact              ││
│ │ "Shared with a hauler only when you choose, per inquiry." ││
│ └───────────────────────────┘│
│ Recruiting now  [on]  1 of 1 active landings (Basic) │
│ [ Save landing ]             │
```

- A missing exact location does not block saving (§4.3).
- The active toggle shows the plan count. If the cap is reached, it offers "Pause another landing" or "See plans". It never consumes a slot silently (§2.5, §4.2).
- The form adapts the legacy `LandingDetailsForm` fields.

### B4–B6 — Create job (three input steps)

The four sections from spec §4.5 map to these screens: **1 Basics & location**, **2 Pay & scope**, **3 Equipment & volume**, **4 Review & publish**. A progress bar sits at the top. Each step saves a draft. Steps are a single column with units next to the numbers.

```text
Step 1  Basics & location
  Landing      [Hills Creek Unit 4 ▾]   (only active landings; "Add a landing" link)
  Title        [Oak saw logs to Springfield]
  Product      (Saw logs)(Pulpwood)(Poles)(Chips)(Other…)     ← required (C9)
  Destination  [Cascade Mill, Springfield] · about [54] mi one way (your estimate)

Step 2  Pay & scope
  Pay          ( $ [525] ) per (load ▾)    or   ( ) Negotiable → note required   ← required (C1)
  Pay note     [Fuel surcharge included above $5/gal] (optional)
  Starts       (•) On [Nov 3]  ( ) Between [ ] and [ ]  ( ) Ongoing            ← required (C8)
  Runs for     [1] days   or  [x] Until further notice
  Trucks       [3] needed for the job · [3] per working day (optional)

Step 3  Equipment & volume
  Truck        [x] Log truck  [ ] Self-loader  [ ] Chip truck  [ ] Lowboy
  Trailer      [x] Pole  [ ] Bunk/short-log  [ ] Mule train  [ ] Chip van  [ ] Lowboy trailer
  Extras       [ ] On-board scales  [ ] Central tire inflation
  ▸ Volume estimates (optional): loads/truck/day, loads/day, tons/load
  ▸ Public road notes (prefilled from the landing; never gate codes)
```

### B7 — Review, attest and publish

```text
│ ● ● ● ●  Review & publish    │
│ How haulers see it in search │
│ ┌ [JobCard, exact component] ┐│
│ How haulers see the job page │
│ ┌ [JobSummary, exact component] ┐│
│ Not shown to haulers: exact location, gate instructions, site contact. │
│                              │
│ Before you publish           │
│ [ ] This is a real job at Hills Creek Unit 4, │
│     which is recruiting now. │
│ [ ] Pay, equipment and dates are accurate today. │
│ [ ] We'll update or pause it when we no longer need trucks. │
│ [ Publish job ]  (enabled when all three are checked) │
│ Publishing records "Confirmed by Cedar Fork Logging, Nov 2". │
```

- The preview renders the **same** `JobCard` and `JobSummary` components that discovery uses (fixes P1-8).
- The three attestations are the explicit availability attestation in the brief. Checking them and publishing sets the first `lastConfirmedAt`. This needs the founder decision noted in [01 §1.3](./01_AUDIT_AND_GAP_MATRIX.md#13-conflicts-inside-the-specification-both-versions-founder-decision-needed).
- While publishing is not persisted (#105), the button is replaced by "Publishing isn't saved in this preview. Your draft is kept." The checkboxes still work.

### B8 — Overview (landing home)

```text
│ Cedar Fork Logging · Basic   │
│ [ Post a job ] [ Inbox 3 ] [ Find trucks ] │
│ Needs attention              │
│ • 3 new inquiries on Oak saw-log morning run │
│ • "Pulp to Eugene" not confirmed for 9 days → Confirm │
│ This month                   │
│ Landings 1 of 1 · Team 2 of 2 · Invitations 3 left (resets Dec 1) │
│ Landings                     │
│ Hills Creek Unit 4 · Recruiting · 2 jobs │
```

- The order follows spec §4.0: post or maintain work, review interest, find trucks.
- The allowance line is factual. There is no "trucks hired" metric (§4.1).
- A new subscriber sees a three-item checklist instead (§4.1 empty state).

### B9 — Inbox and equipment-specific inquiry

```text
│ Inbox  [New 3] [Replied 1] [Closed]  Job: [All ▾] │
│ ┌──────────────────────────┐ │
│ │ Ridgeline Hauling · ID verified │
│ │ Oak saw-log morning run  │ │
│ │ Offers 2 × Log truck + pole trailer ✓ matches │
│ │ Available from Nov 3 · Updated today (self-reported) │
│ │ Prefers LogLoads messages│ │
│ │ "Two trucks, can run Tuesdays."  │
│ │ [Reply] [Ask a question ▾] [Decline] │
│ └──────────────────────────┘ │
```

- **Equipment match:** each offered configuration is compared with the job's required equipment and labelled "✓ matches" or "not requested". This is advisory and comes from self-reported data (§4.7, §10.4).
- **Reply** opens the thread. **Ask a question** inserts editable templates: "Please confirm your trailer type", "Can you start on [date]?", "We'll be in touch". Templates are never sent automatically (§10.19, NEXT; shown as an extension point).
- **Decline** confirms in the page and offers an optional reason the hauler will see ("We've filled this job", "Equipment doesn't fit").
- **"Mark reviewed"** keeps the inquiry in New with a "Seen" dot. It moves to Replied only after a reply (fixes P1-6).
- **Share access details** (spec §9.10, `AGENTS.md` §7.4) appears as a disabled action labelled "Coming after policy review". It is not designed further until the REVIEW decision.

### Journey B on desktop

- **Inbox** is three-pane at ≥ 1280 px: the queue and job filter rail, the inquiry list, then the thread with hauler profile summary.
- **Job editor** uses a two-column layout: the steps on the left (640 px) and a live hauler preview on the right that updates as fields change.
- **Overview** shows the action row, then a two-column grid with attention items and the allowance and landings list.

---

## 5. Profiles

### 5.1 Hauler business profile (`/v2/hauler/profile`, public at `/v2/b/[slug]`)

| Field | Visibility | Notes |
|---|---|---|
| Business display name | Public | Required |
| Business type: Owner-operator, Hauling company | Public | Derived from A2 |
| Home base (town, state) | Public | Never a street address (§5.7) |
| Service area (radius or regions) | Public | |
| Equipment summary ("6 × Log truck + pole trailer") | Public | From My trucks |
| Availability stamp ("4 available · updated today by the hauler") | Public to landing members | Self-reported label is mandatory |
| About, equipment photos | Public | Photos are optional and compressed (§10.31) |
| Verification scope ("Business identity verified, Oct 2026") | Public | Only after a real admin review (§8.17). No badge otherwise. |
| Legal name, owner name | Private | Used for verification |
| Phone, email | Private | Shared per the contact preference |
| Verification documents | Restricted to reviewers | Never public (§5.7) |
| Team members (2+) | Private | Free; anti-abuse limits, no paid seats (§6.6) |

The profile page has an **"Edit / Preview as a landing sees it"** toggle. Every field shows its visibility icon. A completion checklist is shown, but it never blocks search (§10.20).

### 5.2 Landing operator profile (`/v2/landing/settings`, public at `/v2/b/[slug]`)

| Field | Visibility | Notes |
|---|---|---|
| Business name, type, region | Public | |
| About, logo, website (claimed) | Public | Website labelled "provided by the business" |
| Current open jobs | Public | Listed from real postings only (§10.26 is NEXT; the listing is enough for MVP) |
| Verification scope | Public | Same rule as for haulers |
| Member since | Public | Factual |
| Default contact route | Private setting | Governs inquiry contact |
| Legal entity, billing contact, plan | Private, owner only | Billing visible only to the owner (§2.4) |
| Landings' exact locations and access | Private, team only | Per-landing, never on the business profile |

The organization profile and the landing (site) records are separate objects. The profile describes the business; each landing describes a place.

---

## 6. Design system

### 6.1 Foundations (reuse `globals.css:1-35`)

| Token group | Use |
|---|---|
| `--pine`, `--pine-2` | Primary actions, active navigation, pay figure |
| `--paper` (cards), `--bone` (page), `--bone-2` (private panels, chips) | Surfaces. Private panels use `--bone-2` with a lock icon. |
| `--green` / `--green-bg` | Accepting, matches, fresh |
| `--amber` / `--amber-bg` | Stale, needs attention, preview notices |
| `--red` / `--red-bg` | Errors, closed, destructive |
| `--steel` / `--steel-bg` | Neutral statuses (paused, seen) |
| `--focus` / `--focus-outer` | Two-ring focus indicator |
| `--control-min 44px`, `--control-field 48px`, `--control-primary 52px` | Control heights |

No new colours are needed. Dark mode is not required by the spec and is not proposed for MVP.

### 6.2 Typography

| Role | Face | Size / line (mobile → desktop) | Use |
|---|---|---|---|
| Display | Archivo, 750, slight `wdth` condensing | 28/32 → 32/36 | Page titles only |
| Pay figure | Archivo 800, tabular numbers | 22/28 | Pay on cards and job headers |
| Heading | Inter 700 | 18/24 | Section titles |
| Body | Inter 400 | 16/24 | Running text. Inputs stay at 16 px to avoid iOS zoom. |
| Label | Inter 600 | 14/20 | Field labels, card facts |
| Meta | Inter 500 | 13/18 | Freshness, sources, hints |

Use `font-variant-numeric: tabular-nums` on pay, counts and dates. Pay drops cents unless they are present ($525 per load; $4.25 per ton).

### 6.3 Spacing, layout and breakpoints

- Spacing scale (4 px base): 4, 8, 12, 16, 24, 32, 48. Gutter: 16 px on mobile, 24 px on desktop.
- Radii: 8 px for controls, 14 px for cards and sheets, full for chips. No shadow on list cards; shadows only on sheets and menus.
- Breakpoints: 600 px (two-column form pairs), 960 px (sidebar replaces bottom tabs), 1280 px (master–detail).
- Respect safe-area insets on the bottom tabs and sticky bars.

### 6.4 Components and rules

| Element | Rules |
|---|---|
| **Buttons** | Primary (pine fill), Secondary (pine outline), Quiet (text), Destructive (red outline, always confirmed in the page). One primary per screen. 48 px on mobile. Labels say exactly what happens: "Send interest", "Publish job". |
| **Forms** | Label above; hint between label and input; error below, with an icon, in text. Only optional fields are marked "(optional)", which keeps the current convention. Units are input suffixes ("mi", "per load"). Counts use steppers. Pay basis uses a select; dates have an "Ongoing" alternative. Inline validation on blur, plus a summary at the top on submit. |
| **Cards** | JobCard anatomy as in A6. No label/value grid inside cards; facts are short lines. One border, no shadow. |
| **Facts** (detail pages) | A two-column `<dl>` with the label in `--muted` 14 px and the value in 16 px. "Not stated" values are grouped into one line. |
| **Tables** | Desktop only: landing jobs list, fleet capacity board. Below 960 px they become stacked rows with the key value first. |
| **Status chips** | Text plus colour, from the single mapping in §6.6. |
| **Sheets and dialogs** | A native `<dialog>` with focus trapped and restored, Escape to close, a sticky footer action. No stacked modals (§3.5). |
| **Maps** | On demand, full-screen on mobile, pins at least 32 px with a visible "Approximate area" label, clustering above 20 points, a pin opens the card sheet, attribution always shown, and failure falls back to the list with a message. |
| **Freshness and source** | `AvailabilityStamp`: "Confirmed by the poster 2 days ago", "Updated today by the hauler", "Not recently confirmed". Never "Live" or "Online" (§12.4). |
| **Public / private panels** | A paper panel with an eye icon ("Seen by …"), or a bone-2 panel with a lock icon ("Private · …"). Always titled with the audience. |
| **Empty states** | Say what is empty, why, and offer one or two concrete next actions. Never sample data presented as real. |

### 6.5 Accessibility and low connectivity

- Target WCAG 2.2 AA. Targets are at least 24 px and 44 px for primary controls (2.5.8). Sticky bars must not cover the focused element (2.4.11). Nav uses `aria-current`. Status is never colour-only.
- Every core task works with JavaScript off: GET filter forms, server-action submissions, `<details>` for collapsible sections.
- Drafts are kept in `sessionStorage` (non-sensitive fields only; the schema already rejects access text) and on the server once persistence exists.
- Images are not loaded in lists. The map, weather and photos load on request. A low-data toggle (§10.21) is NEXT and needs no new design beyond these defaults.

### 6.6 Status vocabulary (one mapping)

Proposed for founder confirmation (resolves C5 and C6).

| Stored status | Hauler sees | Landing queue | Landing sees |
|---|---|---|---|
| `submitted` | Sent · waiting for the landing | **New** | New |
| `viewed` | Seen by the landing | **New** (with a "Seen" dot) | Seen, not answered |
| `replied`, landing spoke last | Your turn | **Replied** | Waiting for the hauler |
| `replied`, hauler spoke last | Waiting for the landing | **New** (back to the top) | Hauler replied |
| `declined` | Declined by the landing | **Closed** | Declined |
| `withdrawn` | Withdrawn by you | **Closed** | Withdrawn by the hauler |

| Job status | Public label |
|---|---|
| draft | (not public) Draft |
| active | Accepting interest |
| paused | Paused by the poster |
| filled | Poster marked as filled (a claim, not a verified fact) |
| closed | Closed |
| expired | Listing expired |

---

## 7. Reusable component plan

New shared primitives go in `packages/ui`. Marketplace composites go in `apps/web/components/v2`. Spec §12.3 names are used.

| Component | Source | Action | Used by |
|---|---|---|---|
| `AppShellV2` (top bar, bottom tabs, sidebar) | v3 `AppShell` structure and mobile tab CSS | Adapt; new nav data per context | All signed-in V2 pages |
| `WorkspaceSwitcher` | v3 `AccountMenu`, `switchOrganizationAction` | Adapt; V2 destinations only | Top bar, `/v2/switch` |
| `Field`, `NumberStepper`, `Segmented`, `DateOrOngoing`, `ChoiceCard` | v3 `.radio-card`, `.choice-grid`, `.auth-form` styles | New in `packages/ui` | All forms |
| `ConfirmDialog`, `Sheet` | — | New (native `<dialog>`) | Withdraw, decline, filters, interest |
| `EmptyState` | v3 `Shells.tsx:231` | Reuse | Lists |
| `StatusChip` | v2 `.v2-status` classes and §6.6 mapping | New | Cards, inbox |
| `PayRate` | `format.ts` `payLabel` | Extract | Cards, detail, preview |
| `EquipmentTags` (with fit state) | `marketplaceEquipmentLabel` | New | Cards, detail, inquiries |
| `AvailabilityStamp` | `postingFreshness` | Extract and generalise to hauler availability | Cards, profiles, capacity |
| `JobCard` | `components/v2/JobCard.tsx` | Adapt (A6 anatomy) | Discovery, preview |
| `JobSummary` | `work/[jobId]/page.tsx` sections | Extract; also used by the preview | Detail, preview |
| `InterestSheet` | `EquipmentFields` in `work/[jobId]/page.tsx:27-67` | Extract and prefill | Job detail |
| `InquiryThread` | `.v2-thread` markup | New (aligned bubbles, local times) | Both inboxes |
| `VisibilityPanel` (public/private) | — | New | Profiles, landing form, org setup |
| `EquipmentPresetList` | v3 `AddEquipmentForm`, contracts taxonomy | Adapt | Onboarding, My trucks |
| `AvailabilityQuickSet` | v3 `DriverActions.tsx:553` | Adapt | Onboarding, My trucks, capacity |
| `LandingForm` | v3 `LandingDetailsForm` | Adapt | Landings |
| `OnboardingSteps` | v3 `OnboardingFlow` | Adapt | `/v2/start/*` |
| `MapView` / `MapFallback` | `components/v2/JobMap.tsx`, v3 `RealMap` | Adapt | Discovery |
| `InvitationQuota`, `SponsorLabel`, `WeatherPanel`, `TeamRoleBadge`, `VerificationScope` | — | Later phases | Overview, cards, detail |

**Things that would add complexity without serving the core load board** (keep out of MVP): generic analytics dashboards or charts on the landing overview, a CRM-style inquiry pipeline with stages beyond §6.6, dispatch-style calendars or schedules, truck-level tracking, star ratings, automated "AI match scores", and separate fleet or Pro applications. Each one is either excluded by spec §10.35 or duplicates a simpler MVP surface.
