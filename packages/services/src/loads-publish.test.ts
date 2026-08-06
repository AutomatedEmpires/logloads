import {
  FEE_BPS_SCALE,
  PLATFORM_FEE_BPS,
  computePlatformFeeCents,
  type HostBillingProfile
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLoadPosting, provisionLoadCapacity, updateLoadPosting } from "./loads"

const HOST_ORG = "33333333-3333-4333-8333-333333333332"

/**
 * The rate a host is quoted, derived the way the refusals derive it, so the
 * message assertions below survive a rate change instead of pinning a string.
 */
const FEE_PERCENT = `${(PLATFORM_FEE_BPS / FEE_BPS_SCALE) * 100}%`

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
  // What one truckload pays the driver. Stated on every fixture below because a
  // load without it is, since the fee exists, not publishable work.
  driverPayCents: 52_500,
  estimatedTonsPerLoad: 27,
  equipmentRequirements: [],
  accessRequirements: [],
  roadCondition: "good",
  weatherNotes: null,
  dispatcherContact: { name: "Cole Cedar", phone: "555-3001", email: "dispatch@summit.example" },
  loaderContact: null
} as const

/** The host's card, gone. What every organization looks like before it attaches one. */
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

interface MutablePercentageAccount {
  percentageTermsSnapshot: {
    acceptedTermsVersion: string
    billingCadence: string
    currency: string
    feeBps: number
  }
  subscriptionId: string | null
}

function percentageAccountFor(state: LogLoadsDatabaseState): MutablePercentageAccount {
  const account = state.organizationBillingAccounts.find(
    (entry) => entry.organizationId === HOST_ORG
  )

  if (!account || !account.percentageTermsSnapshot) {
    throw new Error("the seed has no current percentage agreement for the host")
  }

  return account as unknown as MutablePercentageAccount
}

const INVALID_CURRENT_AGREEMENT_CASES: Array<{
  corrupt: (account: MutablePercentageAccount) => void
  reason: string
}> = [
  {
    corrupt: (account) => {
      account.percentageTermsSnapshot.acceptedTermsVersion = "percentage-v1-retired"
    },
    reason: "a stale terms version"
  },
  {
    corrupt: (account) => {
      account.percentageTermsSnapshot.feeBps = PLATFORM_FEE_BPS - 1
    },
    reason: "an altered fee"
  },
  {
    corrupt: (account) => {
      account.percentageTermsSnapshot.billingCadence = "weekly"
    },
    reason: "an altered billing cadence"
  },
  {
    corrupt: (account) => {
      account.percentageTermsSnapshot.currency = "CAD"
    },
    reason: "an altered currency"
  },
  {
    corrupt: (account) => {
      account.subscriptionId = "20202020-2020-4020-8020-202020202020"
    },
    reason: "a subscription attached to the percentage account"
  }
]

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
    // the write dropped the field, and the bill is raised from the row.
    const stored = state.loadPostings.find((load) => load.id === created.id)

    expect(stored).toBeDefined()
    expect(stored?.driverPayCents).toBe(61_250)
    expect(stored?.driverPayCents).not.toBeNull()
  })

  it("is a usable fee base: the stored figure is what the fee is computed from", () => {
    const state = createInMemoryDatabase()
    const created = createLoadPosting(state, { ...BASE_LOAD, driverPayCents: 52_500, status: "open" })
    const stored = state.loadPostings.find((load) => load.id === created.id)!

    // 5% of $525.00, from the contracts function the ledger and the invoice use.
    // If this row's pay were null or an estimate, there would be nothing to bill.
    expect(computePlatformFeeCents(stored.driverPayCents!, PLATFORM_FEE_BPS)).toBe(2_625)
  })

  it("keeps the rate card alongside the stated pay rather than replacing it", () => {
    const state = createInMemoryDatabase()
    const created = createLoadPosting(state, { ...BASE_LOAD, status: "open" })
    const stored = state.loadPostings.find((load) => load.id === created.id)!

    // Stated pay is what a driver is promised and what the fee is charged on; the
    // lane's price list stays on the posting. Existing lanes and older postings
    // reference it, so dropping it here would break work already on the network.
    expect(stored.rateId).toBe(BASE_LOAD.rateId)
    expect(state.rates.some((rate) => rate.id === stored.rateId)).toBe(true)
    expect(stored.driverPayCents).toBe(52_500)
  })

  it("refuses to publish work that states no driver pay, and leaves nothing behind", () => {
    const state = createInMemoryDatabase()
    const before = {
      capacities: state.opportunityCapacities.length,
      postings: state.loadPostings.length,
      slots: state.truckSlots.length
    }

    expect(() =>
      createLoadPosting(state, { ...BASE_LOAD, driverPayCents: null, status: "open" })
    ).toThrow(/pays a driver per truckload/)

    // Refused BEFORE the push: a posting that may not be published must not be
    // left lying in the document for a later reader to treat as work.
    expect(state.loadPostings).toHaveLength(before.postings)
    expect(state.truckSlots).toHaveLength(before.slots)
    expect(state.opportunityCapacities).toHaveLength(before.capacities)
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

  it("says the fee is charged on top, never out of driver pay", () => {
    const state = createInMemoryDatabase()

    // The wording is the product's only promise to a driver about this fee, so it
    // is asserted rather than left to whoever edits the string next.
    try {
      createLoadPosting(state, { ...BASE_LOAD, driverPayCents: null, status: "open" })
      throw new Error("publishing without stated pay should have been refused")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      expect(message).toContain("on top of driver pay, never out of it")
      expect(message).toContain(FEE_PERCENT)
    }
  })

  it("quotes the founder-decided rate", () => {
    // Pinned once, here, rather than as a literal inside every message
    // assertion: 5% of stated driver pay is the decided commercial term, and a
    // silent change to it should stop this suite.
    expect(FEE_PERCENT).toBe("5%")
  })
})

