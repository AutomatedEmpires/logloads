import type { NavItem, WorkspaceKind } from "@logloads/ui/layout"

/**
 * The V2 preview's destinations: exactly the four the hand-rolled header listed before the shared AppShell
 * (#145). They are not yet narrowed by capability; every visitor sees the same four, as before.
 */
export const V2_NAVIGATION: readonly NavItem[] = Object.freeze([
  { href: "/v2/work", icon: "nav.loads", id: "work", label: "Find work" },
  { href: "/v2/inquiries", icon: "nav.messages", id: "inquiries", label: "My inquiries" },
  { href: "/v2/landing/inquiries", icon: "nav.landing", id: "landing-inquiries", label: "Landing inbox" },
  { href: "/v2/landing/jobs", icon: "ops.document", id: "landing-jobs", label: "Post jobs" }
])

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
