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

export type PublicSignUpIntent = "driver" | "fleet" | "host"

export interface PublicSignUpCopy {
  body: string
  eyebrow: string
  intentLabel: string | null
  title: string
}

const DEFAULT_SIGN_UP_COPY: PublicSignUpCopy = {
  body: "Tell us how you work and LogLoads sets up the right first screen.",
  eyebrow: "Create account",
  intentLabel: null,
  title: "Start with the work you do."
}

const SIGN_UP_COPY_BY_INTENT: Record<PublicSignUpIntent, PublicSignUpCopy> = {
  driver: {
    body: "Drivers use LogLoads free forever. Add your operating area and main equipment, then finish the required records before requesting work.",
    eyebrow: "Driver account",
    intentLabel: "Driver profile",
    title: "Create your driver profile."
  },
  fleet: {
    body: "Create a free workspace for trucks, drivers, availability, and dispatch. There is no subscription, trial clock, or LogLoads truck limit.",
    eyebrow: "Fleet Free",
    intentLabel: "Fleet workspace",
    title: "Set up dispatch for your fleet."
  },
  host: {
    body: "Create a free workspace to prepare landings and timber work. Live publication still requires separate pilot approval, the current 5% agreement, and a card in Billing.",
    eyebrow: "Host workspace",
    intentLabel: "Host workspace",
    title: "Prepare your timber operation."
  }
}

