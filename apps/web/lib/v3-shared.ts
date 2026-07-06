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
}

export interface LegalPageContent {
  slug: string
  title: string
  intro: string
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

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC"
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

export const pricingPlans = [
  {
    name: "Driver",
    price: "Free",
    audience: "Owner-operators and company drivers",
    features: ["Find loads that fit", "Route Pack access after assignment", "Trip proof", "Availability updates"],
    href: "/sign-up"
  },
  {
    name: "Fleet",
    price: "From $149/mo",
    audience: "Carriers and dispatch teams",
    features: ["Active truck planning", "Dispatch board", "Private network work", "Advanced availability"],
    href: "/for-fleets"
  },
  {
    name: "Host",
    price: "From $249/mo",
    audience: "Landings and timber organizations",
    features: ["Opportunity publishing", "Live board", "Preferred carrier tools", "Capacity analytics"],
    href: "/for-landings"
  },
  {
    name: "Enterprise",
    price: "Custom",
    audience: "Multi-region timber operations",
    features: ["Private regions", "API planning", "Verification workflows", "Dedicated support"],
    href: "/contact"
  }
]

export const storyPages: Record<string, PublicStoryPage> = {
  "how-it-works": {
    slug: "how-it-works",
    eyebrow: "How it works",
    title: "Plan the haul, commit capacity, keep the move connected.",
    intro: "LogLoads turns timber hauling into a shared operating record from first capacity request through delivery proof.",
    sections: [
      {
        title: "Plan and publish",
        body: "Hosts create work with capacity, schedule, access, equipment, terms, and visibility controls.",
        points: ["Private partner work", "Verified regional work", "Open network discovery"]
      },
      {
        title: "Match and commit",
        body: "Drivers and fleets see work that fits their active equipment before they request capacity.",
        points: ["Fit explanations", "Capacity reservation", "Accepted terms snapshot"]
      },
      {
        title: "Coordinate and confirm",
        body: "Assignments unlock the operational package needed to haul safely and keep every party aligned.",
        points: ["Route Packs", "Live trip status", "Documents and history"]
      }
    ],
    cta: { href: "/loads", label: "See current loads" }
  },
  "for-haulers": {
    slug: "for-haulers",
    eyebrow: "For haulers",
    title: "Find timber work that fits the truck you actually run.",
    intro: "Owner-operators and drivers get a mobile cockpit for today, matching loads, equipment, trips, and proof.",
    sections: [
      { title: "Start with your equipment", body: "Add truck and trailer details once, then use them for matching and availability.", points: ["Long log", "Chip", "Bunk", "Self-loader support"] },
      { title: "Know what unlocks when", body: "Public loads show approximate areas. Assignments unlock entrance details and Route Packs.", points: ["Exact access after assignment", "Private road notes", "Destination check-in"] },
      { title: "Keep the record", body: "Trip status and documents stay attached to the assignment instead of getting lost in calls and texts.", points: ["Scale tickets", "Field photos", "Delay history"] }
    ],
    cta: { href: "/sign-up", label: "Start hauling" }
  },
  "for-fleets": {
    slug: "for-fleets",
    eyebrow: "For fleets",
    title: "Put idle timber capacity to work without losing dispatch control.",
    intro: "Fleet teams see available trucks, unassigned work, matching opportunities, and exceptions in one command surface.",
    sections: [
      { title: "Truck-first dispatch", body: "Plan by active equipment combinations, not generic capacity buckets.", points: ["Truck and trailer pairing", "Driver assignment", "Availability windows"] },
      { title: "Partner work", body: "Expose selected availability to trusted hosts and receive direct opportunities.", points: ["Private relationships", "Future availability", "Direct offers"] },
      { title: "Exceptions stay visible", body: "Delays, notices, and proof are tied to the move so dispatch can intervene quickly.", points: ["Trip state", "Route changes", "Document history"] }
    ],
    cta: { href: "/fleet/command", label: "Open fleet command" }
  },
  "for-landings": {
    slug: "for-landings",
    eyebrow: "For hosts",
    title: "Know exactly what capacity you still need.",
    intro: "Hosts publish timber movement, control who sees it, and run the live board as trucks commit, arrive, load, and depart.",
    sections: [
      { title: "Publish with control", body: "Set visibility, allocation, equipment, schedule, terms, and access release before work goes live.", points: ["Private network", "Manual approval", "Templates"] },
      { title: "Run the landing", body: "The live board shows expected, arriving, waiting, loading, departed, and exception states.", points: ["Truck identity", "ETA where grounded", "Issue handling"] },
      { title: "Keep good carriers close", body: "Invite existing haulers, share future schedules, and send direct offers when capacity matters.", points: ["Preferred carriers", "Trusted relationships", "Partner availability"] }
    ],
    cta: { href: "/host/command", label: "Open host command" }
  },
  about: {
    slug: "about",
    eyebrow: "About",
    title: "Built for the field reality of timber hauling.",
    intro: "LogLoads is designed around landings, private roads, timber equipment, live conditions, and the people who keep trucks moving.",
    sections: [
      { title: "Field-first", body: "The product starts with today's haul and the next operational decision.", points: ["Mobile driver cockpit", "Desktop dispatch surfaces", "Host live board"] },
      { title: "Trust with context", body: "Verification shows what was reviewed and where information came from.", points: ["Identity", "Organization", "Equipment", "Landing control"] },
      { title: "Software value", body: "Assignments unlock more than introductions: Route Packs, live boards, proof, notices, and repeat planning.", points: ["Commitment records", "Recurring work", "Operational history"] }
    ],
    cta: { href: "/how-it-works", label: "See the workflow" }
  },
  trust: {
    slug: "trust",
    eyebrow: "Trust",
    title: "Trust needs provenance, not a magic badge.",
    intro: "LogLoads shows why a participant, organization, truck, landing, or document can be trusted enough for the next step.",
    sections: [
      { title: "Reviewed information", body: "Verification records separate self-reported details from reviewed evidence.", points: ["Carrier information", "Equipment", "Landing authorization"] },
      { title: "Controlled release", body: "Sensitive access and contact details unlock only when they are needed to perform accepted work.", points: ["Approximate public areas", "Assignment-based exact access", "Trip participant location sharing"] },
      { title: "Moderation", body: "Reports and unusual marketplace behavior go to platform review without blocking legitimate field calls.", points: ["Human review", "Abuse reports", "Blocked organizations"] }
    ],
    cta: { href: "/marketplace-rules", label: "Read marketplace rules" }
  }
}

export const legalPages: Record<string, LegalPageContent> = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    intro: "These terms are a production-ready draft for legal review. They describe LogLoads coordination software and its current boundaries.",
    sections: [
      { title: "Service role", body: "LogLoads provides software for discovering, coordinating, and recording timber hauling work. LogLoads does not currently broker freight, carry freight, or collect freight payment through the product.", points: ["Participants remain responsible for compliance", "Assignments record accepted coordination terms", "Managed transaction mode is disabled"] },
      { title: "User responsibilities", body: "Users are responsible for accurate information, safe operation, weight compliance, cargo securement, insurance, permits, and lawful road use.", points: ["Do not publish false capacity", "Do not misuse access instructions", "Keep documents current"] },
      { title: "No unsupported guarantees", body: "LogLoads does not guarantee carrier quality, legal routes, road conditions, destination acceptance, payment, or insurance coverage.", points: ["Use professional judgment", "Verify field conditions", "Escalate issues early"] }
    ]
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    intro: "This draft explains how LogLoads limits sensitive operational information while still supporting real field coordination.",
    sections: [
      { title: "Operational data", body: "Loads, assignments, route instructions, trip events, messages, documents, and notices are used to provide the coordination workflow.", points: ["Approximate areas can be public", "Exact access is limited", "Trip location is purpose-based"] },
      { title: "Location", body: "Driver location should be shared only for active trip participants and only for the period needed to coordinate the haul.", points: ["Never public by default", "Visible to participants", "Ends after the trip"] },
      { title: "Retention", body: "Assignment records, documents, and history may be retained to support operations, safety review, disputes, and account administration.", points: ["Users can request account review", "Legal holds may apply", "Security logs protect the service"] }
    ]
  },
  "marketplace-rules": {
    slug: "marketplace-rules",
    title: "Marketplace Rules",
    intro: "The marketplace works when users keep platform-sourced commitments inside the workflow that makes the haul safer and easier to run.",
    sections: [
      { title: "Commit through LogLoads", body: "If a load, carrier, or host is discovered through LogLoads, use the platform assignment record before exchanging full operational instructions.", points: ["Capacity request", "Host acceptance", "Assignment ID"] },
      { title: "Operational calls are allowed", body: "Phone calls and field coordination are legitimate. Do not use calls or messages to avoid platform records for platform-sourced work.", points: ["Call for safety", "Record commitments", "Keep documents attached"] },
      { title: "Private information", body: "Do not scrape, republish, or misuse private landing access, contact details, carrier information, or trip information.", points: ["Respect access release", "No harvesting contact lists", "Report abuse"] }
    ]
  },
  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    intro: "Use LogLoads for lawful timber hauling coordination and respectful operational communication.",
    sections: [
      { title: "Prohibited behavior", body: "Do not use the service for fraud, harassment, unauthorized access, spam, safety misinformation, or illegal transport activity.", points: ["No fake loads", "No false verification evidence", "No abusive messages"] },
      { title: "Operational safety", body: "Do not publish directions, road conditions, load weights, or equipment requirements you know are inaccurate or unsafe.", points: ["Update conditions", "Flag restrictions", "Use notices for changes"] },
      { title: "Review and enforcement", body: "Reports may be reviewed by platform staff. Enforcement can include content removal, feature limits, suspension, or account closure.", points: ["Human review", "Appeals where appropriate", "Safety-first exceptions"] }
    ]
  }
}

