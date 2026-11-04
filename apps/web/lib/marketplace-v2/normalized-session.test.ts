import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceCalls, MarketplaceDb, MarketplaceIdentitySync, MarketplacePrincipal } from "./normalized-db"
import { createNormalizedSessionStore } from "./normalized-session"
import { MarketplaceAdapterConfigurationError, MarketplaceRefusalError, MarketplaceStoreError } from "./port"

const IDENTITY = { audience: "logloads-test-audience", issuer: "https://clerk.logloads.test" }
const SUBJECT = "user_test_newcomer"
const PERSON = "abababab-abab-4bab-8bab-abababababab"
const LANDING = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"

const personRow = { display_name: "Rae Ridge", email: "rae@example.test", id: PERSON }
const membershipRow = {
  capabilities: ["job.publish", "landing.manage", "inquiry.respond", "not.a.capability"],
  hauler_profile: false,
  landing_workspace_seat: true,
  organization_id: LANDING,
  organization_name: "Ridge Landing Co.",
  role: "owner"
}

let linked: boolean
let reads: Array<{ principal: MarketplacePrincipal; readOnly: boolean | undefined }>

function db(): MarketplaceDb {
  return {
    asAnon: async () => {
      throw new Error("a session is never read anonymously")
    },
    async asUser(principal, work, options) {
      reads.push({ principal, readOnly: options?.readOnly })
      const calls = {
        viewerSession: async () => (linked ? { memberships: [membershipRow], person: personRow } : { memberships: [], person: null })
      } as unknown as MarketplaceCalls

      return work(calls)
    },
    close: async () => undefined
  }
}

function sync(link: MarketplaceIdentitySync["link"] = async () => {
  linked = true
  return PERSON
}): MarketplaceIdentitySync & { link: ReturnType<typeof vi.fn> } {
  return { close: async () => undefined, link: vi.fn(link) }
}

const hints = vi.fn(async () => ({ fullName: "Rae Ridge", verifiedEmail: "rae@example.test" as string | null }))

beforeEach(() => {
  linked = true
  reads = []
  hints.mockClear()
})

describe("createNormalizedSessionStore (#213)", () => {
  it("reads the person and their memberships as that person, read-only, with the configured issuer and audience", async () => {
    const store = createNormalizedSessionStore({ db: db(), identity: IDENTITY })

    await expect(store.resolve({ hints, subject: SUBJECT })).resolves.toEqual({
      memberships: [{
        capabilities: ["job.publish", "landing.manage", "inquiry.respond"],
        haulerProfile: false,
        organizationId: LANDING,
        organizationName: "Ridge Landing Co.",
        role: "owner"
      }],
      person: { displayName: "Rae Ridge", email: "rae@example.test", id: PERSON }
    })
    expect(reads).toEqual([{ principal: { ...IDENTITY, subject: SUBJECT }, readOnly: true }])
    expect(hints).not.toHaveBeenCalled()
  })

  it("never links a person who is already linked", async () => {
    const link = sync()

    await createNormalizedSessionStore({ db: db(), identity: IDENTITY, sync: link }).resolve({ hints, subject: SUBJECT })
    expect(link.link).not.toHaveBeenCalled()
  })

  it("links a first sign-in through sync_verified_identity with the session's subject, then reads them", async () => {
    linked = false
    const link = sync()

    const resolved = await createNormalizedSessionStore({ db: db(), identity: IDENTITY, sync: link }).resolve({ hints, subject: SUBJECT })

    expect(link.link).toHaveBeenCalledExactlyOnceWith({
      displayName: "Rae Ridge",
      email: "rae@example.test",
      emailVerified: true,
      issuer: IDENTITY.issuer,
      subject: SUBJECT
    })
    expect(resolved?.person.id).toBe(PERSON)
    expect(reads).toHaveLength(2)
  })

  it("links without an email when the provider has not verified one", async () => {
    linked = false
    const link = sync()
    hints.mockResolvedValueOnce({ fullName: "Dev Persona", verifiedEmail: null })

    await createNormalizedSessionStore({ db: db(), identity: IDENTITY, sync: link }).resolve({ hints, subject: SUBJECT })
    expect(link.link).toHaveBeenCalledWith(expect.objectContaining({ email: null, emailVerified: false }))
  })

  it("writes nothing and resolves no one when linking is not configured", async () => {
    linked = false
    const store = createNormalizedSessionStore({ db: db(), identity: IDENTITY })

    expect(store.canLink).toBe(false)
    await expect(store.resolve({ hints, subject: SUBJECT })).resolves.toBeNull()
    expect(hints).not.toHaveBeenCalled()
  })

  it("reads again after a failed link, so a request that lost a first-sign-in race still finds the person", async () => {
    linked = false
    const log = vi.fn()
    const link = sync(async () => {
      linked = true // the other request's link committed first
      throw new MarketplaceRefusalError("This changed while you were working on it.", "23505")
    })

    const resolved = await createNormalizedSessionStore({ db: db(), identity: IDENTITY, log, sync: link }).resolve({ hints, subject: SUBJECT })

    expect(resolved?.person.id).toBe(PERSON)
    expect(log).toHaveBeenCalledOnce()
  })

  it("resolves no one when the person stays unresolvable after linking (for example, suspended)", async () => {
    linked = false
    const link = sync(async () => PERSON)

    await expect(createNormalizedSessionStore({ db: db(), identity: IDENTITY, log: () => undefined, sync: link }).resolve({ hints, subject: SUBJECT }))
      .resolves.toBeNull()
  })

  it("fails closed on an unsafe identity-sync credential", async () => {
    linked = false
    const link = sync(async () => {
      throw new MarketplaceAdapterConfigurationError("The normalized identity link connection is refused")
    })

    await expect(createNormalizedSessionStore({ db: db(), identity: IDENTITY, sync: link }).resolve({ hints, subject: SUBJECT }))
      .rejects.toBeInstanceOf(MarketplaceAdapterConfigurationError)
  })

  it("refuses a membership row with a role outside the schema's four", async () => {
    const drifted: MarketplaceDb = {
      ...db(),
      asUser: async (_principal, work) =>
        work({ viewerSession: async () => ({ memberships: [{ ...membershipRow, role: "dispatcher" }], person: personRow }) } as unknown as MarketplaceCalls)
    }

    await expect(createNormalizedSessionStore({ db: drifted, identity: IDENTITY }).resolve({ hints, subject: SUBJECT }))
      .rejects.toBeInstanceOf(MarketplaceStoreError)
  })
})
