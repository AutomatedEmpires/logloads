import { createInMemoryDatabase } from "@logloads/db"
import React, { type ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Where "Continue" goes for someone who opens `/sign-in` or `/sign-up` while already signed in (#378). The two
 * pages and `signedInV2Destination` are the real ones, with the real V2 flag (`LOGLOADS_MARKETPLACE_V2`) and the
 * real entry rules (`entry-routing.ts`). Only the edges are stubbed: the session, the request's cookies, the V2
 * store's answer for the home (`v2HomePathForSession`) and the screen component, whose props are what is checked.
 */

// The pages are compiled with the classic JSX runtime here, as in the other page tests.
vi.stubGlobal("React", React)

const mocks = vi.hoisted(() => ({
  actor: null as unknown,
  rememberedStep: undefined as string | undefined,
  v2HomePathForSession: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "ll_v2_setup" && mocks.rememberedStep !== undefined ? { name, value: mocks.rememberedStep } : undefined
  }))
}))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@clerk/nextjs", () => ({ SignIn: () => null, SignUp: () => null }))
vi.mock("@/components/v3", () => ({ AuthenticatedEntryPage: () => null, AuthPage: () => null }))
vi.mock("@/lib/session", async () => {
  const policy = await vi.importActual<typeof import("./session-policy")>("./session-policy")

  return {
    getSessionActor: vi.fn(async () => mocks.actor),
    homePathFor: policy.homePathFor,
    isClerkConfigured: () => false,
    isFounderDemoMode: async () => false
  }
})
vi.mock("@/lib/marketplace-v2/home", () => ({ v2HomePathForSession: mocks.v2HomePathForSession }))

import SignInPage from "@/app/sign-in/page"
import SignUpPage from "@/app/sign-up/page"

import type { SessionActor } from "./session-policy"
import { signedInV2Destination } from "./signed-in-entry"

const state = createInMemoryDatabase()

function actorFor(email: string): SessionActor {
  const profile = state.profiles.find((candidate) => candidate.email === email)

  if (!profile) throw new Error(`Missing seeded profile: ${email}`)

  const memberships = state.organizationMemberships
    .filter((membership) => membership.userId === profile.id && membership.status === "active")
    .flatMap((membership) => {
      const organization = state.organizations.find((candidate) => candidate.id === membership.organizationId)

      return organization ? [{ membership, organization }] : []
    })
  const active = memberships[0] ?? null
  const driverProfile = state.driverProfiles.find((candidate) => candidate.userId === profile.id)

  return {
    activeMembership: active?.membership ?? null,
    activeOrganization: active?.organization ?? null,
    driverProfileId: driverProfile?.id ?? null,
    isPlatformAdmin: profile.role === "admin",
    memberships,
    profile,
    workspaceSelectionInvalid: false
  }
}

/** A landing (host) owner on the pilot: the legacy home is the host cockpit, and the fleet cockpit is closed to it. */
const host = actorFor("cole@summit.example")
const admin: SessionActor = { ...host, isPlatformAdmin: true }
const LEGACY_HOME = "/host/command"

/** Targets that must never become a link: another origin, however it is spelled, and the entry pages themselves. */
const UNSAFE_NEXT = [
  "https://evil.example/v2/work",
  "//evil.example/v2/work",
  "/\\evil.example/v2/work",
  "/%2Fevil.example/v2/work",
  "/%5Cevil.example/v2/work",
  "javascript:alert(1)",
  " /v2/work",
  "/v2/work\n",
  "/sign-in?next=/v2/work"
] as const

interface EntryProps {
  currentHome: string
  intent?: string | null
  mode: string
  requestedHome?: string | null
  requestedOrganization?: { id: string; name: string } | null
  restartHref: string
}

async function signIn(query: { next?: string } = {}): Promise<EntryProps> {
  return ((await SignInPage({ searchParams: Promise.resolve(query) })) as ReactElement<EntryProps>).props
}

