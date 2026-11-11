# Timber-hauling market research — November 2026

**Status:** Research notes for issue 267, read 10 November 2026. Blueprint prices cited here are **APPROVED** in the 1 November 2026 decision and remain **TARGET** until a delivery phase is authorized. Competitor prices are what the linked pages displayed that day.

Research for [LogLoads issue 267](https://github.com/AutomatedEmpires/logloads/issues/267). Pages below were read on 10 November 2026. Vendor prices move; the figure in the table is the figure on the linked page that day.

This memo compares public evidence with the adopted product in [LogLoads Product Blueprint v1.0](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md), recorded in the [1 November 2026 decision](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/DECISIONS.md). The blueprint says a delivery phase is not permission to deploy. Nothing in this file was sent, posted, or used to contact a person.

## Customer profiles and jobs to be done

Two businesses share one haul, and they do not buy the same thing.

**The logging contractor is the paying side.** In the South, landowners sell stumpage, an independent logging business cuts it, and the wood moves to a mill either on that business's own trucks or on an independent contractor's truck ([Derochers, Conrad, Bolding, Smidt, and Da Silva 2025](https://doi.org/10.1080/14942119.2024.2448936)). Waldo's own 2021 description of the Lake States uses the same chain: a forestry company, a logger, a subcontracted trucker, and a mill, with the day coordinated by phone, text, and paper ([Huhta and Halonen, University of Wisconsin Extension deck](https://florence.extension.wisc.edu/files/2021/05/Huhta.pdf)). A Michigan owner-operator told MLive that a morning started with eight to ten calls to find out which logger had wood, whether the road would hold a truck, and where the landing was ([MLive, 6 March 2023](https://www.mlive.com/public-interest/2023/03/up-logging-dates-back-to-1832-an-app-brings-it-into-the-21st-century.html)). Public Facebook posts show the same ask in writing: a South Georgia group post sought owner-operators around metro Atlanta for weekly loads, and an East Tennessee group post sought a truck for a few loads from Haletown to Stevenson ([South Ga Logging post](https://www.facebook.com/groups/1018648238262836/posts/9719461754848064/), [East TN logging post](https://www.facebook.com/groups/1389815224499466/posts/3001470253333947/)). Member counts were not checked.

The contractor's job is to keep a landing moving for weeks when a truck breaks, a driver quits, or the mill's quota opens. [Timber Harvesting's 2024 logger survey](https://timberharvesting.com/2024-logger-survey-working-tough-ground/) (almost 200 respondents, a magazine survey, not a census) found 45 percent had trucks parked for lack of qualified drivers, 61 percent buy at least some of their own timber, and 57 percent named load quotas among their top pressures. The buyer is often a logging business that both buys stumpage and has to find trucks, which is the person the blueprint calls a landing operator. The office that does the calling is small. The blueprint's Basic plan is aimed at one site and two people, owner and foreman ([blueprint §4.1](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)).

**The hauler has to be free.** Owner-operators and small fleets are the supply. VanderSchaaf, citing Conrad (2023), writes that 36 percent of timber harvested across much of the Southeast moved on owner-operator log trucks ([VanderSchaaf, USDA Forest Service GTR-274 poster](https://www.srs.fs.usda.gov/pubs/gtr/gtr_274.pdf_Pap_55.pdf)). Derochers and others found log trucks running in fleets of about 5 to 10, roughly five years older than other commercial trucks. A 2018 set of interviews with 18 Georgia truck owners, fleets from none to more than 50, found every participant saying qualified drivers were hard to find, and 44 percent named the driver shortage as the single greatest challenge ([Conrad, Forests, 2018](https://www.mdpi.com/1999-4907/9/10/650)). That sample is small and old. It matches the 2024 survey's parked trucks.

The hauler's job, on the evidence of how the haul is paid, is to fill a truck with a rate that can survive fuel, insurance, and unpaid empty miles. Near the end of 2022, VanderSchaaf puts owner-operator rates around $0.16 to $0.22 per ton per loaded mile. Gulf minimum-haul distances in that paper are commonly 30, 40, or 50 miles: the driver is paid the minimum even on a shorter haul, then an incremental rate beyond it, and the empty return is not what that formula pays. He modeled annual insurance at $10,000, $15,000, and $22,000; those are scenarios, not a measured average. At a worked example of $0.19 per ton per loaded mile, moving diesel from $3 to $6 a gallon cut modeled net revenue by up to 47.9 percent. A separate South-wide model of 909 deliveries from 257 harvest sites in 2019 and early 2020 found 14 percent of deliveries profitable when the driver was paid an hourly wage and 42 percent when the driver was paid 30 percent of gross revenue ([Conrad, Forests, 2021](https://www.mdpi.com/1999-4907/12/4/437)). Distance and turn time decided the result. A listing that hides the pay basis, the minimum haul, the destination area, or the trailer (pole versus four-bolster, which VanderSchaaf treats as different equipment) does not answer the question the driver is asking.

**A fleet is the same hauler with more units.** Derochers' 5-to-10-truck fleets are the blueprint's free fleet workspace: report how many of those trucks are free, of what configuration, in what area. The fleet's job is to put several trucks on one lasting job. It is a poor fit for a spot-load board built around one van load and one broker.

**Mills and foresters are adjacent, and they already have other software.** Mill procurement sometimes holds the truck list. Foresters in the Waldo deck want progress on a tract. Those are real jobs. They are the jobs Waldo now prices as tickets, reconciliation, and settlements ([Waldo pricing](https://www.waldologs.com/pricing)). The blueprint's paying customer remains the business that needs to advertise hauling work.

Jobs worth designing for:

| Person | Job to be done | What "done" looks like in the evidence |
|---|---|---|
| Logging contractor, one or a few landings | Fill a truck gap for a job that lasts weeks, without a new software project | Fewer blind calls; a posting that states pay, basis, trailer, area, destination area, and how many trucks ([blueprint §1.1–1.2](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md); [MLive](https://www.mlive.com/public-interest/2023/03/up-logging-dates-back-to-1832-an-app-brings-it-into-the-21st-century.html)) |
| Owner-operator | Find nearby work the rate can survive | Pay per ton per loaded mile or another stated basis, minimum haul, destination area, trailer fit, duration ([VanderSchaaf](https://www.srs.fs.usda.gov/pubs/gtr/gtr_274.pdf_Pap_55.pdf)) |
| Small fleet (about 5–10 trucks) | Place several of its own trucks | One company profile, a count of available units, still free ([Derochers et al. 2025](https://doi.org/10.1080/14942119.2024.2448936)) |
| Mill or wood dealer with a captive list | Cover a surge, or keep the list private | A board is useful only when their own list is short. A public posting can also advertise their wood to someone else's trucks. Treat this as a later buyer |

## Competitors and substitutes, with pricing tables

Prices are monthly unless the row says otherwise. "Retrieved" means the linked page displayed that figure on 10 November 2026.

### Logging and forest-products products

| Offer | Who pays | Price retrieved | What the buyer actually gets | Source |
|---|---|---|---|---|
| LogLoads Basic / Pro / Regional | Landing organization | $149 / $299 / $499 per month. Founding rate in the spec: $74.50 / $149.50 / $249.50 for six billing cycles, first ten qualifying organizations in a launched state. Boosts $99 / $149 / $199 for 7 / 14 / 28 days. Hauler price $0 | A posting for a lasting hauling need, inbound interest, and a capped count of opted-in invitations (3 / 10 / 30, no rollover). Specified, and the blueprint says a phase is not permission to deploy | [Blueprint §§3, 7, 8, 14](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) |
| Waldo Basic | Logger or trucker "working on a Waldo supply chain" | $0. Access is sent by email after a request | Unlimited digital tickets, harvest jobs, trip-ticket entry, scale-slip OCR | [waldologs.com/pricing](https://www.waldologs.com/pricing) |
| Waldo Standard | The account that wants settlements | "Starting at $150/month" | Basic, plus reconcile and export up to 2,000 loads a year, settlements, export to PDF, CSV, Caribou, and Forest Products Accounting | Same |
| Waldo Professional / Enterprise | Mid-size and larger operations | Custom | Up to 10,000 loads, or 10,000+, quota management, LIMS and API on Enterprise | Same |
| Timberlark job board | Either side, to post or browse | $0 to create an account, post, browse, or use the tools | A job board for logging, hauling, and related work, plus prices, ratings, and equipment listings | [Terms, updated 6 October 2026](https://timberlark.com/terms) |
| Timberlark completed job, paid on the platform | The accepting party, by deduction | 5 percent of job value, plus a 10% deposit charged to the accepting party when the job is accepted | Stripe payment, deposit refunded when the poster pays through the platform, deposit forfeitable if the acceptor does not perform | Same |
| Timberlark Business / EUDR Enterprise | Subscriber | $399 / $599 per month | API access to EUDR compliance records. The terms also name a Pro plan; the Pro monthly price was not on a Timberlark page opened for this memo. The marketing page's range "Free – $7,188/yr" matches $599 × 12 | [API docs](https://timberlark.com/api-docs), [Why Timberlark](https://timberlark.com/why-timberlark) |
| Forest Commodities Board, transportation | Transport company, as stated by the vendor | "No Cost. Our system is free — as our service relies on your business." | Lumber shipments across Canada, the United States, and Mexico for participating sawmills: book a load, print a dispatch sheet, invoices, certificates on file. The vendor says the board serves 200,000 destinations. That is their claim | [Forest Commodities Board](https://www.forcombo.com/lumber-transportation-overview.aspx/lumber-transportation-board.aspx) |

Waldo's pricing page also says "Trusted by 1,500 forestry professionals managing over 1,400 harvest areas nationwide." That is a vendor claim on the same page, not an audited share. The 2021 deck sold a job board ("Uber Freight for the logging industry"). The 2026 price list sells tickets and settlements. The overlap with LogLoads is the moment a logger needs a truck. The sale Waldo now publishes is paperwork after the truck is already in the job.

Timberlark is the closest public "post hauling work" board, and its terms make it a different business: it can hold a deposit and take a percentage when the job is paid on the platform. The operator on the terms page is Still Stumpin Logging Inc. The [loggers page](https://timberlark.com/loggers) also sells mill price boards, load-and-income tracking, and a route planner. Those are useful jobs. They are the jobs the 1 November 2026 decision left outside LogLoads.

Forest Commodities Board moves lumber from mills, with dispatch sheets and invoices. It is a substitute for outbound finished lumber, which is a different load from woods-to-mill logs.

A secondary company directory lists Axe Timber Transportation (Tyler, Texas, founded 2018), an app "connecting truckers for wood transportation," as deadpooled, last updated 15 April 2026 ([Tracxn](https://tracxn.com/d/companies/axetimbertransportation/__B9w1XjjvEcv7LSN69GS-yfHgiKH85RIKLZHnAZ4tfys)). That is a directory status, not a court filing. It is evidence that a U.S. wood-trucking app has already failed once, not evidence of why.

Loadshift posts timber-transport requests and lets carriers quote, at no charge to post, on an Australian marketplace ([Loadshift](https://www.loadshift.com.au/cargo-categories/timber-transport)). It is an analog from another country, not a U.S. rival.

### General freight load boards

These charge the carrier, and their rate tools are van, reefer, and flatbed.

| Board and plan | Who pays | Price retrieved | Notes | Source |
|---|---|---|---|---|
| DAT One Standard / Enhanced / Pro / Select / Office | Carrier | $59 / $149 / $169 / $259 / $339 per month | Lane-rate tools on the higher plans are for van, reefer, and flatbed. Pro is aimed at owner-operators with 1–3 trucks | [DAT carrier plans](https://www.dat.com/load-boards/tab-for-carriers) |
| Truckstop Basic / Advanced / Pro | Carrier, per user | $42 / $135 / $159 per month, before fees and taxes | A $42 application fee is credited to the first month if the carrier is approved. Loads shown match operating authority, so an intrastate-only carrier sees intrastate loads. Heavy Haul Pro is $299 for up to 3 users | [Truckstop pricing](https://truckstop.com/product/load-board/pricing/) |
| Truckstop Dry Van Basic / Dry Van Pro | Dry-van carrier | $35 / $129 per 3 users per month | The cheap entry is the wrong trailer for logs | Same |
| 123Loadboard Standard / Premium / Premium Plus | Carrier | $39 / $59 / $79 per month | The page says a 5-day free trial is included and advertises no contracts | [123Loadboard pricing](https://www.123loadboard.com/pricing/) |

DAT's $149 Enhanced seat is the same sticker as LogLoads Basic. The buyer is the opposite person: DAT charges the truck, LogLoads' spec charges the landing and leaves the truck at $0. A log truck that tried to "just use DAT" would pay a carrier seat for a board whose published rate averages are van, reefer, and flatbed, and whose loads follow operating authority that many woods-to-mill trucks do not hold beyond their state.

### Substitutes with no subscription

The working substitute is a phone list. MLive's Chassell driver described eight to ten calls a morning ([MLive](https://www.mlive.com/public-interest/2023/03/up-logging-dates-back-to-1832-an-app-brings-it-into-the-21st-century.html)). The blueprint describes the same status quo ([blueprint §1.1](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)). Facebook group posts are the public version of that list, already quoted above. A mill's preferred-carrier list is the private version: Derochers describes independent truckers contracting with the logging business, which is a relationship a website does not automatically enter.

Those substitutes cost money only in time, and they already know who answers the phone. A new board has to be more current than a Facebook post and faster than the tenth call, in a county where both sides actually are.

## Market size signals

There is no published census of log trucks. Derochers, Conrad, Bolding, Smidt, and Da Silva say so directly: knowledge gaps include "no estimate of the number of log truck drivers" and thin public cost data, because the firms are small, private, and not obliged to report ([2025 review](https://doi.org/10.1080/14942119.2024.2448936)). Any national "TAM" multiplied by $149 would be a story. The counts below are the ones a public source will stand behind.

**People at logging businesses.** BLS industry productivity, as republished by FRED, counts 57,100 jobs in logging (NAICS 113310) in 2025, down from 60,500 in 2024 and 65,600 in 2021. The series includes wage and salary workers, unincorporated self-employed workers, and unpaid family workers. A person with two jobs is counted twice. Retrieved 10 November 2026 ([FRED IPUAN113310W200000000](https://fred.stlouisfed.org/series/IPUAN113310W200000000)).

**Logging occupations, which are not truck drivers.** The Occupational Outlook Handbook counts 40,400 logging workers in 2025: fallers, equipment operators, graders, and scalers. Median pay was $49,660 in May 2025. Employment is projected to fall 5 percent from 2025 to 2035, with about 5,000 openings a year from people who leave, including retirement. Thirty percent were self-employed. Page last modified 27 August 2026 ([BLS OOH](https://www.bls.gov/ooh/farming-fishing-and-forestry/logging-workers.htm)).

**Truck drivers employed inside forestry and logging.** In NAICS 113, BLS counted 8,040 heavy and tractor-trailer truck drivers in 2025, median annual wage $52,120 ([BLS forestry and logging](https://www.bls.gov/iag/tgs/iag113.htm)). NAICS 113 is timber tracts, forest nurseries, and logging together. A contract hauler whose business is classified in truck transportation is outside this cell. The 8,040 is a floor under employed log-truck drivers at forestry establishments, and it is consistent with the review's statement that a full driver count does not exist.

**Business locations.** The same BLS page counts 8,501 private establishments in NAICS 113 in the fourth quarter of 2025 (8,387 preliminary in the first quarter of 2026). That is every timber tract, nursery, and logging establishment, not the count of businesses that will pay for a recruiting subscription.

**Wood that has to move.** The 2025 review, citing Oswalt and others (2019), says annual U.S. timber harvest is above 317 million tonnes, with about 60 percent from the South. Their South is Alabama, Arkansas, Florida, Georgia, Kentucky, Louisiana, Mississippi, North Carolina, Oklahoma, South Carolina, Tennessee, Texas, and Virginia. Average haul in that region, citing Conrad (2023a), TimberMart-South (2023), and Conrad and others (2024), is 80 km. Citing TimberMart-South, transportation was almost 33 percent of delivered pulpwood cost and about 22 percent of sawtimber cost in 2022, and in the third quarter of 2024 those shares were above 40 percent and 26 percent. Citing the Georgia Forestry Commission (2023), Georgia's forest industry employs over 57,000 people and about $41.9 billion of total revenue. That Georgia figure is the whole forest industry, mills included.

An older Forest Service statistical series, still the one opened for this memo, put total U.S. roundwood production at 15.9 billion cubic feet in 2017 ([Howard and Liang, FPL-RP-701, 2019](https://research.fs.usda.gov/treesearch/58506)). Use it as history. The South's share and the short haul are the operating facts.

**What contractors say is wrong, in one survey.** Of almost 200 loggers in Timber Harvesting's 2024 survey: 30 percent rated financial health poor or very poor, against 28 percent good or very good, the first time in the survey's 20-plus years that the negatives led. Sixty-six percent saw lower sawlog and plylog demand. Eighty-nine percent saw lower pulp and fiber demand. The top challenges were insurance (68 percent), limited markets (62 percent), load quotas (57 percent), and mill compensation (56 percent). Forty-five percent had trucks parked for lack of drivers. Eighty-five percent would take other work rather than relocate to stay in logging ([Timber Harvesting](https://timberharvesting.com/2024-logger-survey-working-tough-ground/)).

Read together: the wood is concentrated, the haul is local, the contractor is squeezed by insurance and mill quotas, and the scarce resource named by both the 2018 interviews and the 2024 survey is a qualified driver. A national count of "logging businesses × $149" is not a forecast.

## Acquisition channels and communities

The audience already gathers in a few places. Each channel below is a place to be invited, which is a different act from posting into it.

**State and regional logging associations, through the American Loggers Council.** ALC describes itself as the national body for independent loggers and log-truck contractors and lists state affiliates on its board, including the Carolina Loggers Association, Associated Oregon Loggers, the South Carolina Timber Producers Association, the Southern Loggers Cooperative, the Texas Logging Council, the Virginia Loggers Association, the Washington Contract Loggers Association, and the Great Lakes Timber Professionals Association ([ALC about page](https://americanloggerscouncil.com/about-us/)). A newsletter mention or a table at their meeting is the cleanest way to reach both sides. The association should send to its own list. LogLoads should not ask for the list.

**Logger training that people already have to attend.** In Oregon, Associated Oregon Loggers' Oregon Professional Logger credential is the Sustainable Forestry Initiative qualified-logging-professional program, required by SFI-certified landowners and mills that demand it. Training covers forest practices, safety, and business, and it is offered around the state ([Oregon OPL](https://oregonloggers.org/page/OPL)). Other states were not each verified. Oregon is the pattern: a room of contractors who came for a credential, not for a software pitch. The Oregon Logging Conference is a dated example of the same crowd in one hall, 25–27 February 2027 in Eugene ([conference site](https://oregonloggingconference.com/)).

**Trade press they already answer.** Timber Harvesting (Hatton-Brown, Montgomery) got almost 200 loggers to answer the 2024 survey. That is evidence the magazine reaches working contractors. A later, clearly labeled item belongs after a pilot has real jobs. It is not the first spend.

**Facebook groups where the request is already public.** The South Georgia and East Tennessee posts cited above are the channel. Group admins decide what may be promoted. Meta's help center says Facebook does not allow people to send messages promoting a product, and it flags repeated identical messages ([Facebook Help](https://www.facebook.com/help/103891719700884)). The spam standard restricts high-frequency and repetitive posting ([Meta spam policy](https://transparency.meta.com/en-us/policies/community-standards/spam/)). The useful move is to read the language contractors already use ("owner ops," "loads moving weekly") and to post only where an admin has agreed. Scraping members is how an account gets treated as spam, and it collides with the email rules in the draft section.

**The phone list and the mill's carrier list.** These are the incumbent channel, documented by MLive and by the supply-chain descriptions above. They do not have a signup URL. The practical entry is one contractor who will post a real job, then the drivers that contractor already calls.

Order that matches the evidence: haulers in one wood basin first, so a landing has someone to find; then the contractors who are short of trucks; association staff as the introducer; Facebook as a place to be invited, not a place to blast. Eighty-five percent of the surveyed loggers would leave the industry before they would move, so a national signup campaign recruits people who will not haul the wood.

## Positioning recommendations against the current product

These recommendations keep the 1 November 2026 prices and the boundary around dispatch, tickets, and freight payment. They say where to stand. A price change would need a new decision, which this memo does not make. The blueprint already flags pricing as something to validate with paying operators ([blueprint §16.2](https://github.com/AutomatedEmpires/logloads/blob/work/logloads-repair/docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)).

1. **Charge the landing and keep the truck free.** DAT, Truckstop, and 123Loadboard charge the carrier from $39 to $339 a month for freight that is not a log trailer. The Southeast evidence says a large share of wood moves on owner-operators who already pay insurance in the tens of thousands and who are recruited today with a phone call. A hauler fee would ask the scarce side to pay for a thinner board than the one they already ignore. The blueprint's "free forever" hauler is the position the substitutes support.

2. **Sell a job that lasts, with the pay basis the industry uses.** The unit in VanderSchaaf is dollars per ton per loaded mile, a minimum haul, and an incremental rate. The unit on DAT is a spot load. The blueprint already requires pay amount and pay basis, equipment, origin area, destination area, duration, and truck demand. The research says those fields are the listing. A posting that says "$X" and omits per ton, per ton-mile, per load, or per hour will look like the Facebook post, with extra steps.

3. **Leave tickets, settlements, deposits, and a percentage of the haul to the products that already sell them.** Waldo's published price starts at $0 for tickets and "starting at $150/month" once settlements are included. Timberlark's terms take 5 percent and a 10 percent deposit when the job is paid on the platform. Copying either feature would turn LogLoads into the model the 1 November decision retired. The sentence to keep is the blueprint's: the parties arrange the haul themselves.

4. **Open one basin, on the founding price, before selling the rack rate or a boost.** About 60 percent of harvest is in the South and the average haul cited there is 80 km, so the market is many local markets. Timber Harvesting's respondents are watching pulp demand fall, living with quotas, and, in 30 percent of answers, rating the business poor or very poor. Basic at $149 is a real invoice in that year. The spec's founding rate, $74.50 for six cycles for the first ten qualifying landings in a launched state, is the offer that matches the survey. Boosts at $99 to $199 and the 3/10/30 invitations need opted-in haulers in the radius first. The blueprint already says to show the eligible audience and to hold back sparse-market boosts. The research says that rule is the launch plan, not a later nicety.

5. **Speak to the contractor who is short a driver, and say what the board cannot do.** Forty-five percent of surveyed loggers have trucks parked because the driver is missing. A listing site can show a truck that is already running and already free. It cannot put a driver in a parked truck, and it cannot make a mill raise a quota. The honest line is "see the log trucks that say they are available near this landing," with a time on the availability. Insurance was the number-one challenge in that survey (68 percent). A badge that implies LogLoads checked insurance or safety would answer the question contractors ask with a claim the blueprint forbids. BLS recorded 67 fatalities in forestry and logging in 2024 ([BLS IAG](https://www.bls.gov/iag/tgs/iag113.htm)), which is a reason to keep verification language narrow.

6. **Lead with Basic.** The published fleet size is about 5 to 10 trucks, and the blueprint's Basic buyer is one landing and two seats. Regional, at $499 and ten seats, fits a multi-site operation that the survey does not describe as the typical respondent. Pro is the step when a contractor truly runs two or three landings at once. First conversations belong on Basic and on the founding discount.

7. **Use their words.** Contractors in the public posts ask for "owner ops" and "a log truck," and they name the towns. The blueprint's preferred language ("post unlimited hauling opportunities," "find available log trucks," "drivers and hauling companies find work free forever") fits. "Load board" is understandable next to DAT, and it needs the next sentence: this is a logging job that can last weeks, and the truck does not pay to look.

## Risks

| Risk | Evidence | What to do with it |
|---|---|---|
| The board is empty in the county that matters | No national driver census ([Derochers et al. 2025](https://doi.org/10.1080/14942119.2024.2448936)). Recruiting is local and already done by phone ([MLive](https://www.mlive.com/public-interest/2023/03/up-logging-dates-back-to-1832-an-app-brings-it-into-the-21st-century.html)). The blueprint's own risk row is thin regional supply | One basin. Haulers before paid landings. Show the eligible audience before an invitation or a boost is sold |
| Contractors will not pay | 2024 survey: weak pulp markets, quotas, insurance, 30 percent rating health poor or very poor ([Timber Harvesting](https://timberharvesting.com/2024-logger-survey-working-tough-ground/)) | Founding half-price is the first offer to test. A failed test is a pricing decision for the founder, not a silent change |
| The scarce input is a driver, and software does not mint one | 45 percent of surveyed loggers have trucks parked for lack of drivers. Every Georgia firm interviewed in 2018 said drivers were hard to find | Say "available trucks," with a timestamp. Do not claim the product ends the driver shortage |
| A percentage or a wallet looks like the competitor, and like the retired model | Timberlark's terms: 5 percent and a 10 percent deposit ([terms](https://timberlark.com/terms)). Waldo's price list is settlements ([pricing](https://www.waldologs.com/pricing)) | Keep freight payment, scale tickets, and dispatch outside the product, as the blueprint requires |
| "Verified" becomes a false safety claim | Insurance is the top survey challenge. 67 fatalities in NAICS 113 in 2024 ([BLS](https://www.bls.gov/iag/tgs/iag113.htm)). The blueprint bars unverified safety and insurance claims | Business identity is the only check until a real check exists. The screen should say which |
| Stale work teaches drivers to go back to the phone | The 2021 delivery study shows unprofitable hauls when time and distance are wrong ([Conrad 2021](https://www.mdpi.com/1999-4907/12/4/437)). A dead posting is worse than no posting | Reconfirm jobs. The blueprint already treats freshness as a trust metric |
| Broker or arranging-transport questions | The blueprint's regulatory note: a subscription and the words "load board" do not decide legal status | Counsel reviews the actual invitation and messaging flow before money is taken. This memo is not that review |
| Outreach becomes spam | CAN-SPAM, 15 U.S.C. § 7704, and Meta's rules on promotional messages, cited in the draft section | The drafts stay drafts until the founder approves a specific send, to a specific list, with a physical address and a working unsubscribe |
| Vendor and survey numbers get repeated as facts | Waldo's "1,500 professionals" is a marketing line. Timber Harvesting's percentages are almost 200 self-selected readers. Tracxn's "deadpooled" is a directory | Keep the caveat next to the number any time it is reused in a pitch |

## DRAFT - NOT SENT: candidate outreach segments and two or three draft messages

Nothing below has been sent, posted, or queued. Each draft needs the founder's approval before it goes to anyone. Each draft is an advertisement. If it is ever emailed, it has to meet the CAN-SPAM Act, 15 U.S.C. § 7704: a subject line that does not mislead, a clear statement that the message is an advertisement (unless the person has already given affirmative consent), a working way to opt out that still works for at least 30 days, honor opt-out requests within 10 business days, and a valid physical postal address ([text of § 7704](https://www.law.cornell.edu/uscode/text/15/7704)). The opt-out cannot require a fee or any information beyond the email address and the opt-out choice ([16 C.F.R. § 316.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.5)). Harvested addresses and dictionary attacks are aggravated violations when the message otherwise breaks those rules (§ 7704(b)).

Do not send these as Facebook messages or as copy-pasted group posts. Meta tells users it does not allow messages that promote a product or opportunity, and it flags repeated identical messages ([Facebook Help](https://www.facebook.com/help/103891719700884)). A group post happens only after that group's admin has said yes, in that group, for that wording.

Text messages are not drafted. A text is covered by the Telephone Consumer Protection Act, 47 U.S.C. § 227, including where a text is sent in violation of the call rules ([§ 227](https://www.law.cornell.edu/uscode/text/47/227)). SMS needs its own consent review and is outside this task.

Segments, in the order to consider them:

1. **Owner-operators and log-truck companies in one pilot state.** The evidence for the segment is the owner-operator share VanderSchaaf cites, the 5-to-10-truck fleets in Derochers, and the phone-call morning in MLive. The lawful source of names is people who ask, or an association that sends the note itself. A Facebook group membership list is not a source.
2. **Logging contractors who are short of trucks.** The evidence is the 2024 survey's parked trucks and the public posts asking for owner-operators. Send only after a real job can be posted and a hauler in that area can see it. An empty board will spend the founding discount on a bad first month.
3. **Association staff who already have the newsletter and the training day.** The evidence is the ALC affiliate list and Oregon's OPL program. This is a request for an introduction, still commercial, still unsent.

Placeholders in brackets are unfilled on purpose. There is no physical address, no URL, and no personal name in these drafts.

### Draft 1 — hauler. Needs founder approval before it is sent

To: a person in segment 1 who asked, or via an association send. Not a scraped list.

Subject: Advertisement: log-truck work listings in [PILOT STATE], free to look

This is an advertisement from LogLoads.

Hauling businesses can look at logging work and send interest without a subscription. A listing is meant to show the pay, the pay basis (per ton, per ton-mile, per load, or per hour, as the landing wrote it), the trailer, the area, and how long the work is expected to last. LogLoads does not dispatch the truck and does not pay the freight. You and the landing arrange that yourselves.

If you haul logs in [PILOT STATE], the page is [URL]. A profile is free. You can ignore this note.

LogLoads
[STREET ADDRESS, CITY, STATE, ZIP]
Stop these emails: [ONE-CLICK UNSUBSCRIBE URL]

### Draft 2 — logging contractor. Needs founder approval before it is sent

To: a person in segment 2. Send only when [PILOT STATE] has haulers who can actually see a posting.

Subject: Advertisement: post a log-truck need in [PILOT STATE]

This is an advertisement from LogLoads.

When you are short a truck, LogLoads is built so you can post the work once: the landing area, what you pay and on what basis, the trailer, and how many trucks you want. Haulers look for free. You pay a monthly plan only if you choose to post. The specified prices are $149, $299, and $499 a month. The first ten qualifying businesses in a launched state are specified at half of that for six billing cycles. Those prices are the published spec. They are not a promise that trucks are sitting in your county. If few haulers nearby have opted in, the product is supposed to say so before you spend an invitation or a boost.

Reply if you want to hear when a pilot opens in [PILOT STATE]. A reply does not start a subscription. To stop these emails, use the link below.

LogLoads
[STREET ADDRESS, CITY, STATE, ZIP]
Stop these emails: [ONE-CLICK UNSUBSCRIBE URL]

### Draft 3 — association staff. Needs founder approval before it is sent

To: one named staff person at an association in segment 3, after the founder has agreed to the ask. This is still a commercial email and it carries the same footer.

Subject: Advertisement and request: a labeled mention for a free log-truck listing

Hello [FIRST NAME],

This is an advertisement and a request from LogLoads. We have not bought a booth, and this note is not an invoice.

LogLoads is a timber-hauling listing board. Trucking businesses would use it at no charge. A logging business that wants to advertise a job would be the side that pays, on a monthly plan, and only in a state we have actually opened. I am not asking [ASSOCIATION] to endorse the product. I am asking whether you would consider a short, clearly labeled mention in [NEWSLETTER], aimed at owner-operators and small fleets, after you have seen the final wording.

I will not email your members unless you tell us that is allowed. If a training day is a better place for a table, tell me who decides that.

LogLoads
[STREET ADDRESS, CITY, STATE, ZIP]
Stop these emails: [ONE-CLICK UNSUBSCRIBE URL]
