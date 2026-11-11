import type {
  MarketplaceAdminAccess,
  MarketplaceCapability,
  MarketplaceFeatureCapability,
  MarketplaceV2Feature,
  MarketplaceV2FeatureSupport
} from "@logloads/contracts"
import type { NavItem, WorkspaceKind } from "@logloads/ui/layout"

/** Every V2 preview destination, in display order. Which ones a context sees comes from `v2NavigationFor`. */
export const V2_NAVIGATION: readonly NavItem[] = Object.freeze([
  { href: "/v2/work", icon: "nav.loads", id: "work", label: "Find work" },
  { href: "/v2/inquiries", icon: "nav.messages", id: "inquiries", label: "My inquiries" },
  { href: "/v2/hauler/trucks", icon: "truck.log", id: "hauler-trucks", label: "My trucks" },
  { href: "/v2/hauler/profile", icon: "nav.profile", id: "hauler-profile", label: "Profile" },
  { href: "/v2/landing", icon: "nav.today", id: "landing-overview", label: "Overview" },
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
  "landing-overview": "job.publish",
  "landings": "job.publish",
  "work": null
})

/**
 * Destinations a business that is both a hauling and a landing business does not get in its navigation, so it stays
 * within the five bottom tabs (#124): Find work, My inquiries, My trucks, Overview and Landing inbox (lead decision on
 * #209, 2026-11-04). Each is still one link away: the profile from My trucks and the Find work checklist; Post jobs
 * ("Post a job", "All jobs") and Landings ("All landings") from the landing overview (#133). The long-term fix is
 * navigation scoped to the workspace the person is in.
 */
const ONE_SIDED_ONLY: ReadonlySet<string> = new Set(["hauler-profile", "landing-jobs", "landings"])

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
  }).map((item) => withCount(item, counts))
}

/** UX-09 (#132): unread items per destination (`inquiries.ts`); a zero shows no badge. */
function withCount(item: NavItem, counts: Readonly<Partial<Record<string, number>>>): NavItem {
  const count = counts[item.id]
  return count && count > 0 ? { ...item, count } : item
}

/**
 * The port v3 destinations (#244, #245), in display order, following the UX spec's information architecture: the
 * landing desk's Find Trucks (§4.0, §4.8), the hauler's invitations inbox (§5.6) and saved jobs (§5.9), saved searches,
 * alerts and notification preferences for either side (§4.13, §5.9), then Team (§4.11, §6.6), Billing (§4.12) and
 * Boosts (§4.10), and last the LogLoads staff console (§7). None is a bottom tab: the five tabs stay exactly as
 * `v2NavigationFor` gives them (#124, lead decision on #209), so the shell offers these from its More and Settings
 * menus. Which ones a context sees comes from `v2FeatureNavigationFor`.
 *
 * Find Trucks, boost purchase and the admin queue use the routes their Figma frames record
 * (docs/product/figma/FG06-recruit-admin): `/v2/landing/trucks`, `/v2/landing/jobs/boost` and `/admin`, the staff
 * console outside V2. No frame records a route for the others yet.
 */
export const V2_FEATURE_NAVIGATION: readonly NavItem[] = Object.freeze([
  { href: "/v2/landing/trucks", icon: "action.search", id: "find-trucks", label: "Find Trucks" },
  { href: "/v2/invitations", icon: "action.request", id: "invitations", label: "Invitations" },
  { href: "/v2/saved", icon: "action.save", id: "saved-jobs", label: "Saved jobs" },
  // The registry's bell glyph.
  { href: "/v2/alerts", icon: "action.call", id: "alerts", label: "Alerts" },
  { href: "/v2/team", icon: "nav.fleet", id: "team", label: "Team" },
  { href: "/v2/landing/billing", icon: "load.pay", id: "billing", label: "Billing" },
  { href: "/v2/landing/jobs/boost", icon: "ops.notice", id: "boosts", label: "Boosts" },
  { href: "/admin", icon: "nav.admin", id: "admin", label: "Admin" }
])

/**
 * What each port v3 destination needs: its group working through the adapter (`supports`, #244) and the feature
 * capability the group's store functions check (`viewerFeatureCapabilities`). `null` marks the staff console, which no
 * organization role grants: it needs a `platform_admins` role (`adminAccess`, spec §8.7). As with the tabs, hiding an
 * item is a convenience only; every page and every store function checks again.
 */
const FEATURE_NAV_GATE: Readonly<Record<string, { feature: MarketplaceV2Feature; capability: MarketplaceFeatureCapability | null }>> = Object.freeze({
  "admin": { capability: null, feature: "admin" },
  "alerts": { capability: "alert.manage", feature: "alerts" },
  "billing": { capability: "plan.view", feature: "billing" },
  "boosts": { capability: "boost.estimate", feature: "boosts" },
  "find-trucks": { capability: "truck.search", feature: "trucks" },
  "invitations": { capability: "invitation.respond", feature: "invites" },
  "saved-jobs": { capability: "saved_job.manage", feature: "alerts" },
  "team": { capability: "team.manage", feature: "team" }
})

/**
 * Plans are the landing side's. Any member holds `plan.view`, but haulers and fleets are free forever (AGENTS.md
 * §1.3), so a hauling-only business is never shown Billing (spec §5: no paid upgrade is marketed to haulers).
 */
const LANDING_SIDE_ONLY: ReadonlySet<string> = new Set(["billing"])

/** What `v2FeatureNavigationFor` is gated on, all resolved on the server for the session's active business. */
export interface V2FeatureNavigationContext {
  /** `viewerAccess(viewer).capabilities`; `null` for a visitor or an account with no usable business. */
  capabilities: readonly MarketplaceCapability[] | null
  /** `viewerFeatureCapabilities(viewer)`: what the person's role allows in the active business. */
  features: readonly MarketplaceFeatureCapability[]
  /** The adapter's `supports`: which port v3 groups work through it. */
  supports: MarketplaceV2FeatureSupport
  /** `adminAccess(account)`: the person's LogLoads staff roles; `null` or empty for everyone else. */
  admin?: MarketplaceAdminAccess | null
}

/**
 * The port v3 destinations for the active context: each appears only when its group is supported and the person may
 * use it. The business entries need a business on at least one side, as the tabs do; the staff console needs only a
 * staff role. While no group is supported, which is every adapter until its group's task lands, this is empty.
 */
export function v2FeatureNavigationFor(context: V2FeatureNavigationContext, counts: Readonly<Partial<Record<string, number>>> = {}): NavItem[] {
  const { capabilities, features, supports } = context
  const landingSide = capabilities !== null && hasLandingSide(capabilities)
  const usableBusiness = landingSide || (capabilities !== null && hasHaulerSide(capabilities))
  const staff = (context.admin?.roles.length ?? 0) > 0

  return V2_FEATURE_NAVIGATION.filter((item) => {
    const gate = FEATURE_NAV_GATE[item.id]
    if (!gate || supports[gate.feature] !== true) return false
    if (gate.capability === null) return staff
    if (!usableBusiness || !features.includes(gate.capability)) return false
    return landingSide || !LANDING_SIDE_ONLY.has(item.id)
  }).map((item) => withCount(item, counts))
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
