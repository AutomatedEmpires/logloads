import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  MARKETPLACE_JOB_STOP_STATUSES,
  MARKETPLACE_PRODUCTS,
  marketplaceContactPreferenceSchema,
  marketplacePayUnitSchema
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  buildProductEvent,
  COMMON_PROPERTY_KEYS,
  CONTACT_ROUTES,
  FLOW_STEPS,
  JOB_STOP_STATUSES,
  PAY_UNITS,
  PRODUCT_SLUGS,
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_VERSION,
  PRODUCT_EVENTS,
  PRODUCT_FLOWS,
  productSlug,
  productValue
} from "./events"
import { FIXTURE_INTEREST, PERSONAL_STRINGS, VALID_PROPERTIES } from "./fixtures"
import { findPersonalData } from "./privacy"

describe("the product event catalogue", () => {
  it("is version 1 and covers flows A to E with the events #286 names", () => {
    expect(PRODUCT_EVENT_VERSION).toBe(1)
    expect(PRODUCT_EVENT_NAMES.sort()).toEqual([
      "availability_reconfirmed",
      "flow_timed",
      "interest_replied",
      "interest_submitted",
      "job_published",
      "job_reconfirmed",
      "job_stopped",
      "share_link_opened"
    ])

    const covered = new Set(PRODUCT_EVENT_NAMES.flatMap((name) => PRODUCT_EVENTS[name].flows))
    expect([...covered].sort()).toEqual([...PRODUCT_FLOWS])
    expect(Object.keys(FLOW_STEPS).sort()).toEqual([...PRODUCT_FLOWS])
  })

  it("captures outcomes on the server and only the share-link open and flow timing in the browser", () => {
    const client = PRODUCT_EVENT_NAMES.filter((name) => PRODUCT_EVENTS[name].side === "client").sort()
    expect(client).toEqual(["flow_timed", "share_link_opened"])
  })

  it.each(PRODUCT_EVENT_NAMES)("builds %s with exactly its declared properties, the version and its flows", (name) => {
    const built = buildProductEvent(name, VALID_PROPERTIES[name])

    expect(built.ok).toBe(true)

    if (!built.ok) return

    expect(built.event.name).toBe(name)
    expect(Object.keys(built.event.properties).sort()).toEqual(
      [...Object.keys(VALID_PROPERTIES[name]), ...COMMON_PROPERTY_KEYS].sort()
    )
    expect(built.event.properties.event_version).toBe(PRODUCT_EVENT_VERSION)
    expect(built.event.properties.flows).toEqual([...PRODUCT_EVENTS[name].flows])
    expect(findPersonalData(built.event.properties)).toEqual([])
  })

  it.each(PRODUCT_EVENT_NAMES)("refuses %s with an undeclared key, naming the key but not the value", (name) => {
    for (const key of ["name", "email", "phone", "message", "title", "extra"]) {
      const built = buildProductEvent(name, { ...VALID_PROPERTIES[name], [key]: "jo.hauler@example.com" })

      expect(built.ok).toBe(false)

      if (built.ok) continue

      expect(built.problems.join(" ")).toContain(key)
      expect(built.problems.join(" ")).not.toContain("example.com")
    }
  })

  it.each(PRODUCT_EVENT_NAMES)("refuses %s when any declared string property carries personal data or free text", (name) => {
    const stringKeys = Object.entries(VALID_PROPERTIES[name]).filter(([, value]) => typeof value === "string").map(([key]) => key)

    expect(stringKeys.length).toBeGreaterThan(0)

    for (const key of stringKeys) {
      for (const personal of PERSONAL_STRINGS) {
        const built = buildProductEvent(name, { ...VALID_PROPERTIES[name], [key]: personal })

        expect(built.ok, `${name}.${key} accepted ${personal}`).toBe(false)

        if (!built.ok) expect(built.problems.join(" ")).not.toContain(personal)
      }
    }
  })

  it("refuses raw (unhashed) user and business ids where a pseudonymous id belongs", () => {
    const rawId = "0b4f6c1d-2e3a-4b5c-9d6e-7f8091a2b3c4"

    expect(buildProductEvent("interest_submitted", { ...VALID_PROPERTIES.interest_submitted, org: rawId }).ok).toBe(false)
    expect(buildProductEvent("interest_submitted", { ...VALID_PROPERTIES.interest_submitted, interest: rawId }).ok).toBe(false)
    expect(buildProductEvent("interest_submitted", { ...VALID_PROPERTIES.interest_submitted, org: FIXTURE_INTEREST }).ok).toBe(false)
  })

  it("refuses counts out of range and durations past the cap", () => {
    expect(buildProductEvent("job_published", { ...VALID_PROPERTIES.job_published, trucks_requested: -1 }).ok).toBe(false)
    expect(buildProductEvent("job_published", { ...VALID_PROPERTIES.job_published, equipment_count: 1.5 }).ok).toBe(false)
    expect(buildProductEvent("flow_timed", { ...VALID_PROPERTIES.flow_timed, elapsed_ms: 3_600_001 }).ok).toBe(false)
    expect(buildProductEvent("flow_timed", { ...VALID_PROPERTIES.flow_timed, taps: 100 }).ok).toBe(false)
  })

  it("refuses a flow step that belongs to another flow", () => {
    expect(buildProductEvent("flow_timed", { ...VALID_PROPERTIES.flow_timed, flow: "B", step: "published" }).ok).toBe(true)
    expect(buildProductEvent("flow_timed", { ...VALID_PROPERTIES.flow_timed, flow: "B", step: "first_send" }).ok).toBe(false)
    expect(buildProductEvent("flow_timed", { ...VALID_PROPERTIES.flow_timed, flow: "E", step: "stopped" }).ok).toBe(true)
  })

  it("refuses an unknown event name", () => {
    expect(buildProductEvent("job_viewed", {})).toEqual({ ok: false, problems: ["(event):unknown_event"] })
  })

  it("maps every product label to a slug the job_published schema accepts, never the poster's own words", () => {
    for (const label of MARKETPLACE_PRODUCTS) {
      const built = buildProductEvent("job_published", { ...VALID_PROPERTIES.job_published, product: productSlug(label) })
      expect(built.ok, label).toBe(true)
    }

    expect(productSlug("Hog fuel and biomass")).toBe("hog_fuel_and_biomass")
    expect(MARKETPLACE_PRODUCTS.map(productValue)).toEqual([...PRODUCT_SLUGS])
    expect([productValue(undefined), productValue(""), productValue("Cedar from my cousin")]).toEqual([null, null, null])
    expect(buildProductEvent("job_published", { ...VALID_PROPERTIES.job_published, product: "cedar_from_my_cousin" }).ok).toBe(false)
  })

  it("keeps its copies of the marketplace enums identical to packages/contracts", () => {
    expect([...PRODUCT_SLUGS]).toEqual(MARKETPLACE_PRODUCTS.map(productSlug))
    expect([...PAY_UNITS]).toEqual(marketplacePayUnitSchema.options)
    expect([...CONTACT_ROUTES]).toEqual(marketplaceContactPreferenceSchema.options)
    expect([...JOB_STOP_STATUSES]).toEqual([...MARKETPLACE_JOB_STOP_STATUSES])
  })
})

describe("the browser half", () => {
  it.each(["events.ts", "privacy.ts", "consent.ts", "client.ts", "flow-clock.ts", "beacons.tsx"])(
    "%s never imports the contracts at run time or the server half, so page bundles stay small and server-free",
    (file) => {
      const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8")

      expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+"@logloads\/contracts"/m)
      expect(source).not.toMatch(/from\s+"(?:\.\/server|@\/lib\/analytics\/server|@\/lib\/analytics|server-only|node:crypto)"/)
    }
  )
})

describe("docs/analytics/event-plan.md", () => {
  const plan = readFileSync(fileURLToPath(new URL("../../../../docs/analytics/event-plan.md", import.meta.url)), "utf8")

  it.each(PRODUCT_EVENT_NAMES)("documents %s and every one of its properties", (name) => {
    expect(plan).toContain(`\`${name}\``)

    for (const key of Object.keys(VALID_PROPERTIES[name])) {
      expect(plan, `${name}.${key}`).toContain(`\`${key}\``)
    }
  })

  it("states the event version the code sends", () => {
    expect(plan).toContain(`version ${PRODUCT_EVENT_VERSION}`)
  })
})
