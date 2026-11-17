# FG07 Flows: flows A to E as prototypes

**Status:** TARGET. Drawn for the lead's audit and then founder review on 2026-11-10 (#300, strategy item P0-9), then revised on 2026-11-12 for design audit 3 and the lead's page 07 decisions (#334), and again on 2026-11-12 for LL-D12 (#352). These screens are not approved. Approval is a founder comment on the design issue that begins with `approved` (AE-Control `policy/designops.md`).
**Figma page:** [07 Flows](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=106-2) in the LogLoads file.
**Sources:** the strategy and field design bar ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784066522)), the founder decisions of 2026-11-10 ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6784468462)), quality bar v1 ([#235 comment](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6783016152)), design audit 2 (#285), the lead's page 07 decisions on #334, the reconfirm interval on #114, the signed-link rules on #292, the SMS rules on #291 and #293, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, and the draft copy deck from #274. No UI code changed.

Link base: `https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=` plus the node id with `-` in place of `:`.

## LL-D12 (#352)

#352 replaced the last hand-built parts that 00 System now covers and drew the 1440 frames in columns. Frame ids did not change, and every prototype link was carried over to the new buttons.

| Part | Before | After |
|---|---|---|
| Bottom bars on the 390 and 768 screens | 58 local frames ("bottom action bar") | 58 BottomActionBar instances, pinned to the bottom of the frame. Single for one primary, with the summary line where the screen had one (A2, A3, A5, B2, D4, S2 and others). Stacked for a primary over one or two secondary or ghost actions (D2 "Still available" over "Change"; E2 "Still need trucks" over "Filled" and "Pause"; Undo, Back to edit and the like). Split with Show choices for C3: "Reply in one tap", the two ready replies, then Decline beside Write a reply. At 768 the bar spans the screen and its side padding keeps the buttons to the 600 px column. A4b keeps its "Use code 482 913" row: it stands in for the phone's notification in the prototype and is not an action bar. |
| Flow B step indicator (B2, B3, B4, B-offline, B2-error) | A "Step N of 3" line and a progress bar | StepIndicator / Narrow (Current 1 to 3; The haul, Pay and trucks, Dates and review; step 4 hidden), above the "Draft saved" line |
| Closed chips (E4, E5, A-expired) | The local `Field / FreshnessChip / closed` | FreshnessChip State=filled ("Filled today", "Filled Mon, Nov 9") and State=paused ("Paused today"). The local component is deleted, and the "Field parts" panel (`106:3`) now only says what is still built from variables. |
| 1440 frames (y = 9800) | One centred 632 px column with the actions under it | Two columns, 1200 px wide: the content on the left and a 384 px aside on the right with the actions in a card. A2: the job, then the Send interest card and the poster. B5: the audience and facts, then the publish statement with Publish job and Back to edit. C3: the inquiries list (this inquiry open) beside the thread, with the reply card under the thread. D2 and E2: the facts, then the one-tap answers. S1: the switch and number, then the consent words, the links and Turn on texts. There is no bottom bar on desktop. |

The 1440 labels on the canvas and the 768 notes (`131:976`) describe the new layouts.

**Check after #352** (read-only script over the 76 frames on the page, 2026-11-12): no button or link under 48 px, no "Preview" text, no disabled control and no text running past its container. Six texts are under 14 px, all in the share-card picture (A1 and B6), the recorded exception. Eight decorative end-grain rings in the share card (A0, A1 and B6) extend past their frame and are clipped by it. These frames were checked by screenshot after the changes: B2, C3, E2, E4, and A2, C3, E2 and S1 at 1440.

## Design audit 3 (#334)

The full audit 3 report is not on the issue. The #334 body names four majors on this page, including the missing 1440 frames, and some minors. The lead's comment on #334 adds the decisions and the #300 gaps. Every item below is closed on the page.

**Majors**

| Finding | Fix |
|---|---|
| No 1440 px frames for the key screens | Six 1440 frames at y = 9800: A2 job page `313:1154`, B5 audience count `313:1204`, C3 inquiry thread `313:1254`, D2 confirm availability `313:1301`, E2 reconfirm a job `313:1330`, S1 text settings `313:1354`. The column stays 632 px and centred, and the actions sit under it in the page flow; desktop has no bottom bar. |
| Field parts composed on the page instead of 00 System (#281 follow-up) | 156 instances swapped in place, so their prototype links stay: 98 Button (primary and secondary lg at 56 px, md, ghost, danger), 20 FreshnessChip, 14 Notice, 5 Offline (banner), 11 Input, 5 Checkbox and 3 Switch (each with its label and hint). The 21 local `Field / …` components that no longer had instances were deleted. `Field / FreshnessChip / closed` stays (3 uses), because 00 System FreshnessChip has no Filled or Paused state. |
| States missing: loading, permission denied, field validation (#300 gap) | A-loading `315:1233` (00 System LoadingState, detail), C-denied `315:1506` (00 System PermissionDenied: a person signed in to another business opens a landing's inquiry link), A3-error `315:1388` (an incomplete email) and B2-error `315:1427` (two missing fields on step 1). The errors are checked on the button press and keep what the person typed. |
| No bottom tab bar on B1 and C-inbox (#300 gap) | 00 System ResponsiveNavigation (landing) is pinned to the bottom of B1 (Post jobs current; the draft bar moved up above it) and C-inbox (Landing inbox current). |

**The lead's decisions, applied**

| Decision | Where |
|---|---|
| Signed one-tap links: single use, 72-hour expiry, the action runs on the button press, never on page load | "Each link works once, for 72 hours." on B-expired, C-expired, D-expired and E-expired, and in the flow C and D notes. The notes say opening a link changes nothing; pressing the button does. The "7 days" copy is gone. |
| Undo hold: 1 minute for reply, decline and Filled | Already drawn and kept: C4 "You can undo it for the next minute.", C7 "Granite Creek Hauling is told in 1 minute. Undo before then.", E4 "In 1 minute we tell the haulers who sent interest." |
| Reconfirm gap (#114, #308): reminder on day 5, due on day 7, leaves Find Work at day 14 with "Waiting for the poster to confirm" | E3: "We will ask again in 5 days. A job no one confirms for 14 days leaves Find Work." D3: "We will ask again in 5 days." The reminder screens say "5 days ago" (D2, D-offline, D-error, E1, E2, E-offline, E-error). New frame A-waiting `315:1308`: the job page at day 14, with the FreshnessChip "Waiting for the poster to confirm", a notice that it takes no new interest, and "See open jobs nearby". The flow E notes replace "in a few days". |
| Share card shows a date, not "today" | A0, A1 and B6: "Confirmed Nov 9 by Oak Landing". The live job page still says "Confirmed today". |
| SMS consent: off by default, marked pending legal review; phone sign-up secondary while SMS costs $0; email is the working path | The consent frames are off by default, and their canvas labels say "Consent words pending legal review (#291, #293)": S1, S2, S3, S1 at 768, the phone sign-up and the phone code. Email is now the main path in flow A: A3 is the email sign-up (`111:205`) and A4 is "Check your email" (`111:255`); the phone path is A3b (`111:179`) and A4b (`111:232`). "Email me" comes first in the switcher, A2's Send interest goes to the email sign-up, and A6 promises an email, not a text. D1b `315:1553` and E1b `315:1599` are the email versions of the availability and reconfirm messages; the text versions stay for when the budget opens. |

**Minors**

| Finding | Fix |
|---|---|
| 390 frames did not use the Touch mode | All 58 frames at 390 set the Component collection to Touch. |
| No Dark frames | The five key 390 screens repeat in the Dark theme at y = 11000: A2 `315:1668`, B5 `315:1710`, C3 `315:1751`, D2 `315:1789`, E2 `315:1809`. |
| Raw 16 px text with no style (the Type collection had no 16 px value when this page was drawn) | 529 texts now use the `type/*` styles. `type/body` is 16 px since #281. |

**Check after the fixes** (read-only script over the 75 screen frames, 2026-11-12): no long body text under 16 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control. Six texts are under 14 px, all inside the share-card picture as a phone's message app shows it (A1 and B6); that picture is the recorded exception. These were checked by screenshot after the changes: A2, S1, B1, C3 at 1440, A-waiting, B2-error, A1, and the C3 and D2 Dark copies. The other frames were checked by the script only. Nothing was checked in a browser or in Present mode on a phone.

## What is on the page

- 76 frames: 58 screens at 390 px (51 from #300 and 7 new states), 6 key screens at 768 px, 6 at 1440 px, 5 Dark copies at 390 px, and the share card at 1200 × 630.
- The #300 prototype links and 8 flow starting points, plus links on the new frames: A2 → A3 (email), A-waiting → A-expired, D1b → D2, E1b → E2. The 1440 and Dark frames keep the links of the frames they copy. Press Present on the page and pick a flow.
- One notes panel per flow with the tap count and the target.
- The panel "Field parts: replaced by 00 System (#334, #352)" (`106:3`). No local Field part is left; the panel says what is still built from variables.

The example is one story. Oak Landing in Sweet Home, OR posts "Oak saw logs to Cascade Mill" at $475 per load. Granite Creek Hauling of Lebanon, OR answers with 1 log truck. Names, places, pay, phone numbers and counts are examples.

## Tap counts against the targets

| Flow | Target | Drawn | Meets it |
|---|---|---|---|
| A. Hauler from a shared link, first time | 8 taps, under 90 s | 7 taps and 2 typed fields (email, business name) on the email path; the phone path is the same count | Yes for taps. The time is not measured. |
| A. Returning hauler | 2 taps | 2 taps: open the link, Send interest | Yes |
| B. Landing posts its first job | Under 5 minutes | About 20 taps and 3 typed fields over 3 steps, then Publish. About 2 minutes at 4 s a tap and 15 s a typed field. | Yes on paper. Not timed with a real landing. |
| C. Landing answers an inquiry | 2 taps from the message | 2 taps to reply with a ready reply, 2 taps to decline. A typed reply is 3 taps and 1 typed field. | Yes |
| D. Hauler confirms availability | 1 tap, no login | 1 tap on the page, no login. Change is 3 taps. | Yes |
| E. Landing reconfirms | 1 tap | 1 tap on the page, no login: Still need trucks, Filled or Pause | Yes |

Counting rules: opening the link counts as a tap in flows A and C, where the target is counted from the message. In flows D and E the link opens the page and the one tap is the answer. The link alone changes nothing, so a link scanner or a message preview cannot answer for the person.

## Frames

### Flow A: hauler from a shared link ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=111-37))

| Frame | Node | What it is for |
|---|---|---|
| A0 Share card | `111:38` | Open Graph image, 1200 × 630: pay, basis, trailer, distance and "Confirmed Nov 9 by Oak Landing" |
| A1 Text with the shared link | `111:94` | The link preview as it shows in a text. Tap 1. |
| A2 Job page, signed out | `111:153` | Freshness, pay, basis, trailer, distance, length and trucks in the first 560 px. Tap 2: Send interest. |
| A3 Sign up with an email | `111:205` | Taps 3 and 4: the email, then "Email me a link". The main path. |
| A3b Sign up with a phone (secondary) | `111:179` | The phone path, same count. Consent words pending legal review. |
| A4 Check your email | `111:255` | Tap 5: open the emailed link |
| A4b Enter the code (phone path) | `111:232` | The phone path's code step |
| A5 Confirm your trucks | `111:313` | Taps 6 and 7: business name, then Send interest. Truck, count and start day are filled in from the job. |
| A6 Interest sent | `111:356` | The ending: what was sent, what happens next (an email when they reply), and "Take back my interest" |
| A7 Job page, returning hauler | `111:423` | Signed in. The bottom bar says what will be sent. 2 taps in all. |
| A-offline | `111:488` | The saved job still shows, and the send waits for signal |
| A-error | `111:511` | The job did not load: Try again, or See other jobs |
| A-expired | `111:553` | The job is filled, so the page offers open jobs nearby |
| A-loading | `315:1233` | Skeleton in the job page layout |
| A-waiting | `315:1308` | Day 14: "Waiting for the poster to confirm", no new interest |
| A3-error | `315:1388` | The email is incomplete; what was typed stays |
| A2 at 768 px | `131:922` | The facts sit in two columns |
| A2 at 1440 px | `313:1154` | Two columns: the job, then the Send interest card and the poster |

### Flow B: a landing posts its first job ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=118-156))

| Frame | Node | What it is for |
|---|---|---|
| B1 Jobs, with the saved draft | `118:185` | The draft after the landing left the app and came back. Tab bar: Post jobs. |
| B2 Step 1, the haul | `118:237` | Landing, product, species, mill. The miles are filled in. |
| B3 Step 2, pay and trucks | `118:305` | Pay, pay basis, truck and trailer, two truck counters |
| B4 Step 3, dates and review | `118:367` | First day, length, note, and the row haulers will see |
| B5 Who will get it | `118:414` | "14 trucks available within 50 miles", then one statement and Publish job |
| B6 Job published | `118:462` | The ending: the audience, the share card, the link, Share and Copy |
| B-offline | `118:536` | Step 2 offline. The draft is on the phone and the steps still work. |
| B-error | `118:589` | Publish failed. The draft stays. |
| B-expired | `118:612` | An old "finish your job" link. Each link works once, for 72 hours. |
| B2-error | `315:1427` | Step 1 with two missing fields |
| B5 at 768 px | `131:969` | |
| B5 at 1440 px | `313:1204` | Two columns: the audience, then the publish card |

### Flow C: a landing answers an inquiry ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=124-248))

| Frame | Node | What it is for |
|---|---|---|
| C1 Text about a new inquiry | `124:261` | The notification as a text, for when texts are on. Tap 1. |
| C2 Email about a new inquiry | `124:300` | The notification as an email, with Reply and Decline. The working channel now. |
| C-inbox Inquiries | `124:341` | The signed-in way to the same thread. Tab bar: Landing inbox. |
| C3 Inquiry thread with the reply bar | `124:390` | What they can bring, their note, two ready replies, Decline and "Write a reply". Tap 2. |
| C3b Write a reply | `124:463` | The typed reply |
| C4 Reply sent, phone number offer | `124:509` | Undo for 1 minute, and the opt-in to show the landing's number to this one hauler |
| C5 Phone number showing | `124:541` | The number is showing, with "Hide my number" |
| C7 Declined | `124:577` | Declined with Undo for 1 minute and an optional reason |
| C-offline | `124:609` | The reply waits and sends once |
| C-error | `124:641` | The reply did not send and is still there |
| C-expired | `124:664` | An old inquiry link |
| C-denied | `315:1506` | Permission denied: signed in to another business |
| C3 at 768 px | `124:439` | |
| C3 at 1440 px | `313:1254` | The inquiries list beside the thread and its reply card |

### Flow D: a hauler confirms availability ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=124-674))

| Frame | Node | What it is for |
|---|---|---|
| D1 Text asking about availability | `124:687` | The text with the link, for when texts are on |
| D1b Email asking about availability | `315:1553` | The same ask by email, the working channel now |
| D2 Still available or Change | `124:721` | The one tap, no login. "Last confirmed 5 days ago" (the day-5 reminder). |
| D3 Confirmed | `124:792` | "Confirmed today", with Undo. "We will ask again in 5 days." |
| D4 Change availability | `124:832` | Truck count, when, or "not taking work for now" |
| D5 Change saved | `124:869` | What landings see now, with Undo |
| D-offline | `124:909` | The answer waits on the phone |
| D-error | `124:949` | It did not save. The same two answers stay. |
| D-expired | `124:972` | An old link: "Send me a new link" |
| D2 at 768 px | `124:755` | |
| D2 at 1440 px | `313:1301` | Two columns: the facts, then the answer card |

### Flow E: a landing reconfirms a job ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=131-443))

| Frame | Node | What it is for |
|---|---|---|
| E1 Text asking to reconfirm | `131:456` | The day-5 reminder as a text, for when texts are on |
| E1b Email asking to reconfirm | `315:1599` | The same reminder by email, the working channel now |
| E2 Still need trucks, Filled or Pause | `131:488` | The one tap, no login |
| E3 Reconfirmed | `131:552` | "Confirmed today", with Undo. The next ask is in 5 days; 14 days unconfirmed leaves Find Work. |
| E4 Marked as filled | `131:584` | Off the board, with Undo for 1 minute |
| E5 Paused | `131:616` | Paused, with Undo and "Turn job back on" |
| E-offline | `131:654` | The answer waits on the phone |
| E-error | `131:692` | It did not save. The same three answers stay. |
| E-expired | `131:715` | An old link |
| E2 at 768 px | `131:520` | |
| E2 at 1440 px | `313:1330` | Two columns: the job, then the three answers |

### Text message settings ([notes](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=131-725))

The consent words on these frames are pending the legal review (#291, #293). Texts are off by default.

| Frame | Node | What it is for |
|---|---|---|
| S1 Text settings, off | `131:753` | Off by default. The consent words come before the switch. |
| S2 Text settings, on, with quiet hours | `131:837` | Which texts, and quiet hours from 8:00 pm to 5:00 am |
| S3 First text, HELP and STOP | `131:860` | The first text and the HELP and STOP answers |
| S1 at 768 px | `131:782` | |
| S1 at 1440 px | `313:1354` | Two columns: the switch and number, then the consent words and Turn on texts |

### Dark theme (390 px, y = 11000)

| Frame | Node |
|---|---|
| A2 Job page, signed out · Dark | `315:1668` |
| B5 Who will get it · Dark | `315:1710` |
| C3 Inquiry thread · Dark | `315:1751` |
| D2 Still available or Change · Dark | `315:1789` |
| E2 Still need trucks, Filled or Pause · Dark | `315:1809` |

The notes for the 768 px row are at `131:976`.

## Design decisions on this page

The lead approved these on #334 (under the founder's delegation): the 72-hour single-use links, the 1-minute Undo hold, the day 5, 7 and 14 reconfirm timing (#114), the dated share card, and email as the working path while texts cost $0. The rest are proposals for the lead and the founder. None of the screens is approved.

- **Ready replies in flow C send in one tap.** A reply or a decline is held for 1 minute so Undo works, then it goes.
- **Phone reveal is offered only after the landing replies**, to that one hauler, and it is off until the landing says yes (founder decision 4). It can be hidden again.
- **An old link offers a new one** and never a dead end.
- **Flow A fills in the truck, count and start day from the job**, so a new hauler types only an email and a business name.
- **Flow B is three steps, not four**, with one publish statement in place of three checkboxes (audit 2: E2, E3). The draft saves after every change, on the phone and to the account (E1).
- **Key facts use `color/text` and `color/text-secondary` only.**

## Still composed on this page

These parts are frames built from 00 System variables, not 00 System components.

| Part | Why it is still local |
|---|---|
| The "Use code 482 913" row on A4b | It stands in for the phone's notification in the prototype |
| Top bar, segmented control, choice chips, number stepper, fact row, message bubble | Built as frames from variables in #300; the 00 System equivalents were not swapped in this pass |
| 10 icons: back, check, plus, minus, caret right, phone, mail, clock, offline, link | Not in the icon registry. Drawn as 2 px strokes bound to colour variables. |

Used from 00 System: Brand, Icon/*, Button, BottomActionBar, StepIndicator / Narrow, FreshnessChip (including filled and paused), Notice, Offline, Input, Checkbox, Switch, LoadingState, PermissionDenied, ResponsiveNavigation, all colour, spacing and radius variables, and the `type/*` text styles.

## Gaps

- **Closed in #352:** the Input error state now binds Value, Hint and a new Error property (A3-error and B2-error use them); FreshnessChip has filled and paused states; the 1440 frames are in columns, with the inquiries list beside the thread; the bottom bars and the flow B step indicator are 00 System instances.
- **Still local:** the top bars, segmented controls, choice chips, number steppers, fact rows and message bubbles listed above. 00 System has NumberStepper and SegmentedControl, but these frames were not swapped in #352.
- **The landing bottom tab bar** on B1 and C-inbox is 91 px tall since #352, because 00 System tab labels are 16 px and "Landing inbox" wraps.
- **Present mode.** The prototype was not checked in Present mode on a phone. The bar is pinned to the frame bottom; on frames taller than 844 px it should be checked there.
- **Text consent words** (S1 to S3, the phone sign-up and the first-text copy) wait for the legal review (#291, #293) before any text goes out. #291 item 17 asks for one unticked box per message category; S1 still has one switch.
- **Short links** such as `logloads.com/j/oak-cascade` are examples. The link shape belongs to P0-4 and P0-6.
- **The audience count** in B5 assumes the Find Trucks query (P1) can count by radius and truck type.
- **The copy deck** from #274 had not landed when this was drawn. Terms follow its draft ("Send interest", "Inquiries"), but the strings need a pass against the final deck.
- **New state frames** (A-loading, A3-error, B2-error, C-denied) have no incoming prototype links; they are states to compare, not steps in a flow.
