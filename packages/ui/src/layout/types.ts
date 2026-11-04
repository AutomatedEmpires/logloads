/**
 * Layout props contract (DS-02, #145). Mirrors the "Layout" section of
 * docs/product/ux-v2/design-system/component-api.ts (pinned 9728c25; unchanged at e794cbe).
 * Deviations from that file are marked "DEVIATION" with the reason.
 *
 * Rules: presentational only. Navigation items arrive already filtered by server-resolved capability;
 * no component here reads a session, a plan or a permission. No `style` prop; `className` is for placement.
 */
import type { ReactNode } from "react"

import type { IconKey } from "../icons"
import type { Density } from "../tokens"

export type { Density }
export type WorkspaceKind = "hauler" | "landing" | "admin"

/** `icon` is a key of the semantic Phosphor registry in packages/ui/src/icons (typed, not a free string). */
export interface NavItem { id: string; label: string; href: string; count?: number; icon?: IconKey }

/** Placement only: a class for the parent's layout. Never a visual override. */
export interface Placement { className?: string }

/**
 * A forwarded ref to an interactive component's root element (React 19 passes `ref` as a prop). Declared
 * structurally rather than as React's `Ref`, whose unique-symbol return type differs between @types/react
 * patch versions, so an app on another patch still type-checks these sources.
 */
export type LayoutRef<T> = ((node: T | null) => void) | { current: T | null } | null

/** The single application frame. Sets the "ll-app" container that every responsive rule measures. */
export interface AppShellProps {
  workspace: WorkspaceKind
  navigation: NavItem[]          // already filtered by capability on the server
  activeNavId: string
  /**
   * DEVIATION: optional. A signed-out visitor on a public V2 page, or an account with no selected
   * business, has no business to show; the shell then renders the brand and navigation only.
   */
  business?: BusinessSwitcherProps
  children: ReactNode
  density?: Density              // default "comfortable"; scoped via data-density
  banner?: ReactNode             // e.g. billing-state notices; never marketing. The preview note lives in `account`.
  /**
   * DEVIATION (addition, #124): the top bar's account menu, the "[Account]" of 02_EXPERIENCE_DESIGN.md §2.1.
   * It carries the development-preview note instead of a page-wide banner (§2.2). Omitted: no account menu.
   */
  account?: AccountMenuProps
}

export interface GlobalNavigationProps {
  items: NavItem[]
  activeId: string
  business?: BusinessSwitcherProps // DEVIATION: optional, as on AppShellProps
  account?: AccountMenuProps       // DEVIATION (addition), as on AppShellProps
}

/**
 * DEVIATION (addition, #124): the account menu at the end of the top bar. A disclosure (a native
 * <details>), not an ARIA menu: it holds text as well as links, and it opens and closes with Enter or
 * Space without JavaScript. With scripts, Escape closes it and returns focus to its trigger, and a click
 * or focus outside closes it.
 */
export interface AccountMenuProps {
  /** The signed-in person, shown at the top of the panel. Omitted for a visitor. */
  person?: { name: string; email?: string }
  /** Plain links, in order: e.g. "Switch business" for a member, "Sign in" for a visitor. */
  links?: Array<{ id: string; label: string; href: string }>
  /** A short notice under its own title, e.g. the development preview. Never marketing. */
  note?: { title: string; body: ReactNode }
  /** A short tag on the trigger while the note applies, e.g. "Preview", so the notice stays discoverable. */
  tag?: string
  /** A control the app supplies at the end of the panel, e.g. its sign-out button. */
  action?: ReactNode
}

/** Bottom tabs below bp-lg; at most 5 items (extra items are not rendered). */
export interface ResponsiveNavigationProps { items: NavItem[]; activeId: string }

export interface BusinessSwitcherProps {
  current: { id: string; name: string; initials: string; kind: string; roleLabel: string }
  memberships: Array<{ id: string; name: string; kind: string; roleLabel: string }> // only real memberships
  /**
   * `/v2/switch`, which revalidates on the server. DEVIATION: optional, because that route does not
   * exist yet (#124). Without it the switcher is plain text, never a link, and `unavailableNote`
   * explains why when the account has more than one business.
   */
  switchHref?: string
  /** DEVIATION (addition): the page's explanation for a missing `switchHref`, e.g. BUSINESS_SWITCH_UNAVAILABLE. */
  unavailableNote?: string
}

export interface PageContainerProps { width?: "default" | "narrow"; children: ReactNode }

export interface PageHeaderProps {
  title: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  description?: ReactNode
  meta?: ReactNode               // inline facts: status, pay, area. Keep to one line on desktop
  actions?: ReactNode            // <PageActions>; at most one primary Button
  tabs?: ReactNode               // <Tabs variant="page">
  children?: ReactNode           // full-width slot, e.g. <SearchToolbar>
}

export interface PageActionsProps { children: ReactNode }

/**
 * list-detail: results + optional DetailPanel (≥ bp-xl). main-aside: content + 360 px aside (≥ bp-xl).
 * split: 420 px list + conversation (≥ 1024). single: one column.
 */
export interface ContentGridProps {
  layout: "single" | "list-detail" | "main-aside" | "split"
  detailOpen?: boolean
  main: ReactNode
  aside?: ReactNode
}

/** surface: white panel. open: a dark top rule, no box. flush: panel whose list runs edge to edge. */
export interface SectionProps {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  variant?: "surface" | "open" | "flush"
  headingLevel?: 2 | 3
  children: ReactNode
}

/**
 * A GET form (`near`, `radius` query parameters) that works without JavaScript. The equipment summary
 * is read-only text: it describes the viewer's own setups.
 */
export interface SearchToolbarProps {
  location: string
  radiusMiles: number
  equipmentSummary: string
  action: string                 // GET form action; works without JavaScript
  onOpenMobileSearch?: () => void
}

export interface FilterDefinition { id: string; label: string; valueLabel: string; active: boolean; desktopOnly?: boolean }

/**
 * `onOpenFilter` receives a filter id, FILTER_BAR_ALL_ID (the phone "Filters" button) or
 * FILTER_BAR_MORE_ID (the "More filters" button).
 */
export interface FilterBarProps {
  filters: FilterDefinition[]
  onOpenFilter: (id: string) => void
  onClearAll?: () => void
  moreFilters?: boolean
}

export interface DetailPanelProps { label: string; onClose: () => void; children: ReactNode } // returns focus to the opener on close
