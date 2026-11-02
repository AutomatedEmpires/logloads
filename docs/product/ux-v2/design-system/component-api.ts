/**
 * LogLoads component API: the props contract for packages/ui. REFERENCE, not yet compiled in the app.
 *
 * Rules every component follows:
 *  - Presentational only. No data fetching, no session reads, no entitlement or permission logic.
 *    Pages resolve capabilities on the server (resolveV2Viewer, MarketplaceCapability) and pass booleans.
 *  - Data comes in as existing contract view models from @logloads/contracts, never page-specific strings.
 *  - Styling comes from tokens.css plus one CSS Module per component. No inline styles, no `style` prop.
 *  - Variants are closed string unions. A new variant is a reviewed change to this file, not a page override.
 *  - Every interactive component forwards ref, accepts `className` only for layout placement, and spreads
 *    remaining DOM props, so tests and analytics can target it.
 *  - Lists of jobs and inquiries are semantic <ul>/<li>. Each row has one link (its title) as the selection and
 *    navigation target, plus independent buttons. No role="listbox"/"option" around interactive content.
 *  - AppShell, Dialog and any portalled popover root carry the `ll-theme` class, so tokens apply only inside V2.
 */
import type { ReactNode } from "react"
import type {
  MarketplaceInterestView,
  MarketplaceJobCardView,
  MarketplaceJobDetailView
} from "@logloads/contracts"

/* ============================== Shared ============================== */
export type Density = "comfortable" | "compact"
export type Size = "sm" | "md" | "lg"
export type WorkspaceKind = "hauler" | "landing" | "admin"
/** Freshness bands. "confirmed" and "aging" come from contracts postingFreshness(); stale/unknown cover hauler availability. */
export type FreshnessState = "confirmed" | "aging" | "stale" | "unconfirmed" | "unknown"

/* ============================== Layout ============================== */
export interface NavItem { id: string; label: string; href: string; count?: number; icon?: IconKey }
export type IconKey = string // the existing semantic registry in packages/ui/src/icons

