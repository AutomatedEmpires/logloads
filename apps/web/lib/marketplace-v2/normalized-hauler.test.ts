import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HAULER_IDENTITY_EDIT_REFUSED, HAULER_PROFILE_EDIT_REFUSED, HAULER_PROFILE_NOT_HAULING } from "@logloads/services"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import type { MarketplaceCalls, MarketplaceDb } from "./normalized-db"
import { haulerProfileFromRow } from "./normalized-hauler"
import { MARKETPLACE_QUERIES, marketplaceQueryStatement } from "./normalized-queries"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Viewer } from "./port"

/**
 * The hauling business profile (#125) over a recording fake of the store: what the adapter checks before anything
 * is written, and the order of its statements. The SQL itself runs against PostgreSQL 17 in
 * `normalized-hauler.contract.test.ts` (CI).
 */

const HAUL = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const viewer: MarketplaceV2Viewer = { organizationId: HAUL, userId: USER }

function row(overrides: Record<string, unknown> = {}) {
  return {
    accepts_targeted_invitations: false, base_area_label: "Sweet Home, OR", can_edit_identity: true, can_edit_profile: true,
    description: null, display_name: "Ridgeline Hauling", is_public: false, legal_name: "Ridgeline Hauling LLC",
    org_id: HAUL, service_radius_miles: 100, updated_at: "2026-11-03T11:00:00+00:00", verification_status: "unverified",
    verified_at: null, ...overrides
  }
}

const form = {
  about: "",
  acceptsInvitations: false,
  businessName: "Ridgeline Hauling",
  homeBase: "Sweet Home, OR",
  legalName: "Ridgeline Hauling LLC",
  listed: false,
  serviceRadiusMiles: 100
}

let statements: Array<{ name: string; values: readonly unknown[]; readOnly?: boolean }>
let profileRows: unknown[][]
let updateRows: Record<string, unknown[]>

function fakeDb(): MarketplaceDb {
  const calls = (readOnly?: boolean): MarketplaceCalls => ({
    call: async () => [],
    inquiryParties: async () => null,
    async query(name, values) {
      statements.push({ name, readOnly, values })
      if (name === "hauler_profile") return profileRows.shift() ?? []
      return updateRows[name] ?? []
    }
  })

  return {
    asAnon: (work) => work(calls(true)),
    asUser: (_principal, work, options) => work(calls(options?.readOnly !== false)),
    close: async () => undefined
  }
}

const port = () => createNormalizedMarketplaceV2({ db: fakeDb(), principal: async () => ({ audience: "aud", issuer: "https://issuer.test", subject: "user_x" }) })

beforeEach(() => {
  statements = []
  profileRows = []
  updateRows = { hauler_profile_update: [{ org_id: HAUL }], organization_identity_update: [{ id: HAUL }] }
})

