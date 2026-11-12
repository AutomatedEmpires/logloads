import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createFirstRunHandoffCookie,
  decideExistingActorEntry,
  firstSearchValue,
  firstRunDestination,
  homePathForIntent,
  isMarketplaceV2Path,
  legacyOnboardingEntry,
  parseEntryIntent,
  readFirstRunHandoffCookie,
  safeEntryNext,
  safeFirstRunContinuation,
  V2_HAULER_START_PATH,
  V2_LANDING_START_PATH,
  V2_SETUP_RESUME_COOKIE,
  V2_SETUP_RESUME_MAX_AGE_SECONDS,
  V2_START_PATH,
  v2EntryDestination,
  v2SetupResumeCookieOptions,
  v2SetupStep
} from "./entry-routing"
import { HAULER_START_PATH, LANDING_START_PATH } from "./marketplace-v2/hauler-profile-form"
import type { SessionActor } from "./session-policy"

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

describe("public entry routing", () => {
  it("uses the first value when Next.js projects duplicate search parameters", () => {
    expect(firstSearchValue("1")).toBe("1")
    expect(firstSearchValue(["1", "0"])).toBe("1")
    expect(firstSearchValue(["0", "1"])).toBe("0")
    expect(firstSearchValue([])).toBeUndefined()
    expect(firstSearchValue(undefined)).toBeUndefined()
  })

  it("recognizes only supported role intents", () => {
    expect(parseEntryIntent("driver")).toBe("driver")
    expect(parseEntryIntent("fleet")).toBe("fleet")
    expect(parseEntryIntent("host")).toBe("host")
    expect(parseEntryIntent("admin")).toBeNull()
    expect(parseEntryIntent(["driver", "host"])).toBeNull()
    expect(parseEntryIntent(undefined)).toBeNull()
  })

  it("keeps safe continuations while rejecting external, looping, and wrong-cockpit paths", () => {
    expect(safeEntryNext("/driver/loads/abc?from=public", "driver")).toBe("/driver/loads/abc?from=public")
    expect(safeEntryNext("https://example.com/driver/loads", "driver")).toBe("")
    expect(safeEntryNext("/sign-up?path=driver", "driver")).toBe("")
    expect(safeEntryNext("/onboarding/driver", "driver")).toBe("")
    expect(safeEntryNext("/host/command", "driver")).toBe("")
    expect(safeEntryNext(["/driver/loads", "/host/command"], "driver")).toBe("")
  })

  it("routes every new account through its role-specific first-run handoff", () => {
    expect(firstRunDestination("driver")).toBe("/driver/profile?welcome=1")
    expect(firstRunDestination("fleet")).toBe("/fleet/command?welcome=1")
    expect(firstRunDestination("host")).toBe("/host/landings?welcome=1")
  })

  it("limits first-run URLs to the welcome flag without a private continuation", () => {
    for (const intent of ["driver", "fleet", "host"] as const) {
      const destination = firstRunDestination(intent)

      expect(destination).not.toContain("next")
      expect(destination.split("?").at(1)).toBe("welcome=1")
    }
  })

  it("carries only a path-only same-role continuation in a scoped cookie", () => {
    const driverCookie = createFirstRunHandoffCookie(
      "driver",
      "/driver/loads/abc?from=public#fit",
      "created",
      "user-1"
    )
    const fleetCookie = createFirstRunHandoffCookie(
      "fleet",
      "/fleet/opportunities/abc",
      "created",
      "user-1"
    )
    const hostCookie = createFirstRunHandoffCookie(
      "host",
      "/host/opportunities?draft=abc",
      "invited",
      "user-1"
    )

    expect(readFirstRunHandoffCookie("driver", driverCookie, "user-1")).toEqual({
      continuation: "/driver/loads/abc",
      source: "created"
    })
    expect(readFirstRunHandoffCookie("fleet", fleetCookie, "user-1")).toEqual({
      continuation: "/fleet/opportunities/abc",
      source: "created"
    })
    expect(readFirstRunHandoffCookie("host", hostCookie, "user-1")).toEqual({
      continuation: "/host/opportunities",
      source: "invited"
    })
    expect(driverCookie).not.toContain("from")
    expect(hostCookie).not.toContain("draft")

    for (const continuation of [
      "https://example.com/driver/loads",
      "/sign-up?path=driver",
      "/support",
      "/host/command",
      "/driver/profile?welcome=1"
    ]) {
      expect(
        readFirstRunHandoffCookie(
          "driver",
          createFirstRunHandoffCookie("driver", continuation, "created", "user-1"),
          "user-1"
        )?.continuation,
        continuation
      ).toBe("")
    }

    expect(readFirstRunHandoffCookie("host", driverCookie, "user-1")).toBeNull()
    expect(readFirstRunHandoffCookie("driver", driverCookie, "user-2")).toBeNull()
    expect(readFirstRunHandoffCookie("driver", "not-json", "user-1")).toBeNull()
  })

  it("revalidates a first-run continuation at the consuming page", () => {
    expect(
      safeFirstRunContinuation("driver", "/driver/profile", "/driver/loads/abc?from=public")
    ).toBe("/driver/loads/abc")
    expect(
      safeFirstRunContinuation("host", "/host/landings", "/host/opportunities?draft=abc")
    ).toBe("/host/opportunities")

    for (const continuation of [
      "/support",
      "/pricing",
      "/host/command",
      "/driver/profile",
      "/driver/profile/",
      "/driver/profile?welcome=0"
    ]) {
      expect(
        safeFirstRunContinuation("driver", "/driver/profile", continuation),
        continuation
      ).toBe("")
    }
  })

  it("honors driver intent for an actor whose default cockpit is Host", () => {
    const cole = actorFor("cole@summit.example")

    expect(homePathForIntent(cole, "driver")).toBe("/driver/loads")
    expect(decideExistingActorEntry(cole, { intent: "driver" })).toEqual({
      href: "/driver/loads",
      kind: "redirect"
    })
    expect(decideExistingActorEntry(cole, {
      intent: "driver",
      next: "/driver/loads/11111111-1111-4111-8111-111111111111"
    })).toEqual({
      href: "/driver/loads/11111111-1111-4111-8111-111111111111",
      kind: "redirect"
    })
  })

  it("stops transparently when the signed-in actor lacks the requested cockpit", () => {
    const cole = actorFor("cole@summit.example")
    const hostOnly = { ...cole, driverProfileId: null }

    expect(homePathForIntent(hostOnly, "driver")).toBeNull()
    expect(decideExistingActorEntry(hostOnly, { intent: "driver" })).toEqual({
      currentHome: "/host/command",
      kind: "session"
    })
    expect(decideExistingActorEntry(hostOnly, { intent: "driver", next: "/support" })).toEqual({
      currentHome: "/host/command",
      kind: "session"
    })
    expect(decideExistingActorEntry(hostOnly, {
      next: "/driver/loads/11111111-1111-4111-8111-111111111111"
    })).toEqual({
      currentHome: "/host/command",
      kind: "session"
    })
  })

  it("does not let a neutral continuation replace an explicit role destination", () => {
    const cole = actorFor("cole@summit.example")

    expect(decideExistingActorEntry(cole, { intent: "driver", next: "/support" })).toEqual({
      href: "/driver/loads",
      kind: "redirect"
    })
  })

  it("requires an explicit organization switch before opening an inactive workspace", () => {
    const dana = actorFor("dispatch@northpine.example")
    const fleetMembership = dana.memberships.find(({ organization }) =>
      organization.displayName === "North Pine Logging"
    )
    const hostMembership = dana.memberships.find(({ organization }) =>
      organization.displayName === "Summit Ridge Timber"
    )

    if (!fleetMembership || !hostMembership) {
      throw new Error("Dana's cross-organization memberships are missing")
    }

    expect(decideExistingActorEntry(dana, { intent: "host" })).toEqual({
      href: "/host/command",
      kind: "switch",
      organizationId: hostMembership.organization.id,
      organizationName: "Summit Ridge Timber"
    })
    expect(decideExistingActorEntry(dana, {
      intent: "host",
      next: "/host/command?from=public"
    })).toEqual({
      href: "/host/command?from=public",
      kind: "switch",
      organizationId: hostMembership.organization.id,
      organizationName: "Summit Ridge Timber"
    })

    const hostActive = {
      ...dana,
      activeMembership: hostMembership.membership,
      activeOrganization: hostMembership.organization
    }

    expect(decideExistingActorEntry(hostActive, { intent: "fleet" })).toEqual({
      href: "/fleet/command",
      kind: "switch",
      organizationId: fleetMembership.organization.id,
      organizationName: "North Pine Logging"
    })
  })

  it("shows active-account context for generic entry but honors an authorized next path", () => {
    const cole = actorFor("cole@summit.example")

    expect(decideExistingActorEntry(cole, {})).toEqual({
      currentHome: "/host/command",
      kind: "session"
    })
    expect(decideExistingActorEntry(cole, { next: "/support" })).toEqual({
      href: "/support",
      kind: "redirect"
    })
  })

  it("routes a deactivated provisioned identity to restriction instead of onboarding", () => {
    const active = actorFor("cole@summit.example")
    const deactivated: SessionActor = {
      ...active,
      activeMembership: null,
      activeOrganization: null,
      driverProfileId: null,
      isPlatformAdmin: false,
      memberships: [],
      profile: { ...active.profile, isActive: false }
    }

    expect(decideExistingActorEntry(deactivated, {})).toEqual({
      currentHome: "/access-restricted",
      kind: "session"
    })
  })
})

