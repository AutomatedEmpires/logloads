# Incident plan: personal information

> **Status:** TARGET operating procedure for gate A (legal review §6.6 item 6, logloads#343). Written 2026-11-18. It
> has not been exercised. Every notice deadline below is marked **counsel to confirm**: each is a reading of the
> statute cited in [legal review §6.1](../legal/2026-11-legal-review.md#61-which-laws-apply-now), checked against the
> state's own published text on 2026-11-18, and it is not legal advice. Counsel confirms the table before gate A.

## 1. What this covers

Any event where personal information LogLoads holds may have been seen, taken, changed or deleted by someone not
allowed to: a leaked key or token, a wrong grant or row-level security rule, a bug that shows one business another's
private details, a lost device, or a breach at a provider.

State breach laws are triggered by a person's name together with items such as a Social Security number, a driver's
licence number, a financial account number with its access code, or sign-in credentials. LogLoads does not collect the
first three (legal review §6.6 item 2), and Clerk holds the passwords, so a statutory notice is most likely after a
credential or provider breach. An incident that triggers no statute (gate codes, exact landing points, messages, phone
numbers, hauler contact details) is still handled with this plan, and the people affected are still told: the Privacy
Policy is a promise (FTC Act section 5).

## 2. Who decides

| Decision | Who |
|---|---|
| Declare an incident, and close it | The founder |
| Any production, provider, credential or access change to contain it | The founder authorizes it (AGENTS.md §4); an agent or engineer carries it out |
| Whether to notify people, regulators or the public, and what the notice says | The founder, after counsel |
| What the law requires, state by state | Counsel |

Until a second accountable person is named here, the founder decides alone. If the founder cannot be reached, nobody
sends a notice or changes production: whoever found the incident preserves the evidence (§4, step 2) and keeps trying.
Agents never decide whether an incident happened or who is told.

## 3. Who is told, and when

The clock starts when the incident is **discovered**, not when it is confirmed.

| When | Who is told | By |
|---|---|---|
| At once, within 1 hour | The founder | Whoever found it |
| The same day | Counsel; each provider involved (Clerk, Supabase, Vercel, Resend, PostHog, Sentry, Stripe, CARTO) | The founder |
| As soon as the facts allow, and within the deadlines in §5 | The people affected | The founder, with counsel |
| Where a state requires it (§5) | That state's attorney general or consumer protection office | The founder, with counsel |
| Where a state requires it above a number of residents | The nationwide consumer reporting agencies (Oregon: more than 1,000 consumers affected; Texas: more than 10,000 people notified at once; counsel to confirm) | The founder, with counsel |
| Only on valid legal process, logged, with counsel | Law enforcement. A law-enforcement request to delay notice is recorded in writing | The founder |

**The working deadline is 30 days from discovery for everyone**, because it is the shortest fixed deadline in §5 and
the residents of an incident are rarely known on day one. Every statute also says "without unreasonable delay", so
30 days is an outer limit, not a target.

## 4. Steps

1. **Contain**, with the founder's authorization: revoke the leaked key, close the grant, take the page down or roll
   back the deployment ([`RECOVERY.md`](../RECOVERY.md) for the data itself).
2. **Preserve**: keep logs, audit rows and backups as they are. Delete nothing, and do not "fix" a row before it is
   copied.
3. **Assess**: what data, about whom, since when, and in which states the people live (their business's state and
   basin). Decide with counsel whether a statute is triggered (§1).
4. **Notify**: in the order and within the deadlines of §3 and §5.
5. **Record**: keep a private incident record with the timeline, the decisions and who made them. Never put personal
   information in a GitHub issue, a pull request, a commit message, an analytics event or a chat transcript.
6. **Review**: within two weeks of closing, write down the cause and the change that stops it recurring.

## 5. State notice deadlines (§6.1)

| State | Statute | Notice to the people affected | Notice to the state |
|---|---|---|---|
| Washington | RCW 19.255.010 | No more than 30 calendar days after discovery. **Counsel to confirm.** | The attorney general, if more than 500 Washington residents, no more than 30 days after discovery. **Counsel to confirm.** |
| California | Cal. Civ. Code 1798.82 | Within 30 calendar days of discovery (SB 446, 2025). **Counsel to confirm.** | A sample copy to the attorney general, if more than 500 California residents, within 15 calendar days of notifying them. **Counsel to confirm.** |
| Oregon | Or. Rev. Stat. 646A.604 | Without unreasonable delay, and no later than 45 days after discovery. **Counsel to confirm.** | A copy of the notice to the Oregon Department of Justice, if more than 250 Oregon consumers. No separate deadline was found; send it with the notices. **Counsel to confirm.** |
| Idaho | Idaho Code 28-51-105 | In the most expedient time possible and without unreasonable delay. No fixed number of days. **Counsel to confirm.** | None found for a private business (the 24-hour attorney general notice applies to public agencies). **Counsel to confirm.** |
| Montana | Mont. Code 30-14-1704 | Without unreasonable delay. No fixed number of days. **Counsel to confirm.** | An electronic copy of the notice to the Office of Consumer Protection at the same time as the notice. **Counsel to confirm.** |
| Texas | Tex. Bus. & Com. Code 521.053 | Without unreasonable delay, and no later than 60 days after determining that the breach occurred. **Counsel to confirm.** | The attorney general, if at least 250 Texas residents, no later than 30 days after that determination, on the attorney general's online form. **Counsel to confirm.** |
| Any other state | That state's law | Counsel lists the deadline before any notice goes out. Until then, the 30-day working deadline (§3) applies. **Counsel to confirm.** | As that state's law requires. **Counsel to confirm.** |

A delay asked for by law enforcement pauses most of these deadlines; it is recorded with who asked and when.

## 6. What a notice says

In plain words: what happened and when, what information was involved, what LogLoads has done, what the person can
do (for example, change their password), and how to reach LogLoads (`support@logloads.com`). Counsel reviews each
notice before it is sent. A notice never names another affected person or business.
