# FG07 Flows: flows A to E as 390 px prototypes

**Status:** TARGET. Drawn for the lead's audit and then founder review on 2026-11-10 (#300, strategy item P0-9). These screens are not approved. Approval is a founder comment on the design issue that begins with `approved` (AE-Control `policy/designops.md`).
**Figma page:** [07 Flows](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=106-2) in the LogLoads file.
**Sources:** the strategy and field design bar ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784066522)), the founder decisions of 2026-11-10 ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784468462)), quality bar v1 ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6783016152)), design audit 2 (#285), `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, and the draft copy deck from #274. No UI code changed.

Link base: `https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=` plus the node id with `-` in place of `:`.

## What is on the page

- 58 frames: 51 screens at 390 px, 6 key screens at 768 px, and the share card at 1200 × 630.
- 115 prototype links and 8 flow starting points. Press Present on the page and pick a flow.
- One notes panel per flow with the tap count and the target.
- One panel of field parts composed on this page (see "Composed locally").

The example is one story. Oak Landing in Sweet Home, OR posts "Oak saw logs to Cascade Mill" at $475 per load. Granite Creek Hauling of Lebanon, OR answers with 1 log truck. Names, places, pay, phone numbers and counts are examples.

## Tap counts against the targets

| Flow | Target | Drawn | Meets it |
|---|---|---|---|
| A. Hauler from a shared link, first time | 8 taps, under 90 s | 7 taps and 2 typed fields (mobile number, business name) | Yes for taps. The time is not measured. |
| A. Returning hauler | 2 taps | 2 taps: open the link, Send interest | Yes |
| B. Landing posts its first job | Under 5 minutes | About 20 taps and 3 typed fields over 3 steps, then Publish. About 2 minutes at 4 s a tap and 15 s a typed field. | Yes on paper. Not timed with a real landing. |
| C. Landing answers an inquiry | 2 taps from the text | 2 taps to reply with a ready reply, 2 taps to decline. A typed reply is 3 taps and 1 typed field. | Yes |
| D. Hauler confirms availability | 1 tap, no login | 1 tap on the page, no login. Change is 3 taps. | Yes |
| E. Landing reconfirms | 1 tap | 1 tap on the page, no login: Still need trucks, Filled or Pause | Yes |

Counting rules: opening the link counts as a tap in flows A and C, where the target is counted from the text. In flows D and E the link opens the page and the one tap is the answer. The link alone changes nothing, so a link scanner or a message preview cannot answer for the person.

## Frames

### Flow A: hauler from a shared link ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=111-37))

| Frame | Node | What it is for |
|---|---|---|
| A0 Share card | `111:38` | Open Graph image, 1200 × 630: pay, basis, trailer, distance and a dated freshness line |
| A1 Text with the shared link | `111:94` | The link preview as it shows in a text. Tap 1. |
| A2 Job page, signed out | `111:153` | Freshness, pay, basis, trailer, distance, length and trucks in the first 560 px. Tap 2: Send interest. |
| A3 Sign up with a phone | `111:179` | Taps 3 and 4: the number, then "Text me a code" |
| A3b Sign up with an email | `111:205` | The email path, same count |
| A4 Enter the code | `111:232` | Tap 5: the code the phone offers. It checks itself. |
| A4b Check your email | `111:255` | The email path's wait screen |
| A5 Confirm your trucks | `111:313` | Taps 6 and 7: business name, then Send interest. Truck, count and start day are filled in from the job. |
| A6 Interest sent | `111:356` | The ending: what was sent, what happens next, and "Take back my interest" |
| A7 Job page, returning hauler | `111:423` | Signed in. The bottom bar says what will be sent. 2 taps in all. |
| A-offline | `111:488` | The saved job still shows, and the send waits for signal |
| A-error | `111:511` | The job did not load: Try again, or See other jobs |
| A-expired | `111:553` | The job is filled, so the page offers open jobs nearby |
| A2 at 768 px | `131:922` | The facts sit in two columns |

### Flow B: a landing posts its first job ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=118-156))

| Frame | Node | What it is for |
|---|---|---|
| B1 Jobs, with the saved draft | `118:185` | The draft after the landing left the app and came back |
| B2 Step 1, the haul | `118:237` | Landing, product, species, mill. The miles are filled in. |
| B3 Step 2, pay and trucks | `118:305` | Pay, pay basis, truck and trailer, two truck counters |
| B4 Step 3, dates and review | `118:367` | First day, length, note, and the row haulers will see |
| B5 Who will get it | `118:414` | "14 trucks available within 50 miles", then one statement and Publish job |
| B6 Job published | `118:462` | The ending: the audience, the share card, the link, Share and Copy |
| B-offline | `118:536` | Step 2 offline. The draft is on the phone and the steps still work. |
| B-error | `118:589` | Publish failed. The draft stays. |
| B-expired | `118:612` | An old "finish your job" link |
| B5 at 768 px | `131:969` | |

### Flow C: a landing answers an inquiry ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=124-248))

| Frame | Node | What it is for |
|---|---|---|
| C1 Text about a new inquiry | `124:261` | The notification as a text. Tap 1. |
| C2 Email about a new inquiry | `124:300` | The notification as an email, with Reply and Decline |
| C-inbox Inquiries | `124:341` | The signed-in way to the same thread |
| C3 Inquiry thread with the reply bar | `124:390` | What they can bring, their note, two ready replies, Decline and "Write a reply". Tap 2. |
| C3b Write a reply | `124:463` | The typed reply |
| C4 Reply sent, phone number offer | `124:509` | Undo, and the opt-in to show the landing's number to this one hauler |
| C5 Phone number showing | `124:541` | The number is showing, with "Hide my number" |
| C7 Declined | `124:577` | Declined with Undo and an optional reason |
| C-offline | `124:609` | The reply waits and sends once |
| C-error | `124:641` | The reply did not send and is still there |
| C-expired | `124:664` | An old inquiry link |
| C3 at 768 px | `124:439` | |

### Flow D: a hauler confirms availability ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=124-674))

| Frame | Node | What it is for |
|---|---|---|
| D1 Text asking about availability | `124:687` | The text with the link |
| D2 Still available or Change | `124:721` | The one tap, no login |
| D3 Confirmed | `124:792` | "Confirmed today", with Undo |
| D4 Change availability | `124:832` | Truck count, when, or "not taking work for now" |
| D5 Change saved | `124:869` | What landings see now, with Undo |
| D-offline | `124:909` | The answer waits on the phone |
| D-error | `124:949` | It did not save. The same two answers stay. |
| D-expired | `124:972` | An old link: "Send me a new link" |
| D2 at 768 px | `124:755` | |

### Flow E: a landing reconfirms a job ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=131-443))

| Frame | Node | What it is for |
|---|---|---|
| E1 Text asking to reconfirm | `131:456` | The text with the link |
| E2 Still need trucks, Filled or Pause | `131:488` | The one tap, no login |
| E3 Reconfirmed | `131:552` | "Confirmed today", with Undo |
| E4 Marked as filled | `131:584` | Off the board, with Undo |
| E5 Paused | `131:616` | Paused, with Undo and "Turn job back on" |
| E-offline | `131:654` | The answer waits on the phone |
| E-error | `131:692` | It did not save. The same three answers stay. |
| E-expired | `131:715` | An old link |
| E2 at 768 px | `131:520` | |

### Text message settings ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=131-725))

| Frame | Node | What it is for |
|---|---|---|
| S1 Text settings, off | `131:753` | Off by default. The consent words come before the switch. |
| S2 Text settings, on, with quiet hours | `131:837` | Which texts, and quiet hours from 8:00 pm to 5:00 am |
| S3 First text, HELP and STOP | `131:860` | The first text and the HELP and STOP answers |
| S1 at 768 px | `131:782` | |

The notes for the 768 px row are at `131:976`.

## Design decisions made here

These are proposals for the lead and the founder. None of them is approved.

- **The share card states a date** ("Confirmed Nov 10 by Oak Landing"), not "today", because phones and feeds keep the picture after the job changes.
- **Sign-up offers phone or email.** While the text budget is 0 (founder decision 3), "Email me" should be the default tab, and the emailed link takes the place of the code (A3b, A4b).
- **Flow A fills in the truck, count and start day from the job**, so a new hauler types only a phone number and a business name.
- **Flow B is three steps, not four**, with one publish statement in place of three checkboxes (audit 2: E2, E3). The draft saves after every change, on the phone and to the account (E1).
- **Ready replies in flow C send in one tap.** A reply or a decline is held for 1 minute so Undo works, then it goes.
- **Phone reveal is offered only after the landing replies**, to that one hauler, and it is off until the landing says yes (founder decision 4). It can be hidden again.
- **Signed links work for 7 days** and never need a login. An old link offers a new one and never a dead end.
- **Undo is on every one-tap answer** in flows C, D and E.
- **Key facts use `color/text` and `color/text-secondary` only** (17:1 and 10.7:1 on white). `color/text-muted` is not used anywhere.

## Composed locally

00 System has no field layer yet (#281). These parts were composed on this page, as components named `Field / …` in the frame [Field parts](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=106-3). Every fill, stroke, spacing value and radius is bound to a 00 System variable. Swap them for the system parts when #281 lands.

| Part | Why it was composed |
|---|---|
| `Field / Button`: primary (56 px), secondary56, primary48, secondary, quiet, danger (48 px) | The system Button stops at 48 px and has a 15 px label |
| `Field / FreshnessChip`: fresh, aging, stale, closed | The system AvailabilityStatus is a 6 px dot with 13 px muted text |
| `Field / Notice`: info, success, warning, critical, offline | Notice and Offline are not in the system (audit 1 F5) |
| `Field / Input`: default, focus, error | The system FormField is 44 px tall with 14 px labels |
| `Field / Switch` and `Field / Checkbox` | Sized for a 48 px row |
| Bottom action bar, top bar, segmented control, choice chips, number stepper, fact row, message bubble | Built as frames from variables. The system versions are 36 to 44 px tall or use 13 to 15 px text. |
| 10 icons: back, check, plus, minus, caret right, phone, mail, clock, offline, link | Not in the 41-icon registry. Drawn as 2 px strokes bound to colour variables. |

Used from 00 System as they are: the `Brand` mark, the `Icon/*` components, all colour, spacing and radius variables, and the text styles `type/pay-lg`, `type/pay`, `type/page-title`, `type/panel-title` and `type/row-title`.

**Type.** Body and label text is IBM Plex Sans at 16 px (regular and semibold). The Type collection has no 16 px value (`text/base` is 15), so these are raw sizes until #281 sets `type/body` to 16. The screens use five sizes in all: 36, 28, 21, 17 and 16 px, and no more than three in a row. The share card uses its own large sizes because it is a picture.

## Checks

- Every frame was screenshotted from Figma and read. Fixes made after the first pass: one clipped chip, one-word last lines, the 768 px column and bar widths, the chip icon on filled and paused jobs, and stray fills on imported icons.
- A script over all 58 frames found: no text under 16 px outside the share-card picture, no text or button outside its frame, no button under 48 px, no label wider than its button, only IBM Plex fonts, and no fill or stroke without a variable.
- Not checked: the prototype in Present mode on a phone, real timing of flows A and B, and anything in a browser. Nothing here is built.

## Gaps

- **Dark theme.** No dark frames. The Color collection has one mode, and the decision sits in #281. Every colour here is a variable, so a Dark mode will apply without redrawing.
- **1440 px.** Not part of this task. The 768 px frames cover the key screen of each flow only.
- **Bottom tab bar.** Not drawn on B1 and C-inbox. It waits for the navigation fix in #281 (audit 2, G9).
- **States.** Offline, error and old-link are drawn for each flow. Loading skeletons, permission-denied and field validation errors are not.
- **Fixed bottom bar in the prototype.** The bar is pinned to the frame bottom. On the six frames taller than 844 px it should be checked in Present mode.
- **Open decisions the copy leans on:** the reconfirm gap ("in a few days", #114), the 7-day link life, the 1-minute Undo hold, and "We will ask again next week" for haulers.
- **Text consent words** (S1 to S3 and the first-text copy) need the legal review in founder decision 6 before any text goes out.
- **Short links** such as `logloads.com/j/oak-cascade` are examples. The link shape belongs to P0-4 and P0-6.
- **The audience count** in B5 assumes the Find Trucks query (P1) can count by radius and truck type.
- **The copy deck** from #274 had not landed when this was drawn. Terms follow its draft ("Send interest", "Inquiries") but the strings here are new and need a pass against the final deck.
