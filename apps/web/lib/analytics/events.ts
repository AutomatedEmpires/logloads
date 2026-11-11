import { z } from "zod"

import { findPersonalData, PSEUDONYMOUS_ID, type ProductPropertyValue } from "./privacy"

/**
 * LogLoads product events, version 1 (#286). They measure the five flows of the LogLoads strategy (logloads#235) and
 * feed the per-basin liquidity board. docs/analytics/event-plan.md says what each one means, when it fires and which
 * metric it feeds; this file is the contract the code enforces.
 *
 * Every property is an enum, a count, a duration, a public job id or a pseudonymous id made on the server. There is
 * no name, email address, phone number, message, title, place name, coordinate or other free text, and an event
 * with any undeclared key is refused. Version 1 stays fixed: a change of meaning gets a new version.
 */

export const PRODUCT_EVENT_VERSION = 1

/** The five flows (logloads#235, "The five flows and their targets"). */
export const PRODUCT_FLOWS = ["A", "B", "C", "D", "E"] as const
export type ProductFlow = (typeof PRODUCT_FLOWS)[number]

/** The flow step each `flow_timed` sample measures, from the flow's first screen to its outcome. */
export const FLOW_STEPS = {
  A: ["first_send"],
  B: ["published"],
  C: ["answered"],
  D: ["confirmed"],
  E: ["reconfirmed", "stopped"]
} as const satisfies Record<ProductFlow, readonly string[]>
export type FlowStep = (typeof FLOW_STEPS)[ProductFlow][number]
const ALL_FLOW_STEPS = [...new Set(Object.values(FLOW_STEPS).flat())] as [FlowStep, ...FlowStep[]]

/** Longest flow timing kept, one hour. A longer wait is sent as this value with `capped: true`. */
export const FLOW_TIMING_CAP_MS = 60 * 60_000
/** Most taps counted in one flow. */
export const FLOW_TAP_CAP = 99

/** Where a shared link was opened from. The share page (#287) decides how a link says it; absent is `unknown`. */
export const SHARE_CHANNELS = ["sms", "facebook", "copy_link", "other", "unknown"] as const
export type ShareChannel = (typeof SHARE_CHANNELS)[number]

/** How a confirmation arrived: in the signed-in app, or from a signed one-tap link in a text or email (P0-6). */
export const CONFIRMATION_ROUTES = ["in_app", "one_tap_link"] as const
export type ConfirmationRoute = (typeof CONFIRMATION_ROUTES)[number]

/** `postingFreshness` bands (packages/contracts), read just before the poster acted. */
export const FRESHNESS_BANDS = ["confirmed_recently", "confirmed_aging", "unconfirmed", "expired"] as const

/**
 * Marketplace enums the events carry, copied from packages/contracts so the browser half of this module does not pull
 * the contracts' marketplace schemas into page bundles (#217). events.test.ts fails if a copy drifts from its source.
 */
/** `MARKETPLACE_PRODUCTS`, as `productSlug` values. */
export const PRODUCT_SLUGS = ["saw_logs", "pulpwood", "poles_and_pilings", "chips", "hog_fuel_and_biomass", "hardwood_logs", "other"] as const
/** `marketplacePayUnitSchema`. */
export const PAY_UNITS = ["per_load", "per_ton", "per_mbf", "per_cord", "per_mile", "per_hour", "per_day", "flat_rate", "negotiable", "other"] as const
/** `marketplaceContactPreferenceSchema`. */
export const CONTACT_ROUTES = ["in_app", "phone", "email"] as const
/** `MARKETPLACE_JOB_STOP_STATUSES`. */
export const JOB_STOP_STATUSES = ["paused", "filled", "closed"] as const

export type ProductSlug = (typeof PRODUCT_SLUGS)[number]

