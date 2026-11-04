import { describe, expect, it } from "vitest"

import {
  LANDING_BILLING_INACTIVE_REFUSAL,
  landingActivationRefusal,
  landingCountsTowardPlan,
  landingStatusChangeAllowed,
  MARKETPLACE_LANDING_PUBLIC_FIELDS,
  publicLandingView,
  type MarketplaceLandingView,
  landingOrganizationInputSchema,
  landingPlanCards,
  marketplaceInputIssues,
  marketplaceLandingInputSchema,
  normalizeSiteContactPhone,
  summarizeLandingAllowance
} from "./marketplace-landings"
import { LANDING_PLANS } from "./membership"

const VALID = {
  areaLabel: "Oakridge",
  name: "Hills Creek Unit 4",
  stateCode: "or"
}

describe("landing plan cards", () => {
  it("word every fact from LANDING_PLANS, in Basic, Pro, Regional order", () => {
    const cards = landingPlanCards()

    expect(cards.map((card) => card.code)).toEqual(["basic", "pro", "regional"])
    expect(cards.map((card) => card.price)).toEqual(Object.values(LANDING_PLANS).map((plan) => `$${plan.monthlyPriceCents / 100} per month`))
    expect(cards.map((card) => card.activeLandings)).toEqual(["1 active landing", "3 active landings", "Unlimited active landings"])
    expect(cards.map((card) => card.teamMembers)).toEqual(Object.values(LANDING_PLANS).map((plan) => `${plan.teamSeatLimit} team members, including you`))
    expect(cards.map((card) => card.invitations)).toEqual(
      Object.values(LANDING_PLANS).map((plan) => `${plan.targetedInvitationsPerCycle} targeted invitations per billing cycle`)
    )
  })

  it("matches the Blueprint v1.0 baseline (#127 criterion 1)", () => {
    const cards = landingPlanCards()

    expect(cards.map((card) => card.price)).toEqual(["$149 per month", "$299 per month", "$499 per month"])
    expect(cards.map((card) => card.teamMembers.split(" ")[0])).toEqual(["2", "5", "10"])
    expect(cards.map((card) => card.invitations.split(" ")[0])).toEqual(["3", "10", "30"])
  })
})

describe("landing allowance summary", () => {
  it("takes every limit from the plan, and caps invitations at the plan's allowance", () => {
    const summary = summarizeLandingAllowance({
      activeLandings: 1,
      cycleEndsAt: "2026-12-01T00:00:00.000Z",
      invitationsRemaining: 99,
      planCode: "basic",
      teamMembers: 2
    })

    expect(summary).toMatchObject({
      billingActive: true,
      invitations: { perCycle: 3, remaining: 3, resetsAt: "2026-12-01T00:00:00.000Z" },
      landings: { limit: 1, unlimited: false, used: 1 },
      team: { limit: 2, used: 2 }
    })
  })

  it("says unlimited for Regional landings", () => {
    expect(summarizeLandingAllowance({ activeLandings: 7, cycleEndsAt: null, invitationsRemaining: 30, planCode: "regional", teamMembers: 1 }).landings)
      .toEqual({ limit: null, unlimited: true, used: 7 })
  })

  it("claims no limit or invitation while no plan is active", () => {
    expect(summarizeLandingAllowance({ activeLandings: 0, cycleEndsAt: null, invitationsRemaining: null, planCode: null, teamMembers: 1 })).toEqual({
      billingActive: false,
      invitations: { perCycle: null, remaining: null, resetsAt: null },
      landings: { limit: null, unlimited: false, used: 0 },
      plan: null,
      team: { limit: null, unlimited: false, used: 1 }
    })
  })

  it("counts only recruiting landings", () => {
    expect(["active", "paused", "archived"].map((status) => landingCountsTowardPlan(status as "active"))).toEqual([true, false, false])
  })
})

