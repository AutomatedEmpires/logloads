/**
 * admin (#255): verification, moderation, reports and grants (UX spec §7.1–§7.3, §7.7). A separate privilege boundary:
 * `platform_admins`, never an organization role (§8.7). Every write states a reason, which the store audits. Views and
 * inputs for `MarketplaceAdminPort` (apps/web/lib/marketplace-v2/port.ts). #255 adds its schemas and rules here and in
 * `packages/services/src/v2/admin/`.
 */

import type { MarketplaceId } from "../../marketplace-port-v3"

/** `platform_admins.admin_role`. `superadmin` passes every role check. */
export const MARKETPLACE_ADMIN_ROLES = ["support", "moderator", "billing", "superadmin"] as const
export type MarketplaceAdminRole = (typeof MARKETPLACE_ADMIN_ROLES)[number]

export interface MarketplaceAdminAccess {
  /** Empty for anyone who is not LogLoads staff. */
  roles: MarketplaceAdminRole[]
}

/** Aggregate counts for the action queue (§7.1). Actual zeros, never launch metrics. */
export interface MarketplaceAdminQueueView {
  pendingVerifications: number
  openReports: number
  jobsOnHold: number
}

/** `organizations.verification_status`. */
export const MARKETPLACE_ORG_VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const
export type MarketplaceOrgVerificationStatus = (typeof MARKETPLACE_ORG_VERIFICATION_STATUSES)[number]

export interface MarketplaceAdminVerificationView {
  organizationId: MarketplaceId
  displayName: string
  legalName: string | null
  status: MarketplaceOrgVerificationStatus
  verifiedAt: string | null
  createdAt: string
}

/** `abuse_reports.status`. */
export const MARKETPLACE_REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const
export type MarketplaceReportStatus = (typeof MARKETPLACE_REPORT_STATUSES)[number]

/** `abuse_reports.target_kind`. */
export const MARKETPLACE_REPORT_TARGETS = ["job_posting", "organization", "user", "interest_message"] as const
export type MarketplaceReportTarget = (typeof MARKETPLACE_REPORT_TARGETS)[number]

export interface MarketplaceAdminReportFilters {
  /** Omitted: open and reviewing. */
  status?: MarketplaceReportStatus | null
  target?: MarketplaceReportTarget | null
}

export interface MarketplaceAdminReportView {
  id: MarketplaceId
  target: { kind: MarketplaceReportTarget; id: MarketplaceId }
  /** `abuse_reports.reason` (the `MARKETPLACE_LISTING_REPORT_REASONS` codes for a listing). */
  reason: string
  details: string | null
  status: MarketplaceReportStatus
  reporterUserId: MarketplaceId
  createdAt: string
  reviewedAt: string | null
  resolutionNote: string | null
}

/** Moderation statuses (`admin_moderate_job_posting`): each also places a hold the poster cannot lift. */
export const MARKETPLACE_MODERATION_STATUSES = ["paused", "closed", "expired"] as const
export type MarketplaceModerationStatus = (typeof MARKETPLACE_MODERATION_STATUSES)[number]

/** Every admin write names its target and an audit reason. */
export interface MarketplaceAdminReason {
  reason: string
}

export interface MarketplaceAdminVerificationInput extends MarketplaceAdminReason {
  organizationId: MarketplaceId
  status: MarketplaceOrgVerificationStatus
}

export interface MarketplaceAdminModerationInput extends MarketplaceAdminReason {
  jobId: MarketplaceId
  status: MarketplaceModerationStatus
}

export interface MarketplaceAdminReleaseInput extends MarketplaceAdminReason {
  jobId: MarketplaceId
}

export interface MarketplaceAdminReportResolutionInput {
  reportId: MarketplaceId
  status: Exclude<MarketplaceReportStatus, "open">
  /** Up to 1000 characters. */
  resolutionNote: string | null
}

export interface MarketplaceAdminFoundingPromotionInput extends MarketplaceAdminReason {
  promotionCode: string
  organizationId: MarketplaceId
}

export interface MarketplaceAdminFoundingBadgeInput extends MarketplaceAdminReason {
  organizationId: MarketplaceId
}

/** A private read for an investigation (`admin_read_landing_private`, `admin_read_interest_thread`): the reason is audited. */
export interface MarketplaceAdminPrivateReadInput extends MarketplaceAdminReason {
  targetId: MarketplaceId
}

export interface MarketplaceAdminLandingPrivateView {
  landingId: MarketplaceId
  exactPoint: { lat: number; lng: number } | null
  gateInstructions: string | null
  siteContactName: string | null
  siteContactPhone: string | null
}

export interface MarketplaceAdminThreadMessageView {
  id: MarketplaceId
  authorSide: "hauler" | "landing"
  body: string
  createdAt: string
}