/** A product label as an enum value: "Saw logs" is `saw_logs`. The poster's own "Other" description is never sent. */
export function productSlug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** The listed product's enum value, or `null` when there is none or the label is not on the list. */
export function productValue(label: string | null | undefined): ProductSlug | null {
  const slug = label ? productSlug(label) : ""
  return (PRODUCT_SLUGS as readonly string[]).includes(slug) ? (slug as ProductSlug) : null
}

const jobId = z.string().uuid()
const pseudonym = (kind: "u" | "o" | "i") =>
  z.string().regex(PSEUDONYMOUS_ID).refine((value) => value.startsWith(`${kind}_`), { message: `expected a ${kind}_ id` })
const count = (max: number) => z.number().int().min(0).max(max)
const stateCode = z.string().regex(/^[A-Z]{2}$/).nullable()
const freshness = z.enum(FRESHNESS_BANDS)
const via = z.enum(CONFIRMATION_ROUTES)
const confirmedAgeDays = count(3650).nullable()

/** Where an event is captured. Server events fire when the write commits; client events only in a consenting browser. */
export type ProductEventSide = "server" | "client"

interface ProductEventDefinition {
  side: ProductEventSide
  flows: readonly ProductFlow[]
  properties: z.ZodTypeAny
}

export const PRODUCT_EVENTS = {
  /** A real listing went live (flow B outcome; supply for the board). */
  job_published: {
    side: "server",
    flows: ["B"],
    properties: z
      .object({
        job: jobId,
        org: pseudonym("o"),
        state: stateCode,
        product: z.enum(PRODUCT_SLUGS).nullable(),
        pay_unit: z.enum(PAY_UNITS).nullable(),
        pay_stated: z.boolean(),
        equipment_count: count(20),
        trucks_requested: count(9999)
      })
      .strict()
  },
  /** A hauling business sent or re-sent interest in a job (flow A outcome, flow C start). */
  interest_submitted: {
    side: "server",
    flows: ["A", "C"],
    properties: z
      .object({
        job: jobId,
        org: pseudonym("o"),
        interest: pseudonym("i"),
        renewed: z.boolean(),
        trucks_offered: count(500),
        equipment_lines: count(20),
        contact_route: z.enum(CONTACT_ROUTES)
      })
      .strict()
  },
  /** A reply or decline on an inquiry, by the landing or the hauler (flow C outcome when the landing answers). */
  interest_replied: {
    side: "server",
    flows: ["C"],
    properties: z
      .object({
        interest: pseudonym("i"),
        org: pseudonym("o"),
        side: z.enum(["landing", "hauler"]),
        outcome: z.enum(["replied", "declined"])
      })
      .strict()
  },
  /** A hauling business re-stated its trucks' availability (flow D outcome; fresh supply for the board). */
  availability_reconfirmed: {
    side: "server",
    flows: ["D"],
    properties: z
      .object({
        org: pseudonym("o"),
        truck_types: count(200),
        via,
        signed_in: z.boolean()
      })
      .strict()
  },
  /** The poster confirmed a job is still available, or resumed a stopped one with that confirmation (flow E). */
  job_reconfirmed: {
    side: "server",
    flows: ["E"],
    properties: z
      .object({
        job: jobId,
        org: pseudonym("o"),
        via,
        resumed: z.boolean(),
        freshness_before: freshness,
        days_since_confirmed: confirmedAgeDays
      })
      .strict()
  },
  /** The poster paused, marked filled or closed a job (flow E). "Filled" is the poster's word, never a verified hire. */
  job_stopped: {
    side: "server",
    flows: ["E"],
    properties: z
      .object({
        job: jobId,
        org: pseudonym("o"),
        status: z.enum(JOB_STOP_STATUSES),
        via,
        freshness_before: freshness,
        days_since_confirmed: confirmedAgeDays
      })
      .strict()
  },
  /** A person opened a job's public share link in a browser (flow A start). Link-preview crawlers run no script. */
  share_link_opened: {
    side: "client",
    flows: ["A"],
    properties: z
      .object({
        job: jobId,
        channel: z.enum(SHARE_CHANNELS),
        signed_in: z.boolean()
      })
      .strict()
  },
  /** How long one flow took and how many taps it needed, measured in the browser (time-to-value and taps). */
  flow_timed: {
    side: "client",
    flows: ["A", "B", "C", "D", "E"],
    properties: z
      .object({
        flow: z.enum(PRODUCT_FLOWS),
        step: z.enum(ALL_FLOW_STEPS),
        elapsed_ms: count(FLOW_TIMING_CAP_MS),
        taps: count(FLOW_TAP_CAP),
        capped: z.boolean(),
        job: jobId.nullable()
      })
      .strict()
      .refine((value) => (FLOW_STEPS[value.flow] as readonly string[]).includes(value.step), {
        message: "step does not belong to this flow",
        path: ["step"]
      })
  }
} as const satisfies Record<string, ProductEventDefinition>

