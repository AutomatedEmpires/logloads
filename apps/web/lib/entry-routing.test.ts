import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createFirstRunHandoffCookie,
  decideExistingActorEntry,
  firstSearchValue,
  firstRunDestination,
  homePathForIntent,
  parseEntryIntent,
  readFirstRunHandoffCookie,
  safeEntryNext,
  safeFirstRunContinuation
} from "./entry-routing"
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
