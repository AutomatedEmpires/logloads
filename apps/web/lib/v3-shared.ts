import { TERMS_2026_08_03_PATH } from "./legal-archive"
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

/** A dated notice that a legal page changed, shown above its sections. */
export interface LegalChangeNotice {
  date: string
  /** ISO form of `date`, for the `<time>` element. */
  dateTime: string
  body: string
  /** Where the replaced text can still be read. */
  link: {
    lead: string
    href: string
    label: string
  }
}

export interface LegalPageContent {
  slug: string
  title: string
  intro: string
  effectiveDate: string
  changeNotice?: LegalChangeNotice
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
    body: "Create a free workspace to prepare landings and timber work. Live publication still requires separate pilot approval.",
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
    summary: "Search hauling opportunities and express interest. Drivers use LogLoads free of charge.",
    features: ["Search open opportunities", "See pay and equipment", "Express interest", "No fee taken from driver pay"],
    cta: { href: "/sign-up?path=driver", label: "Create driver profile" }
  },
  {
    name: "Fleet Free",
    price: "Free",
    audience: "Hauling businesses and fleets",
    summary: "Keep trucks, drivers, equipment, and availability in one place and find work that fits your fleet, without a LogLoads subscription.",
    included: "Truck and equipment records, driver seats, availability, and private partner work",
    commitment: "No subscription, trial clock, or LogLoads truck limit",
    features: ["Truck and equipment records", "Driver seats", "Availability", "Private partner work"],
    cta: { href: "/sign-up?path=fleet", label: "Create fleet workspace" }
  },
  {
    name: "Host",
    price: "$149 / $299 / $499",
    audience: "Landing operators",
    summary: "Basic, Pro, and Regional memberships are the only landing prices. They are not available for purchase yet.",
    features: ["Basic $149, one active landing", "Pro $299, three active landings", "Regional $499", "Drivers and fleets stay free"],
    cta: { href: "/sign-up?path=host", label: "Create host workspace" },
    note: "Nothing on this page is for sale. Creating an account does not start a charge."
  }
]