export type ProductEventName = keyof typeof PRODUCT_EVENTS
type SideOf<N extends ProductEventName> = (typeof PRODUCT_EVENTS)[N]["side"]
export type ServerProductEventName = { [N in ProductEventName]: SideOf<N> extends "server" ? N : never }[ProductEventName]
export type ClientProductEventName = { [N in ProductEventName]: SideOf<N> extends "client" ? N : never }[ProductEventName]
export type ProductEventProperties<N extends ProductEventName> = z.input<(typeof PRODUCT_EVENTS)[N]["properties"]>

export const PRODUCT_EVENT_NAMES = Object.keys(PRODUCT_EVENTS) as ProductEventName[]

/** The properties added to every product event: the catalogue version and the flows it feeds. */
export const COMMON_PROPERTY_KEYS = ["event_version", "flows"] as const

export interface ProductEvent {
  name: ProductEventName
  properties: Record<string, ProductPropertyValue>
}

/**
 * What a capture call did: sent it; skipped it (the builder had nothing to record); `disabled` (PostHog is not
 * configured); `declined` (Do Not Track or Global Privacy Control); `invalid` (refused by the schema or the guard).
 */
export type ProductEventOutcome = "sent" | "skipped" | "disabled" | "declined" | "invalid"

/** A refused event says why by key and rule only. It never repeats a value, so it is safe to log. */
export type ProductEventBuild = { ok: true; event: ProductEvent } | { ok: false; problems: string[] }

export function isProductEventName(name: string): name is ProductEventName {
  return Object.prototype.hasOwnProperty.call(PRODUCT_EVENTS, name)
}

export function productEventSide(name: string): ProductEventSide | null {
  return isProductEventName(name) ? PRODUCT_EVENTS[name].side : null
}

function issueProblem(issue: z.ZodIssue): string {
  const where = issue.path.join(".") || "(event)"
  return issue.code === "unrecognized_keys" ? `${issue.keys.join(",")}:unrecognized_key` : `${where}:${issue.code}`
}

/**
 * Checks the properties against the event's schema and the personal-data guard, and adds the version and flows.
 * Never throws.
 */
export function buildProductEvent<N extends ProductEventName>(name: N, properties: ProductEventProperties<N>): ProductEventBuild
export function buildProductEvent(name: string, properties: unknown): ProductEventBuild
export function buildProductEvent(name: string, properties: unknown): ProductEventBuild {
  if (!isProductEventName(name)) {
    return { ok: false, problems: ["(event):unknown_event"] }
  }

  const definition: ProductEventDefinition = PRODUCT_EVENTS[name]
  const parsed = definition.properties.safeParse(properties)

  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(issueProblem) }
  }

  const eventProperties: Record<string, ProductPropertyValue> = {
    ...(parsed.data as Record<string, ProductPropertyValue>),
    event_version: PRODUCT_EVENT_VERSION,
    flows: [...definition.flows]
  }
  const findings = findPersonalData(eventProperties)

  if (findings.length > 0) {
    return { ok: false, problems: findings.map((finding) => `${finding.key}:${finding.problem}`) }
  }

  return { event: { name, properties: eventProperties }, ok: true }
}
