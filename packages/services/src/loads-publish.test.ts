import {
  PERCENTAGE_V1_TERMS_VERSION,
  PLATFORM_FEE_BPS,
  type HostBillingProfile,
  type OrganizationBillingAccount
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createLoadPosting, provisionLoadCapacity, updateLoadPosting } from "./loads"

const HOST_ORG = "33333333-3333-4333-8333-333333333332"

const BASE_LOAD = {
  companyId: HOST_ORG,
  dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
  loaderProfileId: null,
  pickupLandingId: "66666666-6666-4666-8666-666666666662",
  dropoffMillId: "99999999-9999-4999-8999-999999999991",
  routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  title: "Published load capacity test",
  loadType: "saw_logs",
  scheduleType: "one_off",
  loadDate: "2026-07-20",
  campaignStartDate: null,
  campaignEndDate: null,
  recurringSchedule: null,
  dailyTruckCountNeeded: 3,
  // What one truckload pays the driver: the driver's accepted operating
  // promise, required on every published load.
  driverPayCents: 52_500,
  estimatedTonsPerLoad: 27,
  equipmentRequirements: [],
  accessRequirements: [],
  roadCondition: "good",
  weatherNotes: null,
  dispatcherContact: { name: "Cole Cedar", phone: "555-3001", email: "dispatch@summit.example" },
  loaderContact: null
} as const

/** The host's card, gone. */
function removeCard(state: LogLoadsDatabaseState, organizationId = HOST_ORG): void {
  state.hostBillingProfiles = state.hostBillingProfiles.filter(
    (profile) => profile.organizationId !== organizationId
  )
}

function billingProfileFor(state: LogLoadsDatabaseState, organizationId = HOST_ORG): HostBillingProfile {
  const profile = state.hostBillingProfiles.find((entry) => entry.organizationId === organizationId)

  if (!profile) {
    throw new Error(`the seed has no billing profile for ${organizationId}`)
  }

  return profile
}

function hostAccount(state: LogLoadsDatabaseState): OrganizationBillingAccount {
  const account = state.organizationBillingAccounts.find(
    (entry) => entry.organizationId === HOST_ORG
  )

  if (!account) {
    throw new Error("the seed has no billing account for the host")
  }

  return account
}

/**
 * Everything publication might once have written for a fee: the billing
 * account, the card, the fee ledger, invoices and the acceptance audit.
 */
function commercialRecords(state: LogLoadsDatabaseState) {
  return structuredClone({
    acceptanceAudits: state.auditEvents.filter(
      (event) => event.action === "percentage_v1_agreement_accepted"
    ),
    billingAccounts: state.organizationBillingAccounts,
    hostBillingProfiles: state.hostBillingProfiles,
    hostInvoices: state.hostInvoices,
    networkUsageEvents: state.networkUsageEvents,
    platformFeeEvents: state.platformFeeEvents
  })
}

function expectPublished(state: LogLoadsDatabaseState, loadId: string) {
  expect(state.loadPostings.some((entry) => entry.id === loadId)).toBe(true)
  expect(state.truckSlots.some((slot) => slot.loadPostingId === loadId)).toBe(true)
  expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === loadId)).toBe(true)
}

function counts(state: LogLoadsDatabaseState) {
  return {
    capacities: state.opportunityCapacities.length,
    postings: state.loadPostings.length,
    slots: state.truckSlots.length
  }
}