export const storyPages: Record<string, PublicStoryPage> = {
  "how-it-works": {
    slug: "how-it-works",
    eyebrow: "How it works",
    title: "Publish the work. Find a truck. Arrange it directly.",
    intro: "LogLoads is a timber-hauling marketplace. Landing operators publish opportunities. Haulers and fleets find them, express interest, and arrange the haul themselves.",
    sections: [
      {
        title: "Publish an opportunity",
        body: "A landing operator describes the hauling work: pay and pay basis, equipment, origin area, destination, and when it starts.",
        points: ["Pay amount and pay basis", "Equipment the job needs", "Public area, not private access details"]
      },
      {
        title: "Discover work",
        body: "Drivers and fleets search open opportunities that fit the equipment they run. An empty area means no listings yet, not that the state is closed.",
        points: ["Search without an account where it is safe", "See the posting as the landing wrote it", "No guaranteed match"]
      },
      {
        title: "Express interest",
        body: "A hauler sends a short introduction with truck count, equipment, and dates. The landing replies. Private landing details stay private until the landing shares them.",
        points: ["Interest is not a booked haul", "The parties arrange the work directly", "LogLoads does not dispatch the trip"]
      }
    ],
    cta: { href: "/loads", label: "See current loads" }
  },
  "for-haulers": {
    slug: "for-haulers",
    eyebrow: "For haulers",
    title: "Find timber work that fits the truck you actually run.",
    intro: "Search open hauling opportunities, review the pay and equipment, and express interest. Drivers use LogLoads free of charge.",
    sections: [
      { title: "Start with your equipment", body: "Add the truck and trailer you run. Search results can be compared with that equipment.", points: ["Long log, chip, and bunk setups", "Self-loader support", "Your own availability"] },
      { title: "See the public job", body: "A listing shows pay, pay basis, and the public area. Expressing interest does not unlock private landing access.", points: ["Pay and pay basis", "Public area only", "Private details stay with the landing"] },
      { title: "Express interest", body: "Send a short introduction. The landing replies, and you arrange the haul directly.", points: ["Truck count and dates", "Not a booked trip", "No fee taken from driver pay"] }
    ],
    cta: { href: "/sign-up?path=driver", label: "Create a driver profile" }
  },
  "for-fleets": {
    slug: "for-fleets",
    eyebrow: "For fleets",
    title: "Show the trucks you can put to work.",
    intro: "A fleet is a hauling business with more than one truck. Fleets use LogLoads free of charge. There is no dispatch subscription.",
    sections: [
      { title: "List your equipment", body: "Record the truck and trailer combinations your business runs, and how many are available.", points: ["Several trucks on one business", "Self-reported availability", "Equipment the landing can read"] },
      { title: "Find fitting work", body: "Search the same opportunities as an independent hauler and express interest for the trucks you can offer.", points: ["Pay and equipment on the listing", "Interest for more than one truck", "No booked trip until you arrange it"] },
      { title: "Arrange it yourselves", body: "The landing replies to the business. LogLoads does not assign drivers, track the trip, or settle the haul.", points: ["Direct arrangement", "No trip tracking", "No deduction from hauler pay"] }
    ],
    cta: { href: "/sign-up?path=fleet", label: "Set up your fleet" }
  },
  "for-landings": {
    slug: "for-landings",
    eyebrow: "For landing and logging teams",
    title: "Publish the hauling work you need.",
    intro: "Landing operators are the paying customers. Memberships are Basic $149, Pro $299, and Regional $499 per month, and they are not available for purchase yet.",
    sections: [
      { title: "Describe the opportunity", body: "Record the landing, the pay and pay basis, the equipment, and when the work starts. A draft is not a live listing.", points: ["Pay amount and pay basis", "Equipment and dates", "Public area only"] },
      { title: "Review interest", body: "Haulers send a short introduction. You reply, decline, or ask for clarification. Interest is not a booked truck.", points: ["See the trucks offered", "Reply in the inquiry", "Arrange the haul directly"] },
      { title: "Keep private details private", body: "Gate instructions and exact access stay off the public listing until you choose to share them with a hauler.", points: ["Approximate public area", "Sharing is a separate action", "No dispatch board"] }
    ],
    cta: { href: "/sign-up?path=host", label: "Create a host workspace" }
  },
  about: {
    slug: "about",
    eyebrow: "About",
    title: "Built for the field reality of timber hauling.",
    intro: "LogLoads connects landing operators with haulers and fleets for timber hauling. The parties find each other here and arrange the haul themselves.",
    sections: [
      { title: "A marketplace", body: "Landings publish opportunities. Haulers and fleets discover them and express interest. LogLoads does not dispatch the trip or settle the pay.", points: ["Publish", "Discover", "Express interest"] },
      { title: "Trust with context", body: "Verification shows what was actually reviewed and where the information came from.", points: ["Identity", "Organization", "Equipment"] },
      { title: "Nationwide", body: "Hosts and haulers in supported US locations use the same marketplace. An area with no listings is empty, not closed.", points: ["No state-by-state launch", "No invented listings", "No guaranteed matches"] }
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
    changeNotice: {
      date: "November 2, 2026",
      dateTime: "2026-11-02",
      body: "The “Host platform fee” and “Agreement and payment method” sections were removed from these Terms because the per-load fee model was retired.",
      link: {
        lead: "For agreements accepted under the earlier version, read the",
        href: TERMS_2026_08_03_PATH,
        label: "archived Terms of Service effective August 3, 2026"
      }
    },
    sections: [
      { title: "What LogLoads is", body: "LogLoads provides software for discovering, coordinating, and recording timber hauling work. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.", points: ["Participants remain responsible for their own regulatory compliance", "Assignments record the coordination terms both sides accepted", "The legally identified carrier, owner-operator, or private-fleet payee is paid directly by the host"] },
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