describe("haulerProfile", () => {
  it("reads the active business's profile in a read-only transaction", async () => {
    profileRows = [[row()]]

    await expect(port().haulerProfile(viewer)).resolves.toMatchObject({ businessName: "Ridgeline Hauling", homeBase: "Sweet Home, OR", organizationId: HAUL })
    expect(statements).toEqual([{ name: "hauler_profile", readOnly: true, values: [HAUL] }])
  })

  it("refuses when the person is not a member or the business has no hauler profile (no row)", async () => {
    await expect(port().haulerProfile(viewer)).rejects.toThrow(HAULER_PROFILE_NOT_HAULING)
  })

  it("refuses a viewer with a malformed business id before reaching the store", async () => {
    await expect(port().haulerProfile({ organizationId: "not-a-uuid", userId: USER })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(statements).toEqual([])
  })
})

describe("saveHaulerProfile", () => {
  it("re-validates the input and refuses an address as the home base before any statement", async () => {
    await expect(port().saveHaulerProfile(viewer, { ...form, homeBase: "4417 Spur Road" })).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(statements).toEqual([])
  })

  it("writes only the profile when the business name and legal name are unchanged", async () => {
    profileRows = [[row()], [row({ base_area_label: "97386" })]]

    await expect(port().saveHaulerProfile(viewer, { ...form, homeBase: "97386" })).resolves.toMatchObject({ homeBase: "97386" })
    expect(statements.map((statement) => statement.name)).toEqual(["hauler_profile", "hauler_profile_update", "hauler_profile"])
    expect(statements[1]).toEqual({ name: "hauler_profile_update", readOnly: false, values: [HAUL, "97386", 100, null, false, false, null, null] })
  })

  it("writes the home base's place-list point as the service point", async () => {
    profileRows = [[row()], [row()]]

    await port().saveHaulerProfile(viewer, { ...form, homeBasePoint: { lat: 44.4, lng: -122.7 } })
    expect(statements[1]?.values.slice(-2)).toEqual([44.4, -122.7])
  })

  it("writes the organization first when the owner renames the business", async () => {
    profileRows = [[row()], [row({ display_name: "Ridgeline Timber Hauling" })]]

    await port().saveHaulerProfile(viewer, { ...form, businessName: "Ridgeline Timber Hauling" })
    expect(statements.map((statement) => statement.name)).toEqual(["hauler_profile", "organization_identity_update", "hauler_profile_update", "hauler_profile"])
  })

  it("refuses a manager's rename and a driver's edit with the shared rule's message, writing nothing", async () => {
    profileRows = [[row({ can_edit_identity: false })]]
    await expect(port().saveHaulerProfile(viewer, { ...form, legalName: "Other LLC" })).rejects.toThrow(HAULER_IDENTITY_EDIT_REFUSED)

    profileRows = [[row({ can_edit_identity: false, can_edit_profile: false })]]
    await expect(port().saveHaulerProfile(viewer, form)).rejects.toThrow(HAULER_PROFILE_EDIT_REFUSED)
    expect(statements.filter((statement) => statement.name !== "hauler_profile")).toEqual([])
  })

  it("treats an update that row-level security filtered out as a refusal, never as saved", async () => {
    profileRows = [[row()]]
    updateRows.hauler_profile_update = []

    await expect(port().saveHaulerProfile(viewer, form)).rejects.toThrow(HAULER_PROFILE_EDIT_REFUSED)
  })
})

describe("haulerProfileFromRow", () => {
  it("claims business identity only for a verified business, with the review date", () => {
    expect(haulerProfileFromRow(row()).verification).toBeNull()
    expect(haulerProfileFromRow(row({ verification_status: "verified", verified_at: "2026-10-12T09:00:00+00:00" })).verification).toEqual({
      reviewedOn: "2026-10-12",
      scope: "business_identity"
    })
  })

  it("fails loudly on a row that drifted from the SQL", () => {
    expect(() => haulerProfileFromRow({ ...row(), is_public: "yes" })).toThrow(MarketplaceStoreError)
  })
})

describe("marketplaceQueryStatement", () => {
  it("binds every value as text and refuses a value of the wrong type or count", () => {
    expect(marketplaceQueryStatement("hauler_profile", [HAUL])).toEqual({ text: MARKETPLACE_QUERIES.hauler_profile.text, values: [HAUL] })
    expect(marketplaceQueryStatement("hauler_profile_update", [HAUL, null, 100, null, true, false, 44.4, -122.7]).values).toEqual([
      HAUL, null, "100", null, "true", "false", "44.4", "-122.7"
    ])
    expect(() => marketplaceQueryStatement("hauler_profile", ["x'; drop table marketplace.organizations; --"])).toThrow(TypeError)
    expect(() => marketplaceQueryStatement("hauler_profile", [])).toThrow(TypeError)
    expect(() => marketplaceQueryStatement("nope" as never, [])).toThrow(TypeError)
  })

  it("schema-qualifies every table and checks the person's role in the named business", () => {
    for (const { text } of Object.values(MARKETPLACE_QUERIES)) {
      expect(text).toMatch(/marketplace\.has_org_role\(/)
      expect(text).not.toMatch(/\b(update|join)\s+(?!marketplace\.)/i)
    }
  })
})
