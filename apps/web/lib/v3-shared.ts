import type { NetworkLoadView, NetworkView } from "./network"

export interface PublicStoryPage {
  slug: string
  eyebrow: string
  title: string
  intro: string
  sections: Array<{
    title: string
    body: string
    points: string[]
  }>
  cta: {
    href: string
    label: string
  }
  attribution?: string
}

export interface LegalPageContent {
  slug: string
  title: string
  intro: string
  effectiveDate: string
  sections: Array<{
    title: string
    body: string
    points: string[]
  }>
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function loadSlug(load: Pick<NetworkLoadView, "reference" | "title">): string {
  return `${slugify(load.title)}-${slugify(load.reference)}`
}

export function publicLoadHref(load: Pick<NetworkLoadView, "reference" | "title">): string {
  return `/loads/${loadSlug(load)}`
}

export function formatHuman(value: string): string {
  return value.replaceAll("_", " ")
}

/** Title-cases a snake_ or kebab-case tag (e.g. "chip-box" -> "Chip Box"). */
export function humanizeTag(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`
}

export function fitLabel(load: NetworkLoadView): string {
  if (!load.compatibility) {
    return "Add equipment to see fit"
  }

  if (load.compatibility.eligibility === "strong_match") {
    return "Strong fit"
  }

  if (load.compatibility.eligibility === "eligible_with_review") {
    return "Review needed"
  }

  if (load.compatibility.eligibility === "ineligible") {
    return "Not compatible"
  }

  return "Potential fit"
}

export function fitTone(load: NetworkLoadView): "success" | "warning" | "critical" | "info" {
  if (!load.compatibility) {
    return "info"
  }

  if (load.compatibility.eligibility === "strong_match") {
    return "success"
  }

  if (load.compatibility.eligibility === "eligible_with_review") {
    return "warning"
  }

  if (load.compatibility.eligibility === "ineligible") {
    return "critical"
  }

  return "info"
}

export function visibilityLabel(load: Pick<NetworkLoadView, "visibilityMode">): string {
  if (load.visibilityMode === "private_network") {
    return "Partner load"
  }

  if (load.visibilityMode === "direct_offer") {
    return "Direct offer"
  }

  if (load.visibilityMode === "verified_network") {
    return "Verified network"
  }

  return "Open network"
}

export function loadProductLabel(load: Pick<NetworkLoadView, "loadType" | "title">): string {
  if (load.title.toLowerCase().includes("chip")) {
    return "Chip haul"
  }

  if (load.title.toLowerCase().includes("pulp")) {
    return "Pulpwood haul"
  }

  if (load.title.toLowerCase().includes("standby")) {
    return "Standby haul"
  }

  return `${formatHuman(load.loadType)} haul`
}

export function shortLane(load: Pick<NetworkLoadView, "landing" | "destination">): string {
  return `${load.landing.city} to ${load.destination.name}`
}

export function tripActionLabel(status: NetworkView["trips"][number]["status"]): string {
  const labels: Record<NetworkView["trips"][number]["status"], string> = {
    assigned: "Head to landing",
    at_destination: "Start unloading",
    cancelled: "Cancelled",
    checked_in: "Wait for loader",
    completed: "Delivered",
    en_route_to_destination: "Head to mill",
    en_route_to_landing: "Head to landing",
    loaded: "Head to mill",
    loading: "Confirm loaded",
    unloading: "Confirm delivery"
  }

  return labels[status]
}

export function tripStatusLabel(status: NetworkView["trips"][number]["status"]): string {
  const labels: Record<NetworkView["trips"][number]["status"], string> = {
    assigned: "Assigned",
    at_destination: "At mill",
    cancelled: "Cancelled",
    checked_in: "At landing",
    completed: "Delivered",
    en_route_to_destination: "To mill",
    en_route_to_landing: "To landing",
    loaded: "Loaded",
    loading: "Loading",
    unloading: "Unloading"
  }

  return labels[status]
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not set"
  }

  // Intl throws RangeError on an invalid Date, which would take down the whole
  // render for one bad timestamp. A stored value that will not parse is the
  // same practical thing as an absent one.
  if (Number.isNaN(new Date(value).getTime())) {
    return "Not set"
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(new Date(value))
}

export function userPlanFeatures(product: string): string[] {
  if (product === "fleet_operations") {
    return ["Dispatch board", "Truck planning", "Partner work", "Route packs", "Trip documents"]
  }

  if (product === "landing_operations") {
    return ["Private opportunities", "Live board", "Carrier network", "Route briefings", "Capacity planning"]
  }

  return ["Verified access", "Team seats", "Support"]
}

export interface PricingPlan {
  name: string
  price: string
  audience: string
  summary: string
  included?: string
  overage?: string
  commitment?: string
  features: string[]
  cta: {
    href: string
    label: string
  }
  note?: string
}

export const pricingPlans: PricingPlan[] = [
  {
    name: "Driver",
    price: "Free forever",
    audience: "Owner-operators and company drivers",
    summary: "Find, request, schedule, and complete work without paying LogLoads.",
    features: ["Loads ranked for your truck", "Plain-language match checks", "Request and booking status", "Mobile schedule and haul steps"],
    cta: { href: "/sign-up", label: "Create free account" }
  },
  {
    name: "Dispatch Pro",
    price: "$499/mo",
    audience: "Fleets and dispatch teams",
    summary: "Private-fleet software for the trucks, drivers, and partner capacity your organization already coordinates.",
    included: "No LogLoads Network units",
    overage: "No Network usage billing",
    commitment: "Monthly software subscription",
    features: ["Free driver seats", "Truck and driver planning", "Dispatch board and schedule", "Private partner work"],
    cta: { href: "/sign-up?path=fleet", label: "Set up dispatch" },
    note: "Dispatch Pro does not include Network-sourced capacity."
  },
  {
    name: "Network 25",
    price: "$3,000/mo",
    audience: "Hosts building a repeat Network lane",
    summary: "Network access, qualified-capacity workflow, field execution, and core Dispatch Pro coordination in one plan.",
    included: "25 completed Network loads/month",
    overage: "$125 per additional completion",
    commitment: "12 months, billed monthly · $36,000 base commitment",
    features: ["No charge to post", "Automatic overage without stopping work", "Private-fleet work is not metered", "Usage and invoice breakdown"],
    cta: { href: "/contact?plan=network-25", label: "Talk through Network 25" },
    note: "$120 effective included rate at full allowance utilization. Sales-assisted enrollment."
  },
  {
    name: "Network 50",
    price: "$5,500/mo",
    audience: "Established multi-lane Network operations",
    summary: "A larger monthly allowance with the same completed-movement definition and uninterrupted overage path.",
    included: "50 completed Network loads/month",
    overage: "$110 per additional completion",
    commitment: "12 months, billed monthly · $66,000 base commitment",
    features: ["Core Dispatch Pro workflow included", "70%, 90%, and 100% usage alerts", "Plan-change scheduling", "Provider-reconciled invoices"],
    cta: { href: "/contact?plan=network-50", label: "Talk through Network 50" },
    note: "$110 effective included rate at full allowance utilization. Sales-assisted enrollment."
  },
  {
    name: "Network 100",
    price: "$10,000/mo",
    audience: "High-volume Network operations",
    summary: "Production-scale completed-load allowance with contract-defined operating locations and support.",
    included: "100 completed Network loads/month",
    overage: "$90 per additional completion",
    commitment: "12 months, billed monthly · $120,000 base commitment",
    features: ["Core Dispatch Pro workflow included", "Audited adjustments and reversals", "Supplemental late-usage invoices", "Custom operating review"],
    cta: { href: "/contact?plan=network-100", label: "Talk through Network 100" },
    note: "$100 effective included rate at full allowance utilization. Sales-assisted enrollment."
  },
  {
    name: "Enterprise custom",
    price: "Custom",
    audience: "250+ completed Network loads or contract-specific operations",
    summary: "Negotiated allowance, overage, locations, integrations, and service obligations—never an unlimited-load promise.",
    included: "Contract-defined completed Network loads",
    overage: "Negotiated volume rate",
    commitment: "Negotiated annual commitment",
    features: ["Defined operating locations", "Contract-dependent integrations", "Custom allowance and rate snapshot", "Named activation and support obligations"],
    cta: { href: "/contact?plan=enterprise", label: "Design an Enterprise agreement" },
    note: "Every custom term is frozen into the accepted agreement and billing-period snapshot."
  }
]

export const storyPages: Record<string, PublicStoryPage> = {
  "how-it-works": {
    slug: "how-it-works",
    eyebrow: "How it works",
    title: "Plan the haul. Commit the truck. Keep the move connected.",
    intro: "One haul on LogLoads goes from posted work to delivery proof without living in three phones and a notebook.",
    sections: [
      {
        title: "Post the work",
        body: "A landing or timber operation posts what needs to move: how many loads, the schedule, the equipment it takes, and who gets to see it.",
        points: ["Keep it inside your carrier circle", "Open it to verified carriers in the region", "Or post it for everyone"]
      },
      {
        title: "Match and commit",
        body: "Drivers and fleets see the work that fits the truck and trailer they actually run — with the reasons why — before anyone commits.",
        points: ["Fit shown with plain reasons", "Capacity reserved when a request is approved", "Terms recorded on the assignment"]
      },
      {
        title: "Haul and confirm",
        body: "The assignment unlocks the Route Pack — gate access, road notes, who to call — and the trip carries its own status and paperwork.",
        points: ["Exact access after assignment, not before", "Live trip status everyone can see", "Scale tickets and photos stay on the record"]
      }
    ],
    cta: { href: "/loads", label: "See current loads" }
  },
  "for-haulers": {
    slug: "for-haulers",
    eyebrow: "For haulers",
    title: "Find timber work that fits the truck you actually run.",
    intro: "Open the app in the morning and see today's haul, the next action, and loads worth requesting — built for a phone in a truck cab.",
    sections: [
      { title: "Start with your equipment", body: "Add your truck and trailer once. Every load you see after that is measured against what you can really haul.", points: ["Long log, chip, and bunk setups", "Self-loader support", "Payload limits respected"] },
      { title: "Know what unlocks when", body: "Public loads show the general area and the work. When you are assigned, the exact entrance, road notes, and contact unlock.", points: ["Exact access after assignment", "Private road notes", "Destination check-in details"] },
      { title: "Keep the record", body: "Trip status, scale tickets, and photos stay attached to the haul instead of getting lost in calls and texts.", points: ["Scale tickets", "Field photos", "Delay history that protects you"] }
    ],
    cta: { href: "/sign-up?path=driver", label: "Create a driver profile" }
  },
  "for-fleets": {
    slug: "for-fleets",
    eyebrow: "For fleets",
    title: "Put idle trucks to work without losing dispatch control.",
    intro: "See which trucks are free, which work fits them, and where the exceptions are — on one board.",
    sections: [
      { title: "Truck-first dispatch", body: "Plan by the real truck-and-trailer combinations in your yard, and assign the driver who runs them.", points: ["Truck and trailer pairing", "Driver assignment", "Availability windows"] },
      { title: "Partner work", body: "Show selected availability to hosts you trust and take direct offers when they need trucks.", points: ["Private relationships", "Future availability", "Direct offers"] },
      { title: "Exceptions stay visible", body: "Delays, route changes, and paperwork sit on the trip itself, so dispatch can step in before a problem grows.", points: ["Live trip state", "Route change notices", "Documents on the record"] }
    ],
    cta: { href: "/sign-up?path=fleet", label: "Set up your fleet" }
  },
  "for-landings": {
    slug: "for-landings",
    eyebrow: "For landing and logging teams",
    title: "Know exactly how many trucks you still need.",
    intro: "Post the timber that has to move, decide who sees it, and watch the board as trucks commit, arrive, load, and roll.",
    sections: [
      { title: "Publish with control", body: "Set the schedule, equipment, pay, and visibility before the work goes live. Approve requests yourself or let capacity fill.", points: ["Private carrier circle", "Manual approval when you want it", "Reusable load setups"] },
      { title: "Run the landing", body: "The live board shows who is expected, who is arriving, who is loading, and who is late — without a phone call.", points: ["Truck identity at the gate", "Trip status as it changes", "Issues flagged, not buried"] },
      { title: "Keep good carriers close", body: "Invite the haulers you already work with, share your future schedule, and send direct offers when it matters.", points: ["Preferred carriers", "Shared forward schedule", "Direct offers"] }
    ],
    cta: { href: "/sign-up?path=host", label: "Publish your first load" }
  },
  about: {
    slug: "about",
    eyebrow: "About",
    title: "Built for the field reality of timber hauling.",
    intro: "Timber hauling runs on landings that move, private roads, tight loaders, and weather. LogLoads is built around that reality — not a generic freight board with trees on it.",
    sections: [
      { title: "Field-first", body: "The product starts with today's haul and the next decision: where the truck is, what happens next, and what changed.", points: ["Driver tools that work on a phone at the landing", "Dispatch boards for the office", "A live board for the landing"] },
      { title: "Trust with context", body: "Verification on LogLoads shows what was actually reviewed and where the information came from — never just a badge.", points: ["Identity", "Organization", "Equipment", "Landing authorization"] },
      { title: "More than a load board", body: "An assignment is not an introduction. It carries the Route Pack, live status, documents, and the history that makes the next haul easier.", points: ["Commitments on the record", "Repeat work with the same people", "History you can point to"] }
    ],
    cta: { href: "/how-it-works", label: "See how a haul runs" }
  },
  trust: {
    slug: "trust",
    eyebrow: "Trust",
    title: "Trust is shown with evidence, not a magic badge.",
    intro: "Before you commit a truck or open a gate, you can see why a carrier, organization, truck, or landing earned its status.",
    sections: [
      { title: "Reviewed information", body: "Verification records keep self-reported details separate from what platform review actually checked. Verification is context, not a carrier, route, or performance guarantee.", points: ["Carrier information", "Equipment", "Landing authorization"] },
      { title: "Controlled release", body: "Gate access, exact locations, and contact details unlock only when someone has accepted work that needs them.", points: ["Approximate areas in public", "Exact access after assignment", "Trip location shared with trip participants only"] },
      { title: "Moderation", body: "Reports and suspicious marketplace behavior go to human review. Legitimate field calls are never the problem.", points: ["Human review", "Abuse reports", "Blocked organizations stay blocked"] }
    ],
    cta: { href: "/marketplace-rules", label: "Read marketplace rules" }
  }
}

export const legalPages: Record<string, LegalPageContent> = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    intro: "These Terms of Service govern your use of LogLoads. By creating an account or using the service, you agree to them.",
    effectiveDate: "July 28, 2026",
    sections: [
      { title: "What LogLoads is", body: "LogLoads provides software for discovering, coordinating, and recording timber hauling work. Dispatch Pro covers established private capacity. LogLoads Network is activated only under a separate accepted commercial agreement and the operating posture stated in that agreement. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.", points: ["Participants remain responsible for their own regulatory compliance", "Assignments record the coordination terms both sides accepted", "The legally identified carrier, owner-operator, or private-fleet payee is paid directly by the host"] },
      { title: "Network subscriptions and completed usage", body: "A Network subscription bills its fixed base in advance regardless of utilization. One completed physical movement fulfilled through LogLoads Network counts as one usage unit; private-fleet work, drafts, postings, searches, unaccepted offers, cancellation before execution, and duplicate completion do not. Additional completed units are billed at the frozen overage rate after the applicable allowance window closes.", points: ["The accepted agreement states the minimum commitment and total base commitment", "The Pilot pools thirty units across an exact 90-day operating window", "Larger plans reset their allowance on the Stripe subscription anniversary with no advertised rollover", "Reaching an allowance does not interrupt accepted or in-progress work"] },
      { title: "Enrollment, renewal, and plan changes", body: "Network enrollment is sales-assisted. Before collection, an authorized organization representative must accept the exact plan snapshot, commitment dates, renewal behavior, completed-unit definition, automatic overage, dispute process, and payment method. A plan change applies only at its scheduled boundary and never retroactively reprices a closed period.", points: ["The public pricing page does not itself enroll an organization", "Downgrades and non-renewal follow the accepted commitment", "Billing disputes use audited adjustments rather than deleting historical usage"] },
      { title: "Your responsibilities", body: "You are responsible for the accuracy of what you publish and for operating safely and lawfully: weight compliance, cargo securement, insurance, permits, operating authority, and road use.", points: ["Do not publish capacity or work that does not exist", "Do not misuse access instructions released to you", "Keep your equipment, insurance, and account details current"] },
      { title: "No guarantees", body: "LogLoads does not guarantee the quality or conduct of any carrier or host, the legality or condition of any route, the accuracy of posted weights, destination acceptance, or that you will be paid for work arranged through coordination on the platform.", points: ["Use your professional judgment on every haul", "Verify field conditions before committing equipment", "Raise problems early through messages, notices, or reports"] },
      { title: "Independent businesses and limits on liability", body: "Every participant is an independent business. Nothing on LogLoads creates an employment, agency, joint-venture, or partnership relationship between you and LogLoads or between you and another participant. Disputes about hauls, payment, damage, or delay are between the participants; we can provide the assignment record but we are not a party to the haul. To the fullest extent the law allows, LogLoads' total liability for any claim related to the service is limited to the subscription fees you paid us in the twelve months before the claim, and we are not liable for indirect, incidental, or consequential losses, including lost loads, lost revenue, equipment damage, or downtime.", points: ["Participants contract with each other, not with LogLoads", "Assignment records are available to both sides of a dispute", "Liability is capped at twelve months of subscription fees"] },
      { title: "Accounts and enforcement", body: "We may suspend or close accounts that violate these terms, the Marketplace Rules, or the Acceptable Use Policy. We may update these terms; continued use after an update is acceptance of the revised terms.", points: ["Material changes are announced in the product", "You may close your account at any time", "Some records are retained after closure as described in the Privacy Policy"] }
    ]
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    intro: "This policy describes what LogLoads collects, how it is used, and how sensitive operational information is limited. LogLoads is operated by AutomatedEmpires, which is responsible for the data described here.",
    effectiveDate: "July 6, 2026",
    sections: [
      { title: "What we collect and why", body: "Account details, equipment information, loads, assignments, route instructions, trip events, messages, documents, and notices are collected and used to run the coordination workflow you signed up for.", points: ["Public load listings show approximate areas, not exact access", "Exact access details are released only to assigned participants", "We do not sell your information"] },
      { title: "Location", body: "Driver location is shared only with participants of an active trip, and only for the period needed to coordinate that haul.", points: ["Never public", "Visible to trip participants while the trip is active", "Sharing ends when the trip ends"] },
      { title: "Retention", body: "Assignment records, documents, and activity history are retained to support operations, safety review, dispute resolution, and account administration.", points: ["You can request a review of your account data", "Legal holds may extend retention", "Security logs are kept to protect the service"] },
      { title: "Contact", body: "Questions about this policy or your data can be sent through the contact page. We read every message.", points: ["Requests are handled by a person", "We confirm identity before releasing account data", "Corrections are applied to the operating record, not silently overwritten"] }
    ]
  },
  "marketplace-rules": {
    slug: "marketplace-rules",
    title: "Marketplace Rules",
    intro: "These rules keep work found on LogLoads on the record, so every haul is safer and easier to run for both sides.",
    effectiveDate: "July 6, 2026",
    sections: [
      { title: "Commit through LogLoads", body: "If you found the load, the carrier, or the host on LogLoads, record the commitment on the platform before exchanging full operational instructions.", points: ["Request capacity on the load", "Host approves the request", "The assignment carries the terms and unlocks access"] },
      { title: "Calls are part of the job", body: "Phone calls and face-to-face coordination are legitimate and expected. What is not allowed is using calls or messages to move platform-sourced work off the record.", points: ["Call whenever safety or logistics demand it", "Record the commitment on the assignment", "Keep tickets and photos attached to the trip"] },
      { title: "Respect private information", body: "Do not scrape, republish, or misuse private landing access, contact details, carrier information, or trip information released to you for a specific haul.", points: ["Access details are for the assigned haul only", "No harvesting contact lists", "Report abuse when you see it"] },
      { title: "Keeping it fair", body: "Moving platform-sourced recurring work off the record to avoid the platform is unfair to the participants who keep their commitments recorded. If a pattern of it shows up in reports or records, we review it with a person, and it can lead to feature limits, loss of network visibility, or account review. Ordinary calls and field coordination never trigger this — only the deliberate removal of platform-sourced commitments from the record.", points: ["Recorded commitments protect both sides when something goes wrong", "A person reviews before any enforcement happens", "Legitimate phone and field coordination is never penalized"] }
    ]
  },
  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    intro: "LogLoads is for lawful timber hauling coordination and respectful operational communication. This policy sets the floor.",
    effectiveDate: "July 6, 2026",
    sections: [
      { title: "Prohibited behavior", body: "Do not use the service for fraud, harassment, unauthorized access, spam, safety misinformation, or illegal transport activity.", points: ["No fake loads or fake capacity", "No false verification evidence", "No abusive or threatening messages"] },
      { title: "Operational safety", body: "Do not publish directions, road conditions, load weights, or equipment requirements you know are inaccurate or unsafe.", points: ["Update conditions when they change", "Flag restrictions that affect trucks", "Use notices for changes that affect active hauls"] },
      { title: "Review and enforcement", body: "Reports are reviewed by platform staff. Enforcement can include content removal, feature limits, suspension, or account closure, depending on severity.", points: ["A person reviews reports", "Appeals are available where appropriate", "Safety issues are acted on first"] }
    ]
  }
}
