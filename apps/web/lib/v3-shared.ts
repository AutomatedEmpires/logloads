import { landingPlanCards, type LandingPlanCardFacts } from "@logloads/contracts"

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

// The legal pages' text and types are in ./legal (#329); superseded versions are in ./legal-archive.

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
    body: "Free for haulers and fleets. Finding work, listing your trucks and messaging landings will not cost you anything. Add your operating area and main equipment, then finish the required records before requesting work.",
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

  // Shown on the public load page. The gate is the viewer organization's business identity review, so the label says
  // that rather than calling the load or its network verified (legal review §7.3 item 1, #428).
  if (load.visibilityMode === "verified_network") {
    return "Identity-reviewed carriers only"
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

/**
 * The footer of a host's landing card. `lastSavedAt` is the landing details' `lastVerifiedAt`, which is only the time
 * the host last saved the briefing (services/host-workspace). Nobody checked it, so the card says "saved" (#448).
 */
export function landingDetailsSavedLabel(lastSavedAt: string | null): string {
  return lastSavedAt ? `Details saved ${formatDateTime(lastSavedAt)}` : "No briefing saved yet"
}

/**
 * The hint under "Business identity" on the fleet and host settings pages. The limit is on this review, not on
 * LogLoads: the options beside it ("Carrier authority", "Insurance") name records a LogLoads reviewer does look at
 * (#448). What a reviewed authority or insurance record may claim is a question for counsel (legal review §7.3 item 6).
 */
export const BUSINESS_IDENTITY_REVIEW_HINT =
  "LogLoads reviews the business identity details you send and records the date. This identity review does not cover insurance, authority or safety."

export function userPlanFeatures(product: string): string[] {
  if (product === "fleet_operations") {
    return ["Dispatch board", "Truck planning", "Partner work", "Route packs", "Trip documents"]
  }

  if (product === "landing_operations") {
    return ["Private opportunities", "Live board", "Carrier network", "Route briefings", "Capacity planning"]
  }

  return ["Workspace access", "Team seats", "Support"]
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
    name: "Hauler",
    price: "Free",
    audience: "Haulers",
    summary: "Find hauling work, list your trucks and availability, and message landings. No card and no paywall.",
    features: ["Find hauling work", "List your trucks and availability", "Message landings"],
    cta: { href: "/sign-up?path=driver", label: "Create hauler profile" }
  },
  {
    name: "Fleet",
    price: "Free",
    audience: "Fleets",
    summary: "The same tools for a hauling business with more than one truck. No subscription and no truck limit.",
    features: ["More than one truck", "No subscription", "No truck limit"],
    cta: { href: "/sign-up?path=fleet", label: "Create fleet profile" }
  }
]

const PLAN_POSTS = "Unlimited job posts, inquiries and replies."

export interface PublicFreePricingCard {
  name: "Hauler" | "Fleet"
  price: "Free"
  summary: string
  cta: { href: string; label: string }
}

export interface PublicLandingPlanCard {
  activeLandings: string
  caveats: string
  invitations: string
  name: string
  positioning: string
  posts: string
  price: string
  tag: "Not for sale yet"
  teamMembers: string
}

export interface PublicPricingCopy {
  body: string
  description: string
  eyebrow: "Pricing"
  freeCards: [PublicFreePricingCard, PublicFreePricingCard]
  homeBand: string
  invitationNote: string
  landingAction: { href: string; label: string }
  planCards: PublicLandingPlanCard[]
  /** Sits in the same not-for-sale band as the status line. */
  priceCaveats: string
  status: string
  title: "Haulers and fleets are free."
}

function requireThreePlans(plans: LandingPlanCardFacts[]): [LandingPlanCardFacts, LandingPlanCardFacts, LandingPlanCardFacts] {
  const [basic, pro, regional] = plans
  if (plans.length !== 3 || !basic || !pro || !regional) {
    throw new Error("LANDING_PLANS must stay Basic, Pro, Regional.")
  }

  return [basic, pro, regional]
}

/** November 2026 legal review §10 Q1. These sit with every public price. */
const PRICE_CAVEATS =
  "Prices and plan features can change before plans go on sale. Plan features are planned and are not all available yet."

function publicMonthlyPrice(price: string): string {
  return `${price}, plus applicable taxes`
}

function namedPublicPrices(
  plans: [LandingPlanCardFacts, LandingPlanCardFacts, LandingPlanCardFacts],
  lastJoin: "and" | "comma"
): string {
  const priced = plans.map((plan) => `${plan.name} ${publicMonthlyPrice(plan.price)}`)
  const [basic, pro, regional] = priced
  if (!basic || !pro || !regional) {
    throw new Error("LANDING_PLANS must stay Basic, Pro, Regional.")
  }

  return lastJoin === "and" ? `${basic}, ${pro} and ${regional}` : `${basic}, ${pro}, ${regional}`
}

/** Public pricing strings. Dollar amounts come from `landingPlanCards()`, never from a page literal. */
export function pricingPageCopy(): PublicPricingCopy {
  const plans = requireThreePlans(landingPlanCards())
  const [hauler, fleet] = pricingPlans
  if (!hauler || !fleet) {
    throw new Error("The free public pricing cards are incomplete.")
  }

  const sentencePrices = namedPublicPrices(plans, "and")
  const bandPrices = namedPublicPrices(plans, "comma")

  return {
    body: `Landing plans are ${sentencePrices}. They are not for sale yet. ${PRICE_CAVEATS} LogLoads charges no per-load, percentage or transaction fees, and takes nothing from driver pay.`,
    description: `LogLoads is a timber-hauling load board. Haulers and fleets use it free. Landing plans are ${sentencePrices}. They are not for sale yet. ${PRICE_CAVEATS}`,
    eyebrow: "Pricing",
    freeCards: [
      { cta: hauler.cta, name: "Hauler", price: "Free", summary: hauler.summary },
      { cta: fleet.cta, name: "Fleet", price: "Free", summary: fleet.summary }
    ],
    homeBand: `Haulers and fleets are free. Landing plans, not for sale yet: ${bandPrices}. ${PRICE_CAVEATS}`,
    invitationNote: "Invitations you do not send expire at the reset. They do not roll over. Sponsored placement is not offered yet.",
    landingAction: { href: "/sign-up?path=host", label: "Create a landing profile" },
    planCards: plans.map((plan) => ({
      activeLandings: plan.activeLandings,
      caveats: PRICE_CAVEATS,
      invitations: plan.invitations,
      name: plan.name,
      positioning: plan.positioning,
      posts: PLAN_POSTS,
      price: publicMonthlyPrice(plan.price),
      tag: "Not for sale yet",
      teamMembers: plan.teamMembers
    })),
    priceCaveats: PRICE_CAVEATS,
    status: "Billing is not open. Nothing on this page charges you, and creating an account does not start a charge. Plan terms will be published before any plan is sold.",
    title: "Haulers and fleets are free."
  }
}

export interface ForLandingsPlanAllowance {
  activeLandings: string
  invitations: string
  name: string
  teamMembers: string
}

/** Plan names and allowances for /for-landings. Prices stay on /pricing. */
export function forLandingsPlanAllowances(): ForLandingsPlanAllowance[] {
  return landingPlanCards().map((plan) => ({
    activeLandings: plan.activeLandings,
    invitations: plan.invitations,
    name: plan.name,
    teamMembers: plan.teamMembers
  }))
}

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
        points: ["Keep it inside your carrier circle", "Open it to identity-reviewed carriers in the region", "Or post it for everyone"]
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
    cta: { href: "/posting-rules", label: "Read the Posting Rules" }
  }
}
