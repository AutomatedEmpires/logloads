import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { MarketplaceCalls, MarketplaceDb, MarketplaceIdentitySync, MarketplacePrincipal } from "./normalized-db"
import { createNormalizedSessionStore, EMAIL_REFRESH_INTERVAL_MS, EMAIL_REFRESH_MEMORY } from "./normalized-session"
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
/** The verified address the store holds for the person (`user_contacts`), as `VIEWER_PERSON` reads it. */
let storedEmail: string | null
let reads: Array<{ principal: MarketplacePrincipal; readOnly: boolean | undefined }>

function db(): MarketplaceDb {
  return {
    asAnon: async () => {
      throw new Error("a session is never read anonymously")
    },
    async asUser(principal, work, options) {
      reads.push({ principal, readOnly: options?.readOnly })
      const calls = {
        viewerSession: async () =>
          (linked ? { memberships: [membershipRow], person: { ...personRow, email: storedEmail } } : { memberships: [], person: null })
      } as unknown as MarketplaceCalls

      return work(calls)
    },
    close: async () => undefined
  }
}

/** `sync_verified_identity`: links the subject and records a verified address. */
function sync(link: MarketplaceIdentitySync["link"] = async (identity) => {
  linked = true
  storedEmail = identity.emailVerified && identity.email ? identity.email : storedEmail
  return PERSON
}): MarketplaceIdentitySync & { link: ReturnType<typeof vi.fn> } {
  return { close: async () => undefined, link: vi.fn(link) }
}

const providerHints = async () => ({ fullName: "Rae Ridge", verifiedEmail: "rae@example.test" as string | null })
const hints = vi.fn(providerHints)

beforeEach(() => {
  linked = true
  storedEmail = "rae@example.test"
  reads = []
  hints.mockReset()
  hints.mockImplementation(providerHints)
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

  it("asks the provider once when a first link fails", async () => {
    linked = false
    const link = sync(async () => {
      throw new MarketplaceRefusalError("This changed while you were working on it.", "23505")
    })

    await expect(createNormalizedSessionStore({ db: db(), identity: IDENTITY, log: () => undefined, sync: link }).resolve({ hints, subject: SUBJECT }))
      .resolves.toBeNull()
    expect(hints).toHaveBeenCalledOnce()
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

describe("a verified email that arrives after the first link (#246)", () => {
  let clock: number
  const now = () => clock

  beforeEach(() => {
    clock = 1_000_000
    storedEmail = null
  })

  it("records it through sync_verified_identity on the next sign-in, so invitations to that address can be claimed", async () => {
    const link = sync()

    const resolved = await createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link }).resolve({ hints, subject: SUBJECT })

    expect(link.link).toHaveBeenCalledExactlyOnceWith({
      displayName: "Rae Ridge",
      email: "rae@example.test",
      emailVerified: true,
      issuer: IDENTITY.issuer,
      subject: SUBJECT
    })
    expect(resolved?.person).toEqual({ displayName: "Rae Ridge", email: "rae@example.test", id: PERSON })
    expect(reads).toHaveLength(2)
    expect(reads.every((read) => read.readOnly === true)).toBe(true)
  })

  it("writes nothing while the provider still has no verified address, and asks it again only after the interval", async () => {
    const link = sync()
    const store = createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link })
    hints.mockResolvedValue({ fullName: "Rae Ridge", verifiedEmail: null })

    await expect(store.resolve({ hints, subject: SUBJECT })).resolves.toMatchObject({ person: { email: null, id: PERSON } })
    expect(hints).toHaveBeenCalledOnce()
    expect(link.link).not.toHaveBeenCalled()
    expect(reads).toHaveLength(1)

    // Within the interval the session is read as it is, without a provider call.
    clock += EMAIL_REFRESH_INTERVAL_MS - 1
    await store.resolve({ hints, subject: SUBJECT })
    expect(hints).toHaveBeenCalledOnce()

    // After it, the provider is asked again, and a newly verified address is recorded.
    clock += 1
    hints.mockResolvedValue({ fullName: "Rae Ridge", verifiedEmail: "rae@example.test" })
    await expect(store.resolve({ hints, subject: SUBJECT })).resolves.toMatchObject({ person: { email: "rae@example.test" } })
    expect(hints).toHaveBeenCalledTimes(2)
    expect(link.link).toHaveBeenCalledOnce()
  })

  it("spaces out the refresh per person, not for everyone", async () => {
    const link = sync(async () => PERSON)
    const store = createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link })

    await store.resolve({ hints, subject: SUBJECT })
    await store.resolve({ hints, subject: "user_test_second_person" })
    expect(link.link).toHaveBeenCalledTimes(2)
    expect(link.link.mock.calls.map(([identity]) => identity.subject)).toEqual([SUBJECT, "user_test_second_person"])
  })

  it("keeps the session it read when recording the address fails, and logs no identifier", async () => {
    const log = vi.fn()
    const link = sync(async () => {
      throw new MarketplaceStoreError()
    })

    const resolved = await createNormalizedSessionStore({ db: db(), identity: IDENTITY, log, now, sync: link }).resolve({ hints, subject: SUBJECT })

    expect(resolved?.person).toEqual({ displayName: "Rae Ridge", email: null, id: PERSON })
    expect(log).toHaveBeenCalledExactlyOnceWith("normalized identity email refresh failed", expect.any(MarketplaceStoreError))
    expect(JSON.stringify(log.mock.calls)).not.toContain(SUBJECT)
  })

  it("fails closed on an unsafe identity-sync credential, as the first link does", async () => {
    const link = sync(async () => {
      throw new MarketplaceAdapterConfigurationError("The normalized identity link connection is refused")
    })

    await expect(createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link }).resolve({ hints, subject: SUBJECT }))
      .rejects.toBeInstanceOf(MarketplaceAdapterConfigurationError)
  })

  it("never asks the provider without an identity-sync connection, or for a person whose address is already verified", async () => {
    await expect(createNormalizedSessionStore({ db: db(), identity: IDENTITY, now }).resolve({ hints, subject: SUBJECT }))
      .resolves.toMatchObject({ person: { email: null } })

    storedEmail = "rae@example.test"
    const link = sync()
    await createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link }).resolve({ hints, subject: SUBJECT })

    expect(hints).not.toHaveBeenCalled()
    expect(link.link).not.toHaveBeenCalled()
  })

  it("remembers a bounded number of people, so memory stays flat however many sign in", async () => {
    const link = sync(async () => PERSON)
    const store = createNormalizedSessionStore({ db: db(), identity: IDENTITY, now, sync: link })

    for (let index = 0; index <= EMAIL_REFRESH_MEMORY; index += 1) {
      await store.resolve({ hints, subject: `user_test_${index}` })
    }

    // The oldest person was forgotten to make room, so they are asked again; the newest is still remembered.
    await store.resolve({ hints, subject: "user_test_0" })
    await store.resolve({ hints, subject: `user_test_${EMAIL_REFRESH_MEMORY}` })
    expect(link.link).toHaveBeenCalledTimes(EMAIL_REFRESH_MEMORY + 2)
  })
})