describe("publishing a load makes it requestable", () => {
  it("creates an opportunity-capacity ledger and a requestable loading slot for a live load", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open", visibility: "open_network" })

    const capacity = state.opportunityCapacities.find((entry) => entry.loadPostingId === load.id)
    expect(capacity).toBeDefined()
    expect(capacity?.totalTruckloads).toBe(3)
    expect(capacity?.remainingTruckloads).toBe(3)
    expect(capacity?.visibilityMode).toBe("open_network")

    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    expect(slots).toHaveLength(1)
    expect(slots[0]?.status).toBe("open")
    expect(slots[0]?.capacity).toBe(3)
    expect(slots[0]?.reservedCount).toBe(0)
    // The slot is genuinely requestable: open status with room.
    expect((slots[0]?.reservedCount ?? 0) < (slots[0]?.capacity ?? 0)).toBe(true)
  })

  it("honors the requested visibility mode", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open", visibility: "private_network" })

    expect(state.opportunityCapacities.find((entry) => entry.loadPostingId === load.id)?.visibilityMode).toBe("private_network")
  })

  it("does not create capacity for a draft load", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })

    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === load.id)).toBe(false)
    expect(state.truckSlots.some((slot) => slot.loadPostingId === load.id)).toBe(false)
  })

  it("fans a campaign out into one slot per day with capacity summed across days", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, {
      ...BASE_LOAD,
      campaignEndDate: "2026-07-22",
      campaignStartDate: "2026-07-20",
      dailyTruckCountNeeded: 2,
      loadDate: null,
      scheduleType: "campaign",
      status: "open"
    })

    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    expect(slots).toHaveLength(3) // Jul 20, 21, 22
    expect(slots.every((slot) => slot.capacity === 2)).toBe(true)
    expect(new Set(slots.map((slot) => slot.slotDate)).size).toBe(3)

    const capacity = state.opportunityCapacities.find((entry) => entry.loadPostingId === load.id)
    expect(capacity?.totalTruckloads).toBe(6) // 2 per day x 3 days
  })

  it("creates no slots for a recurring load with no selected weekday (never a wrong-day slot)", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, {
      ...BASE_LOAD,
      campaignStartDate: "2026-07-20",
      loadDate: null,
      recurringSchedule: { daysOfWeek: [], frequency: "weekly", untilDate: "2026-07-31" },
      scheduleType: "recurring",
      status: "open"
    })

    expect(state.truckSlots.filter((slot) => slot.loadPostingId === load.id)).toHaveLength(0)
    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === load.id)).toBe(false)
  })

  it("fans a weekly recurring load out onto its days of the week only", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, {
      ...BASE_LOAD,
      campaignStartDate: "2026-07-20",
      dailyTruckCountNeeded: 1,
      loadDate: null,
      recurringSchedule: { daysOfWeek: [1, 3, 5], frequency: "weekly", untilDate: "2026-07-31" },
      scheduleType: "recurring",
      status: "open"
    })

    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    expect(slots.length).toBeGreaterThan(1)
    // Every generated slot lands on Mon (1), Wed (3), or Fri (5).
    expect(slots.every((slot) => [1, 3, 5].includes(new Date(`${slot.slotDate}T00:00:00.000Z`).getUTCDay()))).toBe(true)
  })
})

