/*
 * Prototype content. Fictional businesses and jobs, kept apart from presentation.
 * Field names follow packages/contracts MarketplaceJobCardView where one exists (pay.amountCents/unit/note,
 * trucks.total/perDay, origin.label, haulDistance, lastConfirmedAt), so components receive view models, not
 * page-specific strings. Formatting (pay labels, freshness wording) happens in shared formatters, as
 * apps/web/components/v2/format.ts and contracts postingFreshness() already do.
 */
window.LL_DATA = {
  now: "2026-11-02",
  viewer: {
    hauler: { id: "rh", name: "Ridgeline Hauling", initials: "RH", role: "Owner", kind: "Hauler", setups: ["log_pole", "self_loader", "chip_van"] },
    landing: { id: "cf", name: "Cedar Fork Logging", initials: "CF", role: "Manager", kind: "Landing operator", plan: "Pro" }
  },
  jobs: [
    { id: "oak", title: "Oak saw logs to Springfield", poster: { name: "Cedar Fork Logging", verified: "Business identity · Oct 2026" },
      pay: { amountCents: 52500, unit: "per_load", note: null }, product: "Saw logs", tonsPerLoad: 28,
      origin: { label: "Oakridge, OR", milesFromViewer: 41 }, destination: "Springfield mill", haulDistance: { miles: 54, basis: "poster_route_estimate" },
      equipment: ["log_pole"], startsOn: "Nov 10", duration: "About 3 weeks", trucks: { total: null, perDay: 3 },
      lastConfirmedAt: "today", freshness: "confirmed", sponsored: false, status: "active", interest: { total: 3, new: 1 }, landing: "Hills Creek Unit 4",
      road: "Gravel for the last 6 miles. CB channel 7.", hours: "Loading from 5 a.m." },
    { id: "pulp", title: "Pulpwood, steady through December", poster: { name: "Upper Fork Timber", verified: null },
      pay: { amountCents: 11800, unit: "per_hour", note: null }, product: "Pulpwood", tonsPerLoad: null,
      origin: { label: "Lowell, OR", milesFromViewer: 33 }, destination: "Eugene chip yard", haulDistance: { miles: 31, basis: "poster_route_estimate" },
      equipment: ["log_bunk"], startsOn: "From Nov 6", duration: "Ongoing", trucks: { total: 4, perDay: null },
      lastConfirmedAt: "yesterday", freshness: "confirmed", sponsored: true, status: "active", interest: { total: 0, new: 0 }, landing: "Fall Creek",
      road: "Paved to the landing.", hours: "Two shifts" },
    { id: "fir", title: "Douglas-fir long logs, Blue River unit", poster: { name: "McKenzie Ridge Logging", verified: "Business identity · Sep 2026" },
      pay: { amountCents: 61000, unit: "per_load", note: null }, product: "Saw logs", tonsPerLoad: 30,
      origin: { label: "Blue River, OR", milesFromViewer: 58 }, destination: "Springfield mill", haulDistance: { miles: 47, basis: "poster_route_estimate" },
      equipment: ["self_loader"], startsOn: "Nov 12", duration: "About 10 days", trucks: { total: null, perDay: 5 },
      lastConfirmedAt: "2 days ago", freshness: "confirmed", sponsored: false, status: "active", interest: { total: 0, new: 0 }, landing: "Blue River 9",
      road: "Steep spur; chains may be required.", hours: "Loading from 4:30 a.m." },
    { id: "chip", title: "Chips to the Albany pulp mill", poster: { name: "Ridge Top Fiber", verified: null },
      pay: { amountCents: 940, unit: "per_ton", note: null }, product: "Chips", tonsPerLoad: 25,
      origin: { label: "Sweet Home, OR", milesFromViewer: 6 }, destination: "Albany pulp mill", haulDistance: { miles: 38, basis: "poster_route_estimate" },
      equipment: ["chip_van"], startsOn: "Nov 4", duration: "About 20 days", trucks: { total: null, perDay: 2 },
      lastConfirmedAt: "3 days ago", freshness: "confirmed", sponsored: false, status: "active", interest: { total: 0, new: 0 }, landing: "Ames Creek",
      road: "Paved.", hours: "Daylight" },
    { id: "hard", title: "Hardwood logs to Philomath", poster: { name: "Marys Peak Hardwoods", verified: null },
      pay: { amountCents: 285, unit: "per_mile", note: null }, product: "Hardwood logs", tonsPerLoad: null,
      origin: { label: "Alsea, OR", milesFromViewer: 72 }, destination: "Philomath sawmill", haulDistance: { miles: 24, basis: "straight_line_estimate" },
      equipment: ["log_bunk"], startsOn: "Nov 5", duration: "4 days", trucks: { total: 2, perDay: null },
      lastConfirmedAt: null, freshness: "unconfirmed", sponsored: false, status: "active", interest: { total: 0, new: 0 }, landing: "Alsea 2",
      road: "Not stated.", hours: "Not stated" },
    { id: "pole", title: "Utility poles, two loads", poster: { name: "Mosby Creek Contracting", verified: null },
      pay: { amountCents: null, unit: "negotiable", note: "Set by pole length and count" }, product: "Poles", tonsPerLoad: null,
      origin: { label: "Cottage Grove, OR", milesFromViewer: 64 }, destination: null, haulDistance: null,
      equipment: ["log_pole"], startsOn: "Nov 8 to 15", duration: "1–2 days", trucks: { total: 1, perDay: null },
      lastConfirmedAt: "12 days ago", freshness: "stale", sponsored: false, status: "active", interest: { total: 0, new: 0 }, landing: "Mosby 4",
      road: "Gravel.", hours: "By arrangement" }
  ],
  equipmentTypes: {
    log_pole: "Log truck + pole trailer", log_bunk: "Log truck + bunk / short-log", self_loader: "Self-loader log truck", chip_van: "Chip truck + chip van", lowboy: "Lowboy / heavy haul"
  },
  business: {
    id: "rh", name: "Ridgeline Hauling", initials: "RH", kind: "Hauling company", home: "Sweet Home, Oregon", since: 2009,
    verification: { date: "Oct 2026", checked: ["Business registration matches the name shown", "Owner identity checked"], notChecked: ["Insurance", "Operating authority", "Equipment condition"] },
    about: "Family-run hauling company working the west slope of the Cascades since 2009. We run long logs, poles and chips for contractors in Linn, Lane and Benton counties, and we're used to steep gravel spurs and early starts.",
    region: { home: "Sweet Home, OR", counties: ["Linn", "Lane", "Benton"], radiusMiles: 120 },
    products: ["Saw logs", "Poles", "Chips", "Pulpwood"], contact: "LogLoads messages",
    photos: [{ caption: "Log truck + pole trailer" }, { caption: "Self-loader at the Blue River landing" }, { caption: "Chip van" }],
    equipment: [
      { id: "e1", type: "log_pole", spec: "Kenworth T880 and Peterbilt 389 tractors · 5-axle", units: 6, state: "available_from", available: 4, from: "Nov 10", updated: "Today by Jamie M." },
      { id: "e2", type: "self_loader", spec: "Knuckle-boom loader", units: 2, state: "unavailable", available: 0, from: "Nov 18", updated: "Today by Jamie M." },
      { id: "e3", type: "chip_van", spec: "Walking-floor vans", units: 2, state: "unknown", available: null, from: null, updated: "Oct 9 by Jamie M." }
    ]
  },
  landingOverview: {
    plan: { name: "Pro", landings: [2, 3], seats: [4, 5], invitations: [7, 10], resets: "Dec 1" },
    attention: [
      { text: "1 new hauler interested", sub: "Oak saw logs to Springfield", action: "Review", go: "inquiry" },
      { text: "Pulp to Eugene not confirmed for 9 days", sub: "Haulers see \"Last confirmed 9 days ago\"", action: "Reconfirm" },
      { text: "Draft: Cedar poles to Cottage Grove", sub: "Pay basis missing. Required to publish.", action: "Finish draft" }
    ],
    landings: [
      { name: "Hills Creek Unit 4", area: "Near Oakridge, OR", state: "Recruiting", jobs: 2 },
      { name: "Brice Creek", area: "Near Cottage Grove, OR", state: "Recruiting", jobs: 1 },
      { name: "Layng Creek", area: "Near Dorena, OR", state: "Paused · not counted", jobs: 0 }
    ],
    jobs: ["oak", "pulp"]
  },
  inquiries: [
    { id: "rh", name: "Ridgeline Hauling", verified: true, kind: "Hauling company · Sweet Home, OR", offer: [["2 × Log truck + pole trailer", true]], from: "Nov 10",
      updated: "Availability updated today", time: "2 h ago", state: "new", note: "Both trucks can run Tuesdays and Thursdays. We know the Hills Creek spur.", sentAt: "today at 4:12 PM" },
    { id: "uw", name: "Upper Willamette Haul Co.", verified: false, kind: "Hauling company · Oakridge, OR", offer: [["1 × Log truck + pole trailer", true], ["1 × Chip truck", false]], from: "Nov 12",
      updated: "Availability updated 3 days ago", time: "Yesterday", state: "seen", note: "One long-log truck free from the 12th.", sentAt: "yesterday" },
    { id: "ks", name: "K. Sorensen Trucking", verified: false, kind: "Owner-operator · Westfir, OR", offer: [["1 × Log truck + pole trailer", true]], from: "Nov 10",
      updated: "Availability not recently confirmed", time: "Nov 1", state: "replied", note: "", sentAt: "on Nov 1",
      thread: [{ side: "me", text: "Thanks. Can you confirm a pole trailer rated for 40-ft logs?", at: "You · Nov 1" }] }
  ]
};