describe("a host may not publish work they cannot be billed for", () => {
  it.each(INVALID_CURRENT_AGREEMENT_CASES)(
    "refuses $reason before creating live work",
    ({ corrupt }) => {
      const state = createInMemoryDatabase()
      const before = {
        capacities: state.opportunityCapacities.length,
        postings: state.loadPostings.length,
        slots: state.truckSlots.length
      }

      corrupt(percentageAccountFor(state))

      expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(
        /must accept the current LogLoads fee agreement/
      )
      expect(state.loadPostings).toHaveLength(before.postings)
      expect(state.truckSlots).toHaveLength(before.slots)
      expect(state.opportunityCapacities).toHaveLength(before.capacities)
    }
  )

  it("refuses an organization with no card on file, and says what to do about it", () => {
    const state = createInMemoryDatabase()
    removeCard(state)
    const before = {
      capacities: state.opportunityCapacities.length,
      postings: state.loadPostings.length,
      slots: state.truckSlots.length
    }

    let message = ""

    try {
      createLoadPosting(state, { ...BASE_LOAD, status: "open" })
      throw new Error("publishing without a card should have been refused")
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // Useful, not merely negative: what is missing, what it costs, when it is
    // charged, and the one action that unblocks them.
    expect(message).toContain("no payment card on file")
    expect(message).toContain(FEE_PERCENT)
    expect(message).toContain("only on truckloads that actually complete")
    expect(message).toContain("Attach a card")

    expect(state.loadPostings).toHaveLength(before.postings)
    expect(state.truckSlots).toHaveLength(before.slots)
    expect(state.opportunityCapacities).toHaveLength(before.capacities)
  })

  it("publishes with the exact current agreement and an attached card", () => {
    // The positive control for the refusal above: nothing else about the input
    // changes, so the card is demonstrably the only thing that was blocking it.
    const state = createInMemoryDatabase()

    expect(billingProfileFor(state).status).toBe("attached")

    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    expect(state.loadPostings.some((entry) => entry.id === load.id)).toBe(true)
    expect(state.truckSlots.some((slot) => slot.loadPostingId === load.id)).toBe(true)
  })

  it("refuses a card that was declined, not only a missing one", () => {
    const state = createInMemoryDatabase()
    const profile = billingProfileFor(state)

    profile.status = "failed"
    profile.lastFailureAt = "2026-07-01T00:00:00.000Z"
    profile.lastFailureReason = "card_declined"

    // A row existing is not a card working. Publishing work that accrues a charge
    // against a card that has already been refused just books an unpayable bill.
    expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(/was declined/)
    expect(state.loadPostings.some((load) => load.title === BASE_LOAD.title)).toBe(false)
  })

  it("refuses when one organization has two billing profiles, instead of picking one", () => {
    const state = createInMemoryDatabase()
    const profile = billingProfileFor(state)

    // The store has no unique index, so this state is reachable. One attached and
    // one not means array order would otherwise decide whether this host can
    // publish work that will be charged to a card nobody has identified.
    state.hostBillingProfiles.push({
      ...profile,
      attachedAt: null,
      defaultPaymentMethodId: null,
      id: "34343434-3434-4434-8434-3434343434e9",
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      status: "none"
    })

    expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(
      /2 billing profiles on file/
    )
    expect(state.loadPostings.some((load) => load.title === BASE_LOAD.title)).toBe(false)
  })

  it("reads the card of the publishing organization, not of any organization", () => {
    const state = createInMemoryDatabase()
    const other = state.hostBillingProfiles.find((profile) => profile.organizationId !== HOST_ORG)

    expect(other).toBeDefined()
    expect(other?.status).toBe("attached")
    removeCard(state)

    // Another host's attached card must not publish this host's work: the lookup
    // is per organization, and a wallet-shaped check would let any one paying
    // customer unlock the whole network.
    expect(() => createLoadPosting(state, { ...BASE_LOAD, status: "open" })).toThrow(
      /no payment card on file/
    )
  })

  it("still lets a draft be saved with no card, so onboarding is not a dead end", () => {
    const state = createInMemoryDatabase()
    removeCard(state)

    // A draft is not on the network and accrues nothing, so nothing is owed for
    // it. A host can lay out work while their card is still being attached.
    const draft = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })

    expect(draft.status).toBe("draft")
    expect(state.loadPostings.some((load) => load.id === draft.id)).toBe(true)
    expect(state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(false)
  })

  it("refuses a draft published through provisionLoadCapacity with no card", () => {
    const state = createInMemoryDatabase()
    const draft = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })

    removeCard(state)

    // openDraftLoadPosting mints capacity through this function, so the gate has
    // to hold here as well as on the create path — otherwise "save a draft first"
    // is a way around it.
    expect(() => provisionLoadCapacity(state, draft, "open_network", "request_approval")).toThrow(
      /no payment card on file/
    )
    expect(state.truckSlots.some((slot) => slot.loadPostingId === draft.id)).toBe(false)
    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === draft.id)).toBe(false)
  })

  it("refuses an edit that moves a draft onto the network with no card", () => {
    const state = createInMemoryDatabase()
    const draft = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })

    removeCard(state)

    // updateLoadPosting can set a status, so it is a third door onto the network.
    // It mints no capacity, so it is not how the product publishes — it is closed
    // here so it cannot become the way around the gate.
    expect(() => updateLoadPosting(state, { id: draft.id, status: "open" })).toThrow(
      /no payment card on file/
    )
    expect(state.loadPostings.find((load) => load.id === draft.id)?.status).toBe("draft")
  })

  it("lets an ordinary edit of already-published work through", () => {
    // The negative control for the edit gate: it fires on the move onto the
    // network, not on every save, so a host with a declined card can still fix
    // the weather note on work that is already live.
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open" })

    removeCard(state)

    const updated = updateLoadPosting(state, { id: load.id, weatherNotes: "Fog through 09:00" })

    expect(updated.weatherNotes).toBe("Fog through 09:00")
    expect(updated.status).toBe("open")
  })
})