describe("what a published load pays the driver", () => {
  it("persists the stated pay on the row, not just in the reply", () => {
    const state = createInMemoryDatabase()
    const created = createLoadPosting(state, { ...BASE_LOAD, driverPayCents: 61_250, status: "open" })

    // Read back off the stored document. The returned entity could be right while
    // the write dropped the field.
    const stored = state.loadPostings.find((load) => load.id === created.id)

    expect(stored).toBeDefined()
    expect(stored?.driverPayCents).toBe(61_250)
    expect(stored?.driverPayCents).not.toBeNull()
  })

  it("keeps the rate card alongside the stated pay rather than replacing it", () => {
    const state = createInMemoryDatabase()
    const created = createLoadPosting(state, { ...BASE_LOAD, status: "open" })
    const stored = state.loadPostings.find((load) => load.id === created.id)!

    // Stated pay is what a driver is promised; the lane's price list stays on the
    // posting. Existing lanes and older postings reference it.
    expect(stored.rateId).toBe(BASE_LOAD.rateId)
    expect(state.rates.some((rate) => rate.id === stored.rateId)).toBe(true)
    expect(stored.driverPayCents).toBe(52_500)
  })

  it("refuses to publish work that states no driver pay, and leaves nothing behind", () => {
    const state = createInMemoryDatabase()
    const before = counts(state)

    expect(() =>
      createLoadPosting(state, { ...BASE_LOAD, driverPayCents: null, status: "open" })
    ).toThrow(/pays a driver per truckload/)

    // Refused BEFORE the push: a posting that may not be published must not be
    // left lying in the document for a later reader to treat as work.
    expect(counts(state)).toEqual(before)
    expect(state.loadPostings.some((load) => load.title === BASE_LOAD.title)).toBe(false)
  })

  it("still lets a draft be saved without stated pay, and refuses it at publish", () => {
    const state = createInMemoryDatabase()
    const draft = createLoadPosting(state, { ...BASE_LOAD, driverPayCents: null, status: "draft" })

    expect(draft.status).toBe("draft")
    expect(draft.driverPayCents).toBeNull()

    // provisionLoadCapacity is the function openDraftLoadPosting publishes
    // through, so a draft written before the figure existed is stopped when it
    // reaches the network rather than when it was saved.
    expect(() => provisionLoadCapacity(state, draft, "open_network", "request_approval")).toThrow(
      /pays a driver per truckload/
    )
    expect(state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(false)
    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === draft.id)).toBe(false)
  })

  it("refuses an edit that removes the stated pay from live work", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    expect(() => updateLoadPosting(state, { driverPayCents: null, id: load.id })).toThrow(
      /pays a driver per truckload/
    )
    expect(state.loadPostings.find((entry) => entry.id === load.id)?.driverPayCents).toBe(52_500)
  })

  it("explains the pay requirement without quoting the retired fee", () => {
    const state = createInMemoryDatabase()
    let message = ""

    try {
      createLoadPosting(state, { ...BASE_LOAD, driverPayCents: null, status: "open" })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("pays a driver per truckload")
    expect(message).toContain("Posting itself is free")
    expect(message).not.toMatch(/%|fee|agreement|card/i)
  })
})

