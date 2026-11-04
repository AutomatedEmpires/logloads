import type { MarketplaceCapability } from "@logloads/contracts"
import type { NavItem, WorkspaceKind } from "@logloads/ui/layout"

/** Every V2 preview destination, in display order. Which ones a context sees comes from `v2NavigationFor`. */
export const V2_NAVIGATION: readonly NavItem[] = Object.freeze([
  { href: "/v2/work", icon: "nav.loads", id: "work", label: "Find work" },
  { href: "/v2/inquiries", icon: "nav.messages", id: "inquiries", label: "My inquiries" },
  { href: "/v2/hauler/trucks", icon: "truck.log", id: "hauler-trucks", label: "My trucks" },
  { href: "/v2/hauler/profile", icon: "nav.profile", id: "hauler-profile", label: "Profile" },
  { href: "/v2/landing/inquiries", icon: "nav.landing", id: "landing-inquiries", label: "Landing inbox" },
  { href: "/v2/landing/jobs", icon: "ops.document", id: "landing-jobs", label: "Post jobs" },
  { href: "/v2/landing/landings", icon: "map.landing", id: "landings", label: "Landings" }
])

/**
 * The capability a destination needs (#124). `null` marks the public job board. Hiding an item is a
 * convenience only: every page still resolves the viewer on the server and refuses what the role cannot do.
 */
const NAV_CAPABILITY: Readonly<Record<string, MarketplaceCapability | null>> = Object.freeze({
  "hauler-profile": "interest.express",
  "hauler-trucks": "interest.express",
  "inquiries": "interest.express",
  "landing-inquiries": "inquiry.respond",
  "landing-jobs": "job.publish",
  "landings": "job.publish",
  "work": null
})

/**
 * Destinations a business that is both a hauling and a landing business does not get in its navigation, so it stays
 * within the five bottom tabs (#124). Its profile is still one link away, from My trucks and the Find work checklist;
 * Landings is linked from the landing overview (#133).
 */
const ONE_SIDED_ONLY: ReadonlySet<string> = new Set(["hauler-profile", "landings"])

export function hasHaulerSide(capabilities: readonly MarketplaceCapability[]): boolean {
  return capabilities.includes("interest.express")
}

export function hasLandingSide(capabilities: readonly MarketplaceCapability[]): boolean {
  return capabilities.includes("inquiry.respond") || capabilities.includes("job.publish")
}

/**
 * Navigation for the active context. `null` means a visitor or an account with no usable business, which
 * sees the public board only. A landing-only business gets the landing set; a hauling business gets the
 * hauler set; a business that is both gets both.
 */
export function v2NavigationFor(
  capabilities: readonly MarketplaceCapability[] | null,
  counts: Readonly<Partial<Record<string, number>>> = {}
): NavItem[] {
  if (!capabilities) {
    return V2_NAVIGATION.filter((item) => NAV_CAPABILITY[item.id] === null)
  }

  const landingOnly = hasLandingSide(capabilities) && !hasHaulerSide(capabilities)
  const bothSides = hasLandingSide(capabilities) && hasHaulerSide(capabilities)

  return V2_NAVIGATION.filter((item) => {
    const needed = NAV_CAPABILITY[item.id]
    if (bothSides && ONE_SIDED_ONLY.has(item.id)) return false
    return needed === null ? !landingOnly : needed !== undefined && capabilities.includes(needed)
  }).map((item) => {
    // UX-09 (#132): unread inquiries per destination (`inquiries.ts`); a zero shows no badge.
    const count = counts[item.id]
    return count && count > 0 ? { ...item, count } : item
  })
}

/** The V2 home for a business with these capabilities: landing-only businesses start on the landing overview. */
export function v2HomePathFor(capabilities: readonly MarketplaceCapability[]): string {
  return hasLandingSide(capabilities) && !hasHaulerSide(capabilities) ? "/v2/landing" : "/v2/work"
}

/** The destination a path belongs to: the longest item href that equals the path or is a parent segment of it. */
export function activeV2NavId(pathname: string | null, items: readonly NavItem[] = V2_NAVIGATION): string {
  if (!pathname) return ""

  const matches = items.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
  const best = matches.reduce<NavItem | null>((longest, item) => (!longest || item.href.length > longest.href.length ? item : longest), null)

  return best?.id ?? ""
}

/** Landing pages live under /v2/landing; every other V2 page is a hauler page. */
export function v2WorkspaceFor(pathname: string | null): WorkspaceKind {
  return pathname === "/v2/landing" || pathname?.startsWith("/v2/landing/") ? "landing" : "hauler"
}

/** The workspace kind: a one-sided business is always that side; otherwise the current path decides. */
export function v2WorkspaceForContext(capabilities: readonly MarketplaceCapability[] | null, pathname: string | null): WorkspaceKind {
  if (capabilities && hasLandingSide(capabilities) !== hasHaulerSide(capabilities)) {
    return hasLandingSide(capabilities) ? "landing" : "hauler"
  }

  return v2WorkspaceFor(pathname)
}