export function publicSignUpCopy(intent?: PublicSignUpIntent | null): PublicSignUpCopy {
  return intent ? SIGN_UP_COPY_BY_INTENT[intent] : DEFAULT_SIGN_UP_COPY
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
    cta: { href: "/sign-up?path=driver", label: "Create driver profile" }
  },
  {
    name: "Fleet Free",
    price: "Free",
    audience: "Fleets and dispatch teams",
    summary: "Run dispatch, equipment, drivers, and private partner work without a LogLoads subscription.",
    included: "Dispatch board, truck planning, driver seats, and private partner work",
    overage: "None",
    commitment: "No subscription, trial clock, or LogLoads truck limit",
    features: ["Dispatch board", "Truck and equipment planning", "Driver seats", "Private partner work"],
    cta: { href: "/sign-up?path=fleet", label: "Create fleet workspace" },
    note: "Hosts—not fleets or drivers—owe the 5% platform fee when host-posted work completes."
  },
  {
    name: "Host",
    price: "5% per completed load",
    audience: "Landings, mills, and timber operations",
    summary: "State what the load pays the driver. LogLoads adds a 5% platform fee to the host's cost when the load completes.",
    included: "Posting, matching, coordination, and load records",
    overage: "None",
    commitment: "No subscription or monthly minimum",
    features: ["No charge to post", "No tiers or allowances", "Itemized monthly fee invoices", "Driver pay remains direct and whole"],
    cta: { href: "/sign-up?path=host", label: "Create host workspace" },
    note: "Workspace setup is free. Live publication requires separate pilot approval; creating an account does not activate billing. Example after approval: $500 driver pay + $25 LogLoads fee = $525 total host cost."
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
        points: ["Exact access after assignment, not before", "Live trip status shared with assigned participants", "Scale tickets and photos stay on the record"]
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
    intro: "Create a free workspace for landings, lanes, schedules, equipment, and driver pay. Live network publication is available only after separate pilot approval.",
    sections: [
      { title: "Prepare with control", body: "Set the schedule, equipment, pay, and visibility in a draft before work goes live. Publishing remains locked until the exact pilot organization is approved.", points: ["Private carrier circle", "Manual approval when you want it", "Reusable load setups"] },
      { title: "Run the landing", body: "The live board shows who is expected, who is arriving, who is loading, and who is late — without a phone call.", points: ["Truck identity at the gate", "Trip status as it changes", "Issues flagged, not buried"] },
      { title: "Keep good carriers close", body: "Invite the haulers you already work with, share your future schedule, and send direct offers when it matters.", points: ["Preferred carriers", "Shared forward schedule", "Direct offers"] }
    ],
    cta: { href: "/sign-up?path=host", label: "Create a host workspace" }
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
    effectiveDate: "August 3, 2026",
    sections: [
      { title: "What LogLoads is", body: "LogLoads provides software for discovering, coordinating, and recording timber hauling work. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.", points: ["Participants remain responsible for their own regulatory compliance", "Assignments record the coordination terms both sides accepted", "The legally identified carrier, owner-operator, or private-fleet payee is paid directly by the host"] },
      { title: "Host platform fee", body: "For each completed load, the host owes LogLoads a platform fee equal to 5% of the driver pay the host stated for that load. The fee is added to the host's cost and is never deducted from driver pay or carrier compensation. LogLoads bills its own fees monthly in arrears to the host's payment method.", points: ["A $500 load means $500 paid directly to the driver plus a $25 LogLoads fee", "There is no charge to post, subscription, monthly minimum, tier, allowance, or overage rate", "Cancelled, unaccepted, or uncompleted work does not create a platform fee"] },
      { title: "Agreement and payment method", body: "Before publishing live work, an authorized host representative must accept the current percentage agreement and attach a valid payment method. Attaching a card or accepting the agreement does not itself create a charge.", points: ["The accepted terms freeze the fee rate, currency, and billing cadence", "Itemized invoices identify the completed loads that produced each fee", "Billing disputes use audited corrections rather than deleting historical records"] },
      { title: "Your responsibilities", body: "You are responsible for the accuracy of what you publish and for operating safely and lawfully: weight compliance, cargo securement, insurance, permits, operating authority, and road use.", points: ["Do not publish capacity or work that does not exist", "Do not misuse access instructions released to you", "Keep your equipment, insurance, and account details current"] },
      { title: "No guarantees", body: "LogLoads does not guarantee the quality or conduct of any carrier or host, the legality or condition of any route, the accuracy of posted weights, destination acceptance, or that you will be paid for work arranged through coordination on the platform.", points: ["Use your professional judgment on every haul", "Verify field conditions before committing equipment", "Raise problems early through messages, notices, or reports"] },
      { title: "Independent businesses and limits on liability", body: "Every participant is an independent business. Nothing on LogLoads creates an employment, agency, joint-venture, or partnership relationship between you and LogLoads or between you and another participant. Disputes about hauls, payment, damage, or delay are between the participants; we can provide the assignment record but we are not a party to the haul. To the fullest extent the law allows, LogLoads' total liability for any claim related to the service is limited to the platform fees you paid us in the twelve months before the claim, and we are not liable for indirect, incidental, or consequential losses, including lost loads, lost revenue, equipment damage, or downtime.", points: ["Participants contract with each other, not with LogLoads", "Assignment records are available to both sides of a dispute", "Liability is capped at twelve months of LogLoads platform fees"] },
      { title: "Accounts and enforcement", body: "We may suspend or close accounts that violate these terms, the Marketplace Rules, or the Acceptable Use Policy. We may update these terms; continued use after an update is acceptance of the revised terms.", points: ["Material changes are announced in the product", "You may close your account at any time", "Some records are retained after closure as described in the Privacy Policy"] }
    ]
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    intro: "This policy describes what LogLoads collects, how it is used, and how sensitive operational information is limited. LogLoads is operated by AutomatedEmpires, which is responsible for the data described here.",
    effectiveDate: "August 3, 2026",
    sections: [
      { title: "What we collect and why", body: "Account details, equipment information, loads, assignments, route instructions, trip events, messages, documents, notices, accepted fee agreements, completed-load fee records, invoices, and billing audit events are collected and used to run, secure, and account for the service.", points: ["Public load listings show approximate areas, not exact access", "Exact access details are released only to assigned participants", "We do not sell your information"] },
      { title: "Billing and service providers", body: "Stripe processes host payment methods and LogLoads platform-fee collections. LogLoads stores provider customer and payment-method references, status, invoice history, and reconciliation records, but does not store full card numbers. We also use infrastructure, storage, email, analytics, and error-monitoring providers only as needed to operate and protect LogLoads.", points: ["Billing records support itemization, collection, disputes, accounting, and fraud prevention", "Supabase Storage is the sole active private-media store", "Provider access is limited to the service each provider performs"] },
      { title: "Location", body: "Driver location is shared only with participants of an active trip, and only for the period needed to coordinate that haul.", points: ["Never public", "Visible to trip participants while the trip is active", "Sharing ends when the trip ends"] },
      { title: "Retention", body: "Assignment records, documents, fee agreements, invoices, billing audit history, and activity records are retained as needed for operations, safety review, dispute resolution, accounting, tax, fraud prevention, legal obligations, and account administration.", points: ["You can request a review of your account data", "Legal or financial recordkeeping duties may extend retention", "Security logs are kept to protect the service"] },
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