describe("publishing never requires or creates a percentage agreement", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    {
      label: "no billing account at all",
      prepare: (state: LogLoadsDatabaseState) => {
        state.organizationBillingAccounts = state.organizationBillingAccounts.filter(
          (account) => account.organizationId !== HOST_ORG
        )
      }
    },
    {
      label: "an unenrolled billing account",
      prepare: (state: LogLoadsDatabaseState) => {
        const account = hostAccount(state)
        account.activationState = "unenrolled"
        account.billingModel = null
        account.percentageTermsSnapshot = null
        account.subscriptionId = null
      }
    },
    {
      label: "an explicit legacy account",
      prepare: (state: LogLoadsDatabaseState) => {
        const account = hostAccount(state)
        account.activationState = "legacy"
        account.billingModel = "legacy_percentage"
        account.percentageTermsSnapshot = null
        account.subscriptionId = null
      }
    },
    {
      label: "a historical percentage-v1-2026-08-03 agreement",
      prepare: (state: LogLoadsDatabaseState) => {
        expect(hostAccount(state).percentageTermsSnapshot?.acceptedTermsVersion).toBe(
          PERCENTAGE_V1_TERMS_VERSION
        )
      }
    },
    {
      label: "a historical agreement under a stale terms version",
      prepare: (state: LogLoadsDatabaseState) => {
        hostAccount(state).percentageTermsSnapshot!.acceptedTermsVersion = "percentage-v1-retired"
      }
    },
    {
      label: "a historical agreement with an altered fee",
      prepare: (state: LogLoadsDatabaseState) => {
        const terms = hostAccount(state).percentageTermsSnapshot as { feeBps: number }
        terms.feeBps = PLATFORM_FEE_BPS - 1
      }
    }
  ])("publishes for $label and leaves every commercial record as it was", ({ prepare }) => {
    const state = createInMemoryDatabase()
    prepare(state)
    const recordsBefore = commercialRecords(state)

    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    expectPublished(state, load.id)
    expect(commercialRecords(state)).toEqual(recordsBefore)
  })

  it.each([
    {
      label: "no card on file",
      prepare: (state: LogLoadsDatabaseState) => removeCard(state)
    },
    {
      label: "a declined card",
      prepare: (state: LogLoadsDatabaseState) => {
        const profile = billingProfileFor(state)
        profile.status = "failed"
        profile.lastFailureAt = "2026-07-01T00:00:00.000Z"
        profile.lastFailureReason = "card_declined"
      }
    },
    {
      label: "two billing profiles for one organization",
      prepare: (state: LogLoadsDatabaseState) => {
        const profile = billingProfileFor(state)
        state.hostBillingProfiles.push({
          ...profile,
          attachedAt: null,
          defaultPaymentMethodId: null,
          id: "34343434-3434-4434-8434-3434343434e9",
          paymentMethodBrand: null,
          paymentMethodLast4: null,
          status: "none"
        })
      }
    }
  ])("publishes with $label, because a card is not a condition of publication", ({ prepare }) => {
    const state = createInMemoryDatabase()
    prepare(state)
    const recordsBefore = commercialRecords(state)

    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    expectPublished(state, load.id)
    expect(commercialRecords(state)).toEqual(recordsBefore)
  })

  it("publishes the same way with both percentage flags set to enabled", () => {
    // The flags stay as they are. Switching them on must not turn publication
    // back into an enrollment or fee step.
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv("LOGLOADS_FEE_COLLECTION", "enabled")
    const state = createInMemoryDatabase()
    removeCard(state)
    const account = hostAccount(state)
    account.activationState = "unenrolled"
    account.billingModel = null
    account.percentageTermsSnapshot = null
    account.subscriptionId = null
    const recordsBefore = commercialRecords(state)

    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    expectPublished(state, load.id)
    expect(commercialRecords(state)).toEqual(recordsBefore)
  })

  it("publishes a saved draft through provisionLoadCapacity with no card", () => {
    const state = createInMemoryDatabase()
    const draft = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })
    removeCard(state)
    const recordsBefore = commercialRecords(state)

    provisionLoadCapacity(state, draft, "open_network", "request_approval")

    expect(state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(true)
    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === draft.id)).toBe(true)
    expect(commercialRecords(state)).toEqual(recordsBefore)
  })

  it("lets an edit move a draft onto the network with no card", () => {
    const state = createInMemoryDatabase()
    const draft = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })
    removeCard(state)

    const updated = updateLoadPosting(state, { id: draft.id, status: "open" })

    expect(updated.status).toBe("open")
    expect(state.platformFeeEvents).toEqual(createInMemoryDatabase().platformFeeEvents)
  })

  it("lets an ordinary edit of already-published work through", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    removeCard(state)

    const updated = updateLoadPosting(state, { id: load.id, weatherNotes: "Fog through 09:00" })

    expect(updated.weatherNotes).toBe("Fog through 09:00")
    expect(updated.status).toBe("open")
  })
})

describe("publishing still refuses a corrupted billing record", () => {
  it("refuses a subscription pointer that does not resolve, and leaves nothing behind", () => {
    const state = createInMemoryDatabase()
    hostAccount(state).subscriptionId = "20202020-2020-4020-8020-202020202020"
    const before = counts(state)

    expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(
      /cross-wired or incomplete/
    )
    expect(counts(state)).toEqual(before)
    expect(state.platformFeeEvents).toEqual(createInMemoryDatabase().platformFeeEvents)
  })

  it("refuses two effective billing accounts instead of picking one", () => {
    const state = createInMemoryDatabase()
    state.organizationBillingAccounts.push({
      ...structuredClone(hostAccount(state)),
      id: "21212121-2121-4121-8121-212121212121"
    })
    const before = counts(state)

    expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(
      /2 billing accounts/
    )
    expect(counts(state)).toEqual(before)
  })
})
