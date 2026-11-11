import { describe, expect, it } from "vitest"

import type { MarketplaceSavedSearchInput } from "../../marketplace-port-v3"
import {
  marketplaceJobAlertCriteriaSchema,
  marketplaceNotificationPreferenceInputSchema,
  marketplaceSavedJobIdSchema,
  marketplaceSavedJobSearchInputSchema,
  type MarketplaceJobAlertCriteria
} from "./index"

const EMAIL = "hauler@example.com"

describe("job alert criteria", () => {
  it("keeps equipment, a named place and a distance, and fills in what was left unset", () => {
    const criteria: MarketplaceJobAlertCriteria = marketplaceJobAlertCriteriaSchema.parse({
      equipment: ["log_truck"],
      place: "Sweet Home",
      radiusMiles: 100,
      stateCode: "or"
    })

    expect(criteria).toEqual({ equipment: ["log_truck"], place: "Sweet Home", radiusMiles: 100, stateCode: "OR" })
  })

  it("refuses an email address, a device location, or any other extra field", () => {
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ place: EMAIL }).success).toBe(false)
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ latitude: 44.4, longitude: -122.7 }).success).toBe(false)
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ email: EMAIL }).success).toBe(false)
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ equipment: ["Log Truck"] }).success).toBe(false)
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ radiusMiles: 4 }).success).toBe(false)
    expect(marketplaceJobAlertCriteriaSchema.safeParse({ radiusMiles: 501 }).success).toBe(false)
  })
})

describe("saved job search input", () => {
  it("parses a new search and an edit as the port's input, always without a smuggled owner", () => {
    const created: MarketplaceSavedSearchInput<MarketplaceJobAlertCriteria> = marketplaceSavedJobSearchInputSchema.parse({
      alertsEnabled: true,
      criteria: { equipment: ["self_loader"] },
      name: "  Fir within a hundred miles  "
    })

    expect(created).toEqual({
      alertsEnabled: true,
      criteria: { equipment: ["self_loader"], place: null, radiusMiles: null, stateCode: null },
      name: "Fir within a hundred miles"
    })
    expect(created).not.toHaveProperty("searchId")

    const edited = marketplaceSavedJobSearchInputSchema.parse({
      alertsEnabled: false,
      criteria: {},
      name: "Winter",
      searchId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })

    expect(edited.searchId).toBe("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(JSON.stringify(edited)).not.toContain(EMAIL)
  })

  it("refuses a blank name, a name over 80 characters, and an owner or email smuggled onto the input", () => {
    expect(marketplaceSavedJobSearchInputSchema.safeParse({ alertsEnabled: false, criteria: {}, name: "   " }).success).toBe(false)
    expect(marketplaceSavedJobSearchInputSchema.safeParse({ alertsEnabled: false, criteria: {}, name: "n".repeat(81) }).success).toBe(false)
    expect(marketplaceSavedJobSearchInputSchema.safeParse({
      alertsEnabled: false,
      criteria: {},
      email: EMAIL,
      name: "Winter",
      organizationId: "33333333-bbbb-4bbb-8bbb-333333333333",
      searchId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }).success).toBe(false)
  })
})

describe("notification preference input", () => {
  it("accepts one known category and channel, and refuses anything else", () => {
    expect(marketplaceNotificationPreferenceInputSchema.parse({
      category: "job_alert",
      channel: "email",
      enabled: false
    })).toEqual({ category: "job_alert", channel: "email", enabled: false })

    expect(marketplaceNotificationPreferenceInputSchema.safeParse({
      category: "job_alert",
      channel: "email",
      email: EMAIL,
      enabled: true
    }).success).toBe(false)
    expect(marketplaceNotificationPreferenceInputSchema.safeParse({
      category: "team_invitation",
      channel: "email",
      enabled: false
    }).success).toBe(false)
    expect(marketplaceNotificationPreferenceInputSchema.safeParse({
      category: "promotion",
      channel: "sms",
      enabled: true
    }).success).toBe(false)
  })
})

describe("saved job id", () => {
  it("accepts a job id and refuses anything else", () => {
    expect(marketplaceSavedJobIdSchema.parse("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(marketplaceSavedJobIdSchema.safeParse("not-a-job").success).toBe(false)
    expect(marketplaceSavedJobIdSchema.safeParse(EMAIL).success).toBe(false)
  })
})
