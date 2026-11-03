/**
 * Marketplace props contract (DS-04, #147). Mirrors the "Marketplace" section of
 * docs/product/ux-v2/design-system/component-api.ts (pinned 9728c25, plus the `preview` context from 26c4f31).
 * Deviations from that file are marked "DEVIATION" with the reason.
 *
 * Rules: presentational only. Data arrives as @logloads/contracts view models; capabilities arrive as booleans
 * resolved on the server. No component here fetches, reads a session, or checks a plan or a permission.
 * No `style` prop; `className` is for placement.
 */
import type { ReactNode } from "react"

import type {
  MarketplaceInterestView,
  MarketplaceJobCardView,
  MarketplaceJobDetailView,
  MarketplaceVerification
} from "@logloads/contracts"

import type { PageHeaderProps } from "../layout/types"
import type { Size } from "../primitives/types"

export type { Size }

/** Freshness bands. "confirmed" and "aging" come from contracts postingFreshness(); stale/unknown cover hauler availability. */
export type FreshnessState = "confirmed" | "aging" | "stale" | "unconfirmed" | "unknown"

/** Computed by the page from the viewer's own equipment; omitted outside the hauler context. */
export type EquipmentFit = "fits" | "not_in_setups"

/** Which side of an inquiry the viewer is on. */
export type ViewerSide = "landing" | "hauler"

/** Placement only: a class for the parent's layout. Never a visual override. */
export interface Placement { className?: string }

/** Pay amount and basis. Negotiable renders the poster's note as the basis (V2-DEC-02). */
export interface PayFigureProps { pay: MarketplaceJobCardView["pay"]; size?: Size }

/** Labels always come from contracts `marketplaceEquipmentLabel`, never the raw codes. */
export interface EquipmentRequirementProps { codes: readonly string[]; fit?: EquipmentFit }

/** `label` comes from a shared formatter (jobAvailabilityStatus); never "live". */
export interface AvailabilityStatusProps { state: FreshnessState; label: string }

/**
 * DEVIATION: takes the contract's `MarketplaceVerification | null` (#150) instead of a free `scope` string and
 * `reviewedOn`. The visible label is then always `describeMarketplaceVerification`'s scope-specific text, so no
 * caller can pass a generic "Verified" (Gate 5). `null` renders nothing.
 */
export interface VerificationIndicatorProps { verification: MarketplaceVerification | null }

/** No props: one wording everywhere. */
export type SponsoredIndicatorProps = Record<string, never>

interface JobResultRowBaseProps {
  job: MarketplaceJobCardView
  /**
   * DEVIATION (addition): the request's ISO 8601 instant. `postingFreshness` is pure, and a component must not
   * read the clock while rendering (the server and the browser would disagree on hydration).
   */
  now: string
  selected?: boolean
  fit?: EquipmentFit                    // hauler context only; computed by the page from the viewer's own equipment
  distanceMiles?: number | null         // hauler context only; approximate, from the public 0.10° point (V2-DEC-01)
  interest?: { total: number; new: number } // poster context only
  onSelect?: (jobId: string) => void    // progressive enhancement: open the DetailPanel instead of navigating
  onSave?: (jobId: string) => void      // hauler context only; without it no Save button renders
  detailId?: string                     // id of the DetailPanel the title link controls (aria-controls)
}

/**
 * One row, two densities, three contexts. Density is inherited from the nearest data-density ancestor;
 * the markup is identical, so business logic exists once.
 *   "hauler": fit hints, save action, distance from the viewer's search origin.
 *   "poster": the listing's public status and interest counts instead of the poster's name and save.
 *   "preview": the job editor's live card (no fit, no save, no distance).
 * DEVIATION: `href` is required for "hauler" and "poster" and absent for "preview", whose job has no public page
 * yet, so the preview title is text rather than a link that goes nowhere.
 */
export type JobResultRowProps = JobResultRowBaseProps & (
  | { context: "hauler" | "poster"; href: string }
  | { context: "preview"; href?: undefined }
)

/** Renders the compact header row; children are JobResultRows. */
export interface JobResultListProps { label: string; children: ReactNode; footnote?: ReactNode }

/**
 * DEVIATIONS: `now` is added (see JobResultRowProps). `onClose` is omitted because DetailPanel (DS-02) and
 * Dialog (DS-03) own their Close controls; a second one inside the detail would duplicate them.
 * `expressInterestHref` is added so a page without JavaScript can link to its interest form (spec §7).
 */
export interface JobDetailProps {
  job: MarketplaceJobDetailView
  now: string
  fit?: EquipmentFit
  canExpressInterest: boolean           // capability resolved on the server
  interestState?: "none" | "sent" | "closed"
  onExpressInterest?: () => void
  expressInterestHref?: string
}

export interface CompanyProfileHeaderProps {
  business: { name: string; initials: string; logoUrl?: string | null; kind: string; homeRegion: string; since?: number }
  /** DEVIATION: the contract verification record (see VerificationIndicatorProps), not a label string. */
  verification: MarketplaceVerification | null
  figures: Array<{ value: string; label: string }> // 2–4 capability figures; extras are not rendered
  actions: ReactNode
  actionNote?: string                    // e.g. invitations left, supplied by the page
  breadcrumbs?: PageHeaderProps["breadcrumbs"]
}

/** Unknown capacity shows dashed marks and "not recently confirmed", never "0 available". */
export interface EquipmentCapacityProps { units: number; available: number | null; state: "known" | "unknown" }

export interface OperatingRegionProps { homeBase: string; areas: readonly string[]; radiusMiles: number | null }

/**
 * selected → aria-current="true" on the link. DEVIATION (addition): `viewerSide`, because the row names the
 * other party and its status wording differs by side (UX-DEC-01).
 */
export interface InquiryRowProps {
  interest: MarketplaceInterestView
  viewerSide: ViewerSide
  selected: boolean
  href: string
  onSelect?: (id: string) => void
}

export interface ConversationThreadProps { interest: MarketplaceInterestView; viewerSide: ViewerSide }

export interface MessageComposerProps {
  recipientName: string
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void                     // server action; the idempotent reply id is generated server-side
  quickReplies?: readonly string[]       // inserted into the draft, never sent automatically
  secondaryAction?: ReactNode            // e.g. Decline (danger, confirmed in a Dialog)
  sending?: boolean
}

export type { MarketplaceInterestView, MarketplaceJobCardView, MarketplaceJobDetailView, MarketplaceVerification }