describe("Marketplace V2 entry (#246)", () => {
  it("names the same setup pages the V2 setup flow uses", () => {
    expect(V2_START_PATH).toBe("/v2/start")
    expect(V2_HAULER_START_PATH).toBe(HAULER_START_PATH)
    expect(V2_LANDING_START_PATH).toBe(LANDING_START_PATH)
  })

  it("recognizes V2 paths by whole segment", () => {
    expect(isMarketplaceV2Path("/v2")).toBe(true)
    expect(isMarketplaceV2Path("/v2/work/job-1?view=map")).toBe(true)
    expect(isMarketplaceV2Path("/v2/")).toBe(true)
    expect(isMarketplaceV2Path("/v2x")).toBe(false)
    expect(isMarketplaceV2Path("/V2/start")).toBe(false)
    expect(isMarketplaceV2Path("/driver/loads")).toBe(false)
    expect(isMarketplaceV2Path("/")).toBe(false)
  })

  it("reads the legacy onboarding entry and the role intent its path names", () => {
    expect(legacyOnboardingEntry("/onboarding")).toEqual({ intent: null })
    expect(legacyOnboardingEntry("/onboarding/")).toEqual({ intent: null })
    expect(legacyOnboardingEntry("/onboarding/driver")).toEqual({ intent: "driver" })
    expect(legacyOnboardingEntry("/onboarding/fleet")).toEqual({ intent: "fleet" })
    expect(legacyOnboardingEntry("/onboarding/host/")).toEqual({ intent: "host" })
    expect(legacyOnboardingEntry("/onboarding/admin")).toBeNull()
    expect(legacyOnboardingEntry("/onboarding/driver/extra")).toBeNull()
    expect(legacyOnboardingEntry("/onboardingx")).toBeNull()
    expect(legacyOnboardingEntry("/workspace")).toBeNull()
  })

  it("canonicalizes the setup steps a person can be on before they have a business", () => {
    expect(v2SetupStep("/v2/start")).toBe("/v2/start")
    expect(v2SetupStep("/v2/start/")).toBe("/v2/start")
    expect(v2SetupStep("/v2/start?path=hauler")).toBe("/v2/start/hauler")
    expect(v2SetupStep("/v2/start?path=landing")).toBe("/v2/start/landing")
    expect(v2SetupStep("/v2/start?path=admin")).toBe("/v2/start")
    expect(v2SetupStep("/v2/start/hauler")).toBe("/v2/start/hauler")
    expect(v2SetupStep("/v2/start/hauler?type=solo")).toBe("/v2/start/hauler?type=solo")
    expect(v2SetupStep("/v2/start/hauler?type=company")).toBe("/v2/start/hauler?type=company")
    expect(v2SetupStep("/v2/start/hauler?type=member")).toBe("/v2/start/hauler?type=member")
    expect(v2SetupStep("/v2/start/landing")).toBe("/v2/start/landing")
  })

  it("keeps only the query values a setup page reads, so a remembered step carries nothing else", () => {
    expect(v2SetupStep("/v2/start/hauler?type=boss")).toBe("/v2/start/hauler")
    expect(v2SetupStep("/v2/start/hauler?utm_source=mail&type=solo#top")).toBe("/v2/start/hauler?type=solo")
    expect(v2SetupStep("/v2/start/hauler?type=solo&type=member")).toBe("/v2/start/hauler?type=solo")
    expect(v2SetupStep("/v2/start/landing?email=person%40example.test")).toBe("/v2/start/landing")
  })

  it("is no setup step for any other page, an external or malformed value, or a non-string", () => {
    for (const value of [
      "/v2/work",
      "/v2/work/job-1",
      "/v2/hauler/profile?setup=1",
      "/v2/start/hauler/extra",
      "/v2/startx",
      "/V2/start",
      "/driver/loads",
      "/onboarding",
      "https://attacker.example/v2/start",
      "//attacker.example/v2/start",
      "/\\attacker.example",
      " /v2/start",
      `/v2/start/hauler?type=solo&pad=${"x".repeat(600)}`,
      "",
      null,
      undefined,
      ["/v2/start"],
      42
    ]) {
      expect(v2SetupStep(value)).toBe("")
    }
  })

  it("continues to a safe V2 page the person asked for before signing up", () => {
    expect(v2EntryDestination({ next: "/v2/start/hauler?type=solo" })).toBe("/v2/start/hauler?type=solo")
    expect(v2EntryDestination({ next: "/v2/work/job-1" })).toBe("/v2/work/job-1")
    // An explicit page the person asked for beats a role intent and a remembered step.
    expect(v2EntryDestination({ intent: "host", next: "/v2/work/job-1", resume: "/v2/start/landing" })).toBe("/v2/work/job-1")
  })

  it("never continues to a legacy cockpit, an entry route, an external site or an oversized path", () => {
    for (const next of [
      "/driver/loads",
      "/host/command",
      "/workspace",
      "/sign-in?next=/v2/work",
      "/onboarding?next=/v2/work",
      "https://attacker.example/v2/work",
      "//attacker.example/v2/work",
      `/v2/work?q=${"x".repeat(1100)}`
    ]) {
      expect(v2EntryDestination({ next })).toBe("/v2/start")
    }
  })

  it("starts the setup for an explicit role intent, skipping the choice it already made", () => {
    expect(v2EntryDestination({ intent: "driver" })).toBe("/v2/start/hauler")
    expect(v2EntryDestination({ intent: "fleet" })).toBe("/v2/start/hauler")
    expect(v2EntryDestination({ intent: "host" })).toBe("/v2/start/landing")
    // A current intent beats a step remembered from earlier.
    expect(v2EntryDestination({ intent: "host", resume: "/v2/start/hauler?type=solo" })).toBe("/v2/start/landing")
    // A legacy cockpit continuation is dropped, and the intent still applies.
    expect(v2EntryDestination({ intent: "driver", next: "/driver/loads" })).toBe("/v2/start/hauler")
  })

  it("resumes a remembered setup step, but only one that is still a canonical setup step", () => {
    expect(v2EntryDestination({ resume: "/v2/start/hauler?type=company" })).toBe("/v2/start/hauler?type=company")
    expect(v2EntryDestination({ resume: "/v2/start/landing" })).toBe("/v2/start/landing")
    expect(v2EntryDestination({ resume: "/v2/work/job-1" })).toBe("/v2/start")
    expect(v2EntryDestination({ resume: "https://attacker.example/v2/start" })).toBe("/v2/start")
    // The cookie only ever holds a canonical step, so anything else was not written by LogLoads.
    expect(v2EntryDestination({ resume: "/v2/start/hauler?type=solo&x=1" })).toBe("/v2/start")
    expect(v2EntryDestination({ resume: "/v2/start?path=landing" })).toBe("/v2/start")
  })

  it("lands everyone else on /v2/start", () => {
    expect(v2EntryDestination({})).toBe("/v2/start")
    expect(v2EntryDestination({ intent: null, next: null, resume: undefined })).toBe("/v2/start")
  })

  it("remembers a setup step in a short-lived HttpOnly cookie the browser's scripts cannot read", () => {
    expect(V2_SETUP_RESUME_COOKIE).toBe("ll_v2_setup")
    expect(V2_SETUP_RESUME_MAX_AGE_SECONDS).toBe(3600)
    expect(v2SetupResumeCookieOptions(false)).toEqual({ httpOnly: true, maxAge: 3600, path: "/", sameSite: "lax", secure: false })
    expect(v2SetupResumeCookieOptions(true)).toMatchObject({ httpOnly: true, secure: true })
  })
})