describe("landing input", () => {
  it("saves without an exact location (B3, spec §4.3)", () => {
    expect(marketplaceLandingInputSchema.parse(VALID)).toEqual({
      areaLabel: "Oakridge",
      county: null,
      exactLocation: null,
      gateInstructions: null,
      landingId: null,
      name: "Hills Creek Unit 4",
      recruiting: false,
      siteContactName: null,
      siteContactPhone: null,
      stateCode: "OR"
    })
  })

  it("keeps the private details apart and normalizes the contact phone to E.164", () => {
    const parsed = marketplaceLandingInputSchema.parse({
      ...VALID,
      exactLat: "43.74712",
      exactLng: "-122.46171",
      gateInstructions: "Green gate, code 4417",
      recruiting: "1",
      siteContactName: "Lee",
      siteContactPhone: "(541) 555-0100"
    })

    expect(parsed.exactLocation).toEqual({ lat: 43.74712, lng: -122.46171 })
    expect(parsed.gateInstructions).toBe("Green gate, code 4417")
    expect(parsed.siteContactPhone).toBe("+15415550100")
    expect(parsed.recruiting).toBe(true)
  })

  it("refuses access codes, coordinates and contact details in the public fields", () => {
    for (const [field, value] of [
      ["name", "Gate code 4417 landing"],
      ["areaLabel", "43.74712, -122.46171"],
      ["name", "Call 541-555-0100"]
    ] as const) {
      const result = marketplaceLandingInputSchema.safeParse({ ...VALID, [field]: value })
      expect(result.success, `${field}: ${value}`).toBe(false)
      if (!result.success) expect(marketplaceInputIssues(result.error).map((issue) => issue.field)).toContain(field)
    }
  })

  it("needs both coordinates or neither, in range", () => {
    const one = marketplaceLandingInputSchema.safeParse({ ...VALID, exactLat: "43.7" })
    expect(one.success).toBe(false)
    if (!one.success) expect(marketplaceInputIssues(one.error)).toEqual([{ field: "exactLng", message: "Enter both the latitude and the longitude, or leave both empty" }])

    expect(marketplaceLandingInputSchema.safeParse({ ...VALID, exactLat: "95", exactLng: "-122" }).success).toBe(false)
  })

  it("requires a name, a town and a two-letter state", () => {
    const result = marketplaceLandingInputSchema.safeParse({ areaLabel: " ", name: "", stateCode: "Oregon" })
    expect(result.success).toBe(false)
    if (!result.success) expect(marketplaceInputIssues(result.error).map((issue) => issue.field).sort()).toEqual(["areaLabel", "name", "stateCode"])
  })

  it("reads phone numbers only when they are dialable", () => {
    expect(normalizeSiteContactPhone("541.555.0100")).toBe("+15415550100")
    expect(normalizeSiteContactPhone("+44 20 7946 0958")).toBe("+442079460958")
    expect(normalizeSiteContactPhone("555-2002")).toBeNull()
    expect(normalizeSiteContactPhone("call the office")).toBeNull()
  })
})

describe("landing organization input", () => {
  it("keeps the public name and an optional home state", () => {
    expect(landingOrganizationInputSchema.parse({ displayName: " Cedar Fork Logging ", homeState: "or" })).toEqual({ displayName: "Cedar Fork Logging", homeState: "OR" })
    expect(landingOrganizationInputSchema.parse({ displayName: "Cedar Fork Logging", homeState: "" })).toEqual({ displayName: "Cedar Fork Logging", homeState: null })
    expect(landingOrganizationInputSchema.safeParse({ displayName: "" }).success).toBe(false)
  })
})

const OWNED: MarketplaceLandingView = {
  activeJobs: 2,
  approximatePoint: { lat: 43.7, lng: -122.5 },
  areaLabel: "Oakridge, OR",
  county: "Lane",
  id: "77777777-ffff-4fff-8fff-ffffffffffff",
  name: "Hills Creek Unit 4",
  privateDetails: { exactLocation: { lat: 43.74712, lng: -122.46171 }, gateInstructions: "Green gate 4417", siteContactName: "Lee", siteContactPhone: "+15415550100" },
  stateCode: "OR",
  status: "active",
  updatedAt: "2026-11-03T12:00:00.000Z"
}

describe("landing activation under the plan (#127 criteria 5 and 7)", () => {
  it("refuses recruiting while billing is inactive, with the plain reason", () => {
    expect(landingActivationRefusal({ activeLandings: 0, planCode: null })).toEqual({ message: LANDING_BILLING_INACTIVE_REFUSAL, reason: "billing_inactive" })
  })

  it("refuses at the plan's cap and offers pausing another landing or the plans", () => {
    const refusal = landingActivationRefusal({ activeLandings: 1, planCode: "basic" })
    expect(refusal?.reason).toBe("at_plan_limit")
    expect(refusal?.message).toMatch(/Basic plan allows 1 active landing.*Pause another landing or see plans/)
    expect(landingActivationRefusal({ activeLandings: 2, planCode: "pro" })).toBeNull()
    expect(landingActivationRefusal({ activeLandings: 3, planCode: "pro" })?.reason).toBe("at_plan_limit")
    expect(landingActivationRefusal({ activeLandings: 250, planCode: "regional" })).toBeNull()
  })

  it("asks nothing of a landing that is already recruiting", () => {
    expect(landingActivationRefusal({ activeLandings: 1, planCode: "basic" }, "active")).toBeNull()
  })

  it("brings archived landings back paused, never straight to recruiting", () => {
    expect(landingStatusChangeAllowed("archived", "active")).toBe(false)
    expect(landingStatusChangeAllowed("archived", "paused")).toBe(true)
    expect(landingStatusChangeAllowed("paused", "active")).toBe(true)
    expect(landingStatusChangeAllowed("active", "paused")).toBe(true)
    expect(landingStatusChangeAllowed("active", "archived")).toBe(true)
  })
})

describe("landing visibility (#127 criterion 4)", () => {
  it("the public view carries the public fields only: no exact location, gate instructions or contact", () => {
    const view = publicLandingView(OWNED)

    expect(Object.keys(view)).toEqual([...MARKETPLACE_LANDING_PUBLIC_FIELDS])
    const text = JSON.stringify(view)
    for (const secret of ["Green gate 4417", "43.74712", "-122.46171", "Lee", "+15415550100", "privateDetails", "activeJobs"]) {
      expect(text).not.toContain(secret)
    }
  })
})