/** The single application frame. Sets the "ll-app" container that every responsive rule measures. */
export interface AppShellProps {
  workspace: WorkspaceKind
  navigation: NavItem[]          // already filtered by capability on the server
  activeNavId: string
  business: BusinessSwitcherProps
  children: ReactNode
  density?: Density              // default "comfortable"; scoped via data-density
  banner?: ReactNode             // e.g. preview or billing-state notices; never marketing
}
export interface GlobalNavigationProps { items: NavItem[]; activeId: string; business: BusinessSwitcherProps }
export interface ResponsiveNavigationProps { items: NavItem[]; activeId: string } // bottom tabs below bp-lg; max 5 items
export interface BusinessSwitcherProps {
  current: { id: string; name: string; initials: string; kind: string; roleLabel: string }
  memberships: Array<{ id: string; name: string; kind: string; roleLabel: string }> // only real memberships
  switchHref: string             // /v2/switch, which revalidates on the server
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
export interface ContentGridProps { layout: "single" | "list-detail" | "main-aside" | "split"; detailOpen?: boolean; main: ReactNode; aside?: ReactNode }
/** surface: white panel. open: a dark top rule, no box. flush: panel whose list runs edge to edge. */
export interface SectionProps { title?: string; description?: ReactNode; actions?: ReactNode; variant?: "surface" | "open" | "flush"; headingLevel?: 2 | 3; children: ReactNode }
export interface SearchToolbarProps {
  location: string; radiusMiles: number; equipmentSummary: string
  action: string                 // GET form action; works without JavaScript
  onOpenMobileSearch?: () => void
}
export interface FilterDefinition { id: string; label: string; valueLabel: string; active: boolean; desktopOnly?: boolean }
export interface FilterBarProps { filters: FilterDefinition[]; onOpenFilter: (id: string) => void; onClearAll?: () => void; moreFilters?: boolean }
export interface DetailPanelProps { label: string; onClose: () => void; children: ReactNode } // returns focus to the opener on close

/* ============================== Primitives ============================== */
export interface ButtonProps { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: Size; icon?: IconKey; iconOnly?: boolean; label: string; loading?: boolean; href?: string }
export interface TabsProps { variant?: "page" | "segmented"; items: Array<{ id: string; label: string; count?: number; href?: string }>; activeId: string; label: string; onChange?: (id: string) => void }
export interface FormFieldProps { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: ReactNode } // wires aria-describedby and aria-invalid
export interface NumberStepperProps { label: string; value: number | null; min?: number; max?: number; onChange: (next: number) => void; name?: string }
export interface SegmentedControlProps<T extends string> { label: string; options: Array<{ value: T; label: string }>; value: T | null; onChange: (value: T) => void }
/** Native <dialog> opened with showModal(). Its root carries `ll-theme`. On close, focus returns to `returnFocusRef` (or the opener). */
export interface DialogProps { title: string; open: boolean; onClose: () => void; size?: "default" | "wide"; footer?: ReactNode; returnFocusRef?: { current: HTMLElement | null }; children: ReactNode }
export interface EmptyStateProps { title: string; body: string; actions?: ReactNode }
export interface LoadingStateProps { kind: "rows" | "detail" | "profile"; rows?: number; label: string }
export interface ErrorStateProps { title: string; body: string; retry?: () => void }

/* ============================== Marketplace ============================== */
/** Pay amount and basis. Negotiable renders the poster's note as the basis (V2-DEC-02). */
export interface PayFigureProps { pay: MarketplaceJobCardView["pay"]; size?: Size }
export interface EquipmentRequirementProps { codes: string[]; fit?: "fits" | "not_in_setups" } // fit omitted outside the hauler context
export interface AvailabilityStatusProps { state: FreshnessState; label: string } // label from shared formatter; never "live"
/** `scope` is the visible label and must name exactly what LogLoads checked, e.g. "Business identity verified". Never a generic "Verified". null renders nothing. */
export interface VerificationIndicatorProps { scope: string | null; reviewedOn?: string }
export interface SponsoredIndicatorProps { /* no props: one wording everywhere */ }

/**
 * One row, two densities, two contexts. Density is inherited from the nearest data-density ancestor;
 * the markup is identical, so business logic exists once.
 *   context "hauler": fit hints, save action, distance from the viewer's search origin.
 *   context "poster": landing name and interest counts instead of poster name and save.
 */
export interface JobResultRowProps {
  job: MarketplaceJobCardView
  context: "hauler" | "poster"
  selected?: boolean
  fit?: "fits" | "not_in_setups"        // computed by the page from the viewer's own equipment
  distanceMiles?: number | null          // approximate, from the public 0.10° point (V2-DEC-01)
  interest?: { total: number; new: number } // poster context only
  href: string                          // the title link; works without JavaScript (/v2/work/[id])
  onSelect?: (jobId: string) => void     // progressive enhancement: open the DetailPanel instead of navigating
  onSave?: (jobId: string) => void
  detailId?: string                      // id of the DetailPanel the title link controls (aria-controls)
}
export interface JobResultListProps { label: string; children: ReactNode; footnote?: ReactNode } // renders the compact header row
export interface JobDetailProps {
  job: MarketplaceJobDetailView
  fit?: "fits" | "not_in_setups"
  canExpressInterest: boolean            // capability resolved on the server
  interestState?: "none" | "sent" | "closed"
  onExpressInterest?: () => void
  onClose?: () => void                   // present when rendered inside DetailPanel
}
export interface CompanyProfileHeaderProps {
  business: { name: string; initials: string; logoUrl?: string | null; kind: string; homeRegion: string; since?: number }
  verification: VerificationIndicatorProps
  figures: Array<{ value: string; label: string }> // 2–4 capability figures
  actions: ReactNode
  actionNote?: string                    // e.g. invitations left, supplied by the page
  breadcrumbs?: PageHeaderProps["breadcrumbs"]
}
export interface EquipmentCapacityProps { units: number; available: number | null; state: "known" | "unknown" }
export interface OperatingRegionProps { homeBase: string; areas: string[]; radiusMiles: number | null }
export interface InquiryRowProps { interest: MarketplaceInterestView; selected: boolean; href: string; onSelect?: (id: string) => void } // selected → aria-current="true" on the link
export interface ConversationThreadProps { interest: MarketplaceInterestView; viewerSide: "landing" | "hauler" }
export interface MessageComposerProps {
  recipientName: string
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void                     // server action; idempotent reply id generated server-side
  quickReplies?: string[]                // inserted into the draft, never sent automatically
  secondaryAction?: ReactNode            // e.g. Decline (danger, confirmed in a Dialog)
  sending?: boolean
}
export interface EquipmentAvailabilityRowProps {
  label: string; spec?: string; units: number
  state: "available_now" | "available_from" | "unavailable" | "unknown"
  available: number | null; fromDate: string | null; updatedLabel: string
  onChange: (next: { state: EquipmentAvailabilityRowProps["state"]; available: number | null; fromDate: string | null }) => void
}