async function signUp(query: { next?: string; path?: string } = {}): Promise<EntryProps> {
  return ((await SignUpPage({ searchParams: Promise.resolve(query) })) as ReactElement<EntryProps>).props
}

function v2(on: boolean) {
  vi.stubEnv("LOGLOADS_MARKETPLACE_V2", on ? "enabled" : "")
  vi.stubEnv("VERCEL_ENV", "preview")
}

beforeEach(() => {
  mocks.actor = host
  mocks.rememberedStep = undefined
  mocks.v2HomePathForSession.mockReset()
  mocks.v2HomePathForSession.mockResolvedValue("/v2/work")
  v2(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("signedInV2Destination", () => {
  it("has no V2 destination while V2 is off, and does not read the V2 store", async () => {
    v2(false)
    mocks.rememberedStep = "/v2/start/hauler"

    expect(await signedInV2Destination(host, "/v2/work/job-1")).toBeNull()
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("has no V2 destination on a production deployment, even with the flag set", async () => {
    vi.stubEnv("VERCEL_ENV", "production")

    expect(await signedInV2Destination(host, "/v2/work/job-1")).toBeNull()
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("keeps a platform administrator on the legacy home", async () => {
    mocks.rememberedStep = "/v2/start/hauler"

    expect(await signedInV2Destination(admin, "/v2/work/job-1")).toBeNull()
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("continues to a safe V2 next first", async () => {
    mocks.rememberedStep = "/v2/start/landing"

    expect(await signedInV2Destination(host, "/v2/work/job-1?from=share")).toBe("/v2/work/job-1?from=share")
  })

  it("then to the remembered setup step", async () => {
    mocks.rememberedStep = "/v2/start/hauler?type=company"

    expect(await signedInV2Destination(host, undefined)).toBe("/v2/start/hauler?type=company")
    expect(await signedInV2Destination(host, "/driver/loads")).toBe("/v2/start/hauler?type=company")
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("then to the V2 home, which is /v2/start for an account with no business", async () => {
    expect(await signedInV2Destination(host, undefined)).toBe("/v2/work")

    mocks.v2HomePathForSession.mockResolvedValue("/v2/start")

    expect(await signedInV2Destination(host, undefined)).toBe("/v2/start")
    expect(mocks.v2HomePathForSession).toHaveBeenLastCalledWith(host)
  })

  it("has no V2 destination when V2 has no home for the account", async () => {
    mocks.v2HomePathForSession.mockResolvedValue(null)

    expect(await signedInV2Destination(host, undefined)).toBeNull()
  })

  it("drops a legacy cockpit next: V2 never sends anyone to one", async () => {
    expect(await signedInV2Destination(host, "/driver/loads")).toBe("/v2/work")
    expect(await signedInV2Destination(host, "/v2work")).toBe("/v2/work")
  })

  it.each(UNSAFE_NEXT)("never continues to %j", async (next) => {
    expect(await signedInV2Destination(host, next)).toBe("/v2/work")
  })

  it.each([
    "https://evil.example/v2/start",
    "//evil.example/v2/start",
    "/v2/work/job-1",
    "/v2/start/hauler?type=evil",
    "/v2/start/hauler?type=solo&next=//evil.example",
    "/v2/start/",
    ""
  ])("ignores a remembered step LogLoads did not write: %j", async (remembered) => {
    mocks.rememberedStep = remembered

    expect(await signedInV2Destination(host, undefined)).toBe("/v2/work")
  })

  it("ignores a next that is not one string", async () => {
    expect(await signedInV2Destination(host, ["/v2/work/job-1", "https://evil.example"])).toBe("/v2/work")
    expect(await signedInV2Destination(host, null)).toBe("/v2/work")
  })
})

describe("/sign-in for someone already signed in", () => {
  it("keeps the legacy home while V2 is off", async () => {
    v2(false)
    mocks.rememberedStep = "/v2/start/hauler"

    expect(await signIn()).toMatchObject({ currentHome: LEGACY_HOME, mode: "sign-in", restartHref: "/sign-in" })
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("continues to the V2 home while V2 is on", async () => {
    expect(await signIn()).toMatchObject({ currentHome: "/v2/work", mode: "sign-in", restartHref: "/sign-in" })
  })

  it("continues to the remembered setup step", async () => {
    mocks.rememberedStep = "/v2/start/landing"

    expect((await signIn()).currentHome).toBe("/v2/start/landing")
  })

  it("continues to the V2 home instead of a legacy cockpit the account cannot open", async () => {
    const props = await signIn({ next: "/fleet/command" })

    expect(props.currentHome).toBe("/v2/work")
    expect(props.restartHref).toBe("/sign-in?next=%2Ffleet%2Fcommand")
  })

  it("keeps the legacy home when V2 has no home for the account", async () => {
    mocks.v2HomePathForSession.mockResolvedValue(null)

    expect((await signIn()).currentHome).toBe(LEGACY_HOME)
  })

  it("keeps a platform administrator on the legacy home", async () => {
    mocks.actor = admin

    expect((await signIn()).currentHome).toBe("/admin")
  })

  it("still goes straight to a safe next, as before", async () => {
    await expect(signIn({ next: "/v2/work/job-1" })).rejects.toThrow("NEXT_REDIRECT /v2/work/job-1")
  })

  it.each(UNSAFE_NEXT)("never redirects or links to %j", async (next) => {
    const props = await signIn({ next })

    expect(props.currentHome).toBe("/v2/work")
    expect(props.restartHref).toBe("/sign-in")
  })
})

describe("/sign-up for someone already signed in", () => {
  it("keeps the legacy screen while V2 is off", async () => {
    v2(false)
    mocks.rememberedStep = "/v2/start/hauler"

    expect(await signUp({ path: "host" })).toMatchObject({
      currentHome: LEGACY_HOME,
      intent: "host",
      mode: "sign-up",
      requestedHome: "/host/command",
      requestedOrganization: null,
      restartHref: "/sign-up?path=host"
    })
    expect(await signUp()).toMatchObject({ currentHome: LEGACY_HOME, intent: null, requestedHome: null, restartHref: "/sign-up" })
    expect(mocks.v2HomePathForSession).not.toHaveBeenCalled()
  })

  it("continues to the V2 home while V2 is on", async () => {
    expect(await signUp()).toMatchObject({
      currentHome: "/v2/work",
      intent: null,
      mode: "sign-up",
      requestedHome: null,
      requestedOrganization: null,
      restartHref: "/sign-up"
    })
  })

  it("offers no legacy cockpit for a role intent while V2 is on", async () => {
    expect(await signUp({ path: "host" })).toMatchObject({
      currentHome: "/v2/work",
      intent: null,
      requestedHome: null,
      requestedOrganization: null,
      restartHref: "/sign-up?path=host"
    })
    expect(await signUp({ next: "/host/command", path: "host" })).toMatchObject({
      currentHome: "/v2/work",
      intent: null,
      requestedHome: null,
      requestedOrganization: null
    })
  })

  it("continues to a safe V2 next, then the remembered setup step", async () => {
    mocks.rememberedStep = "/v2/start/hauler?type=solo"

    expect((await signUp({ next: "/v2/work/job-1" })).currentHome).toBe("/v2/work/job-1")
    expect((await signUp()).currentHome).toBe("/v2/start/hauler?type=solo")
  })

  it("keeps the legacy screen when V2 has no home for the account", async () => {
    mocks.v2HomePathForSession.mockResolvedValue(null)

    expect(await signUp({ path: "host" })).toMatchObject({
      currentHome: LEGACY_HOME,
      intent: "host",
      requestedHome: "/host/command"
    })
  })

  it.each(UNSAFE_NEXT)("never links to %j", async (next) => {
    const props = await signUp({ next })

    expect(props.currentHome).toBe("/v2/work")
    expect(props.requestedHome).toBeNull()
    expect(props.restartHref).toBe("/sign-up")
  })
})
