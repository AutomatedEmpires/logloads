import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  assignmentSchema,
  auditEventSchema,
  availabilityWindowSchema,
  billingAdjustmentSchema,
  billingPeriodSummarySchema,
  credentialReviewSchema,
  destinationFacilitySchema,
  directOfferSchema,
  dispatcherProfileSchema,
  driverCredentialSchema,
  driverProfileSchema,
  entitlementSchema,
  equipmentCombinationSchema,
  futureAvailabilitySchema,
  haulRouteSchema,
  hostBillingProfileSchema,
  hostInvoiceSchema,
  landingSchema,
  loadPostingSchema,
  loaderProfileSchema,
  loggingCompanySchema,
  messageEventSchema,
  messageThreadSchema,
  millSchema,
  notificationSchema,
  networkOverageInvoiceSchema,
  networkUsageEventSchema,
  operationalNoticeSchema,
  opportunityCapacitySchema,
  organizationInvitationSchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationMembershipSchema,
  organizationSchema,
  organizationSubscriptionSchema,
  platformFeeEventSchema,
  privateNetworkRelationshipSchema,
  rateSchema,
  richLandingDetailsSchema,
  routePackSchema,
  supportRequestSchema,
  subscriptionBaseInvoiceSchema,
  subscriptionPlanDefinitionSchema,
  SUBSCRIPTION_PLAN_CATALOG,
  trailerProfileSchema,
  tripDocumentSchema,
  tripEventSchema,
  tripInspectionSchema,
  tripReviewSchema,
  tripSchemaV2,
  truckProfileSchema,
  truckSlotSchema,
  userSchema,
  verificationRecordSchema
} from "@logloads/contracts"

import type { LogLoadsDatabaseState, LogLoadsTableName } from "./types"

const SNAPSHOT_ROW_ID = "primary"
const REMOTE_READ_ATTEMPTS = 2
const REPORTED_SIGNATURE_LIMIT = 500

export const OPERATING_STATE_SCHEMA_VERSION = 2

/**
 * The verdict this module needs from a contract schema, described structurally.
 * packages/db depends on @logloads/contracts, not on zod, and reaching through a
 * transitive dependency for a type would break the moment contracts changes how
 * it validates. Every zod schema satisfies this shape.
 */
interface RowIssue {
  readonly code: string
  readonly message: string
  readonly path: ReadonlyArray<string | number>
}

type RowVerdict =
  | { readonly success: true }
  | { readonly success: false; readonly error: { readonly issues: ReadonlyArray<RowIssue> } }

interface RowValidator {
  safeParse(value: unknown): RowVerdict
}

/**
 * The contract every stored row of a collection must satisfy before it may
 * become runtime state. Typed as an exhaustive record so a collection added to
 * LogLoadsDatabaseState cannot compile until somebody says how its rows are
 * validated — the store has no other gate, because the whole document arrives
 * as one service-role JSONB read.
 */
const ROW_VALIDATORS: Record<LogLoadsTableName, RowValidator> = {
  assignments: assignmentSchema,
  auditEvents: auditEventSchema,
  availabilityWindows: availabilityWindowSchema,
  billingAdjustments: billingAdjustmentSchema,
  billingPeriodSummaries: billingPeriodSummarySchema,
  billingPlanDefinitions: subscriptionPlanDefinitionSchema,
  companies: loggingCompanySchema,
  credentialReviews: credentialReviewSchema,
  destinationFacilities: destinationFacilitySchema,
  directOffers: directOfferSchema,
  dispatcherProfiles: dispatcherProfileSchema,
  driverCredentials: driverCredentialSchema,
  driverProfiles: driverProfileSchema,
  entitlements: entitlementSchema,
  equipmentCombinations: equipmentCombinationSchema,
  futureAvailability: futureAvailabilitySchema,
  haulRoutes: haulRouteSchema,
  hostBillingProfiles: hostBillingProfileSchema,
  hostInvoices: hostInvoiceSchema,
  landings: landingSchema,
  loadPostings: loadPostingSchema,
  loaderProfiles: loaderProfileSchema,
  messageEvents: messageEventSchema,
  messageThreads: messageThreadSchema,
  mills: millSchema,
  notifications: notificationSchema,
  networkOverageInvoices: networkOverageInvoiceSchema,
  networkUsageEvents: networkUsageEventSchema,
  operationalNotices: operationalNoticeSchema,
  opportunityCapacities: opportunityCapacitySchema,
  organizationInvitations: organizationInvitationSchema,
  organizationBillingAccounts: organizationBillingAccountSchema,
  organizationMemberships: organizationMembershipSchema,
  organizations: organizationSchema,
  organizationSubscriptions: organizationSubscriptionSchema,
  platformFeeEvents: platformFeeEventSchema,
  privateNetworkRelationships: privateNetworkRelationshipSchema,
  profiles: userSchema,
  rates: rateSchema,
  richLandingDetails: richLandingDetailsSchema,
  routePacks: routePackSchema,
  supportRequests: supportRequestSchema,
  subscriptionBaseInvoices: subscriptionBaseInvoiceSchema,
  trailerProfiles: trailerProfileSchema,
  tripDocuments: tripDocumentSchema,
  tripEvents: tripEventSchema,
  tripInspections: tripInspectionSchema,
  tripReviews: tripReviewSchema,
  tripsV2: tripSchemaV2,
  truckProfiles: truckProfileSchema,
  truckSlots: truckSlotSchema,
  verificationRecords: verificationRecordSchema
}

/**
 * Derived from the validator map rather than from the seed literal, so the
 * required set is the type's own collection list and cannot drift from what is
 * actually validated.
 */
const REQUIRED_TABLES = Object.keys(ROW_VALIDATORS) as LogLoadsTableName[]

interface RowReference {
  field: string
  target: LogLoadsTableName
}

/**
 * Stored references whose target has to exist for the referring row to mean
 * anything operationally.
 *
 * Deliberately NOT the complete foreign-key set — every reference in the
 * contracts is typed as a bare uuid, so this list is declared by hand and can
 * only ever be partial. That is survivable precisely because a broken reference
 * is reported and never withheld: a missing entry costs coverage, a wrong entry
 * costs log noise, and neither can take the document down or hide a row.
 * `polymorphic` and ambiguous ids (relatedEntityId, subjectId, companyId, which
 * spans the retired companies table and organizations) are left out rather than
 * guessed at.
 */
const ROW_REFERENCES: Partial<Record<LogLoadsTableName, readonly RowReference[]>> = {
  assignments: [
    { field: "driverProfileId", target: "driverProfiles" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "trailerProfileId", target: "trailerProfiles" },
    { field: "truckProfileId", target: "truckProfiles" },
    { field: "truckSlotId", target: "truckSlots" }
  ],
  availabilityWindows: [
    { field: "driverProfileId", target: "driverProfiles" },
    { field: "truckProfileId", target: "truckProfiles" }
  ],
  billingAdjustments: [
    { field: "billingPeriodSummaryId", target: "billingPeriodSummaries" },
    { field: "invoiceId", target: "networkOverageInvoices" },
    { field: "organizationId", target: "organizations" },
    { field: "usageEventId", target: "networkUsageEvents" }
  ],
  billingPeriodSummaries: [
    { field: "organizationId", target: "organizations" },
    { field: "subscriptionId", target: "organizationSubscriptions" }
  ],
  // A review is the answer to "why was I refused". If the credential it decided is
  // gone the answer no longer attaches to anything, which is the one thing this
  // trail exists to prevent.
  credentialReviews: [
    { field: "credentialId", target: "driverCredentials" },
    { field: "driverProfileId", target: "driverProfiles" }
  ],
  destinationFacilities: [{ field: "millId", target: "mills" }],
  directOffers: [{ field: "loadPostingId", target: "loadPostings" }],
  dispatcherProfiles: [{ field: "userId", target: "profiles" }],
  // supersededByCredentialId points inside this same collection: a renewal chain
  // whose earlier link is gone would present a superseded record as current.
  driverCredentials: [
    { field: "driverProfileId", target: "driverProfiles" },
    { field: "supersededByCredentialId", target: "driverCredentials" }
  ],
  driverProfiles: [{ field: "userId", target: "profiles" }],
  equipmentCombinations: [
    { field: "organizationId", target: "organizations" },
    { field: "truckProfileId", target: "truckProfiles" }
  ],
  hostBillingProfiles: [{ field: "organizationId", target: "organizations" }],
  hostInvoices: [{ field: "organizationId", target: "organizations" }],
  loadPostings: [
    { field: "dispatcherProfileId", target: "dispatcherProfiles" },
    { field: "dropoffMillId", target: "mills" },
    { field: "pickupLandingId", target: "landings" },
    { field: "rateId", target: "rates" },
    { field: "routeId", target: "haulRoutes" }
  ],
  loaderProfiles: [{ field: "userId", target: "profiles" }],
  messageEvents: [{ field: "threadId", target: "messageThreads" }],
  networkOverageInvoices: [
    { field: "billingPeriodSummaryId", target: "billingPeriodSummaries" },
    { field: "organizationId", target: "organizations" }
  ],
  networkUsageEvents: [
    { field: "assignmentId", target: "assignments" },
    { field: "billingPeriodSummaryId", target: "billingPeriodSummaries" },
    { field: "invoiceId", target: "networkOverageInvoices" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "organizationId", target: "organizations" },
    { field: "reversalAdjustmentId", target: "billingAdjustments" }
  ],
  opportunityCapacities: [{ field: "loadPostingId", target: "loadPostings" }],
  organizationMemberships: [
    { field: "organizationId", target: "organizations" },
    { field: "userId", target: "profiles" }
  ],
  organizationBillingAccounts: [
    { field: "organizationId", target: "organizations" },
    { field: "subscriptionId", target: "organizationSubscriptions" }
  ],
  organizationSubscriptions: [{ field: "organizationId", target: "organizations" }],
  // A fee is a claim about one specific completed load. If anything it names is
  // missing, the charge can no longer be explained to the host it was billed to,
  // which is the one thing a fee ledger must always be able to do. invoiceId is
  // nullable and simply skipped while it is null. `feeEventIds` on an invoice is an
  // array, which is outside what this checker reads.
  platformFeeEvents: [
    { field: "assignmentId", target: "assignments" },
    { field: "invoiceId", target: "hostInvoices" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "organizationId", target: "organizations" },
    { field: "truckSlotId", target: "truckSlots" }
  ],
  richLandingDetails: [{ field: "landingId", target: "landings" }],
  routePacks: [
    { field: "assignmentId", target: "assignments" },
    { field: "haulRouteId", target: "haulRoutes" },
    { field: "landingId", target: "landings" },
    { field: "loadPostingId", target: "loadPostings" }
  ],
  tripDocuments: [{ field: "tripId", target: "tripsV2" }],
  tripEvents: [{ field: "tripId", target: "tripsV2" }],
  tripInspections: [
    { field: "assignmentId", target: "assignments" },
    { field: "driverProfileId", target: "driverProfiles" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "tripId", target: "tripsV2" }
  ],
  tripReviews: [
    { field: "assignmentId", target: "assignments" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "tripId", target: "tripsV2" }
  ],
  tripsV2: [
    { field: "assignmentId", target: "assignments" },
    { field: "driverProfileId", target: "driverProfiles" },
    { field: "loadPostingId", target: "loadPostings" },
    { field: "routePackId", target: "routePacks" }
  ],
  truckSlots: [
    { field: "landingId", target: "landings" },
    { field: "loadPostingId", target: "loadPostings" }
  ]
}

export type OperatingStateDefectKind =
  | "billing_conflict"
  | "duplicate_id"
  | "invalid_row"
  | "missing_reference"
  | "unknown_fields"

export interface OperatingStateDefect {
  collection: LogLoadsTableName
  detail: string
  kind: OperatingStateDefectKind
  rowId: string | null
  /** Index in the STORED collection, so an operator can find the row in the JSONB. */
  rowIndex: number
  /** True when the row was held back from runtime state, false when it was kept. */
  withheld: boolean
}

/** Rows held back from runtime state, per collection, in stored order. */
export type WithheldOperatingStateRows = Partial<Record<LogLoadsTableName, unknown[]>>

export interface OperatingStateReport {
  defects: readonly OperatingStateDefect[]
  /** Collections absent or not arrays. Non-empty means the document is refused. */
  missingCollections: readonly LogLoadsTableName[]
}

export interface OperatingStateAudit extends OperatingStateReport {
  defects: OperatingStateDefect[]
  missingCollections: LogLoadsTableName[]
  /** null only when a required collection is missing; the document is refused. */
  state: LogLoadsDatabaseState | null
  withheldRows: WithheldOperatingStateRows
}

export interface RemoteSnapshotConfig {
  url: string
  key: string
}

export interface RemoteOperatingStateSnapshot {
  /** What the read found wrong with the stored document, for health surfaces. */
  defects: OperatingStateDefect[]
  schemaVersion: number
  state: LogLoadsDatabaseState
  version: number
  /** Rows kept out of `state`; carried so a write-back cannot erase them. */
  withheldRows: WithheldOperatingStateRows
}

export interface RemoteMutationResult<T> {
  attempts: number
  snapshot: RemoteOperatingStateSnapshot
  value: T
}

export class OperatingStateUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OperatingStateUnavailableError"
  }
}

export class OperatingStateConflictError extends Error {
  constructor(attempts: number) {
    super(`Operating state changed concurrently after ${attempts} attempts`)
    this.name = "OperatingStateConflictError"
  }
}

export type OperatingStateDefectReporter = (report: OperatingStateReport) => void

function writeReportToConsole(report: OperatingStateReport): void {
  if (report.missingCollections.length > 0) {
    console.error(
      `[operating-state] document refused; collections missing or not an array: ${report.missingCollections.join(", ")}`
    )
  }

  for (const defect of report.defects) {
    console.error(
      `[operating-state] ${defect.kind} ${defect.collection}[${defect.rowIndex}]` +
        `${defect.rowId ? ` id=${defect.rowId}` : ""} ` +
        `${defect.withheld ? "withheld from runtime state" : "kept in runtime state"}: ${defect.detail}`
    )
  }
}

const reportedSignatures = new Set<string>()
let reportDefects: OperatingStateDefectReporter = writeReportToConsole

/**
 * Route findings somewhere an operator will see them. The default writes to the
 * server log because that is the only sink this package can assume exists;
 * anything better (Sentry, a health endpoint) replaces it here.
 */
export function setOperatingStateDefectReporter(
  reporter: OperatingStateDefectReporter | null
): void {
  reportDefects = reporter ?? writeReportToConsole
  reportedSignatures.clear()
}

function reportSignature(report: OperatingStateReport): string {
  return [
    report.missingCollections.join(","),
    ...report.defects.map(
      (defect) =>
        `${defect.kind}/${defect.collection}/${defect.rowId ?? defect.rowIndex}/${defect.detail}`
    )
  ].join("|")
}

/**
 * Emit each distinct finding once per process. The canonical document is re-read
 * on every request, so reporting unconditionally would repeat the same lines
 * thousands of times an hour and bury the finding it was meant to surface.
 * Nothing is lost by the filter: every read still returns the full current set
 * on `snapshot.defects`.
 */
function publishReport(report: OperatingStateReport): void {
  if (report.defects.length === 0 && report.missingCollections.length === 0) {
    return
  }

  const signature = reportSignature(report)

  if (reportedSignatures.has(signature)) {
    return
  }

  if (reportedSignatures.size >= REPORTED_SIGNATURE_LIMIT) {
    reportedSignatures.clear()
  }

  reportedSignatures.add(signature)
  reportDefects(report)
}

/**
 * Additive normalization for snapshots written before a field existed. Schema v2
 * introduced the tripReviews collection. supportRequests is additive and
 * schema-v2-compatible (its SQL migration applies the same backfill).
 * tripInspections is additive and RUNTIME-ONLY — no SQL migration exists for it;
 * this guard is the only backfill. The three platform-fee billing collections and
 * the two driver-credential collections are additive and RUNTIME-ONLY on the same
 * terms. Old and new deployments can overlap during rollout and rollback.
 */
function backfillStateSnapshot(
  value: Partial<LogLoadsDatabaseState>
): Partial<LogLoadsDatabaseState> {
  const candidate: Partial<LogLoadsDatabaseState> = { ...value }
  const billingAccountsWereMissing = candidate.organizationBillingAccounts === undefined

  // This must happen before the required-collection check. The SQL migration
  // applies the same additive backfill, while this runtime guard keeps code-first
  // deploys and local snapshots safe without advancing the persisted schema
  // version.
  if (candidate.supportRequests === undefined) {
    candidate.supportRequests = []
  }

  if (candidate.tripReviews === undefined) {
    candidate.tripReviews = []
  }

  if (candidate.tripInspections === undefined) {
    candidate.tripInspections = []
  }

  // Platform fee billing. These three are in REQUIRED_TABLES the moment they have a
  // row validator, and the canonical document in production predates them, so
  // without this guard the very first read after deploy would refuse the whole
  // document and every request would fail. Empty is also the only honest default:
  // no host has been charged anything, so an absent ledger means nothing accrued,
  // never that a bill was lost.
  if (candidate.hostBillingProfiles === undefined) {
    candidate.hostBillingProfiles = []
  }

  if (candidate.platformFeeEvents === undefined) {
    candidate.platformFeeEvents = []
  }

  if (candidate.hostInvoices === undefined) {
    candidate.hostInvoices = []
  }

  // Subscription-v1 is additive beside the permanent legacy ledger. Code may
  // roll out before the SQL JSON backfill, so every new collection receives the
  // only honest deploy-safe default here. Plan definitions are commercial
  // configuration rather than activity and therefore backfill from the frozen
  // version-one catalog; all organization/customer/usage collections start
  // empty so no real account is silently enrolled or charged.
  if (candidate.billingPlanDefinitions === undefined) {
    candidate.billingPlanDefinitions = SUBSCRIPTION_PLAN_CATALOG.map((plan) => structuredClone(plan))
  }

  if (candidate.organizationBillingAccounts === undefined) {
    candidate.organizationBillingAccounts = []
  }

  if (candidate.organizationSubscriptions === undefined) {
    candidate.organizationSubscriptions = []
  }

  if (candidate.networkUsageEvents === undefined) {
    candidate.networkUsageEvents = []
  }

  if (candidate.billingPeriodSummaries === undefined) {
    candidate.billingPeriodSummaries = []
  }

  if (candidate.billingAdjustments === undefined) {
    candidate.billingAdjustments = []
  }

  if (candidate.networkOverageInvoices === undefined) {
    candidate.networkOverageInvoices = []
  }

  if (candidate.subscriptionBaseInvoices === undefined) {
    candidate.subscriptionBaseInvoices = []
  }

  // The driver credential vault. Additive and RUNTIME-ONLY on the same terms: a
  // row validator puts a collection into REQUIRED_TABLES, and the canonical
  // document in production predates both of these, so without this guard the very
  // first read after deploy would refuse the whole document and every request
  // would fail.
  //
  // Empty is also the only honest default. An absent vault means nobody has
  // submitted anything — never that a credential was approved. The consequence is
  // deliberate and load-bearing: on the first read after deploy every existing
  // driver holds nothing, and is therefore blocked from accepting a load until
  // they submit and are approved. Backfilling approvals to keep the platform
  // moving would fabricate a safety claim about real people's insurance.
  //
  // No FIELD-level normalization is needed for these two, unlike routePacks or
  // tripsV2 below: rows are kept by identity rather than by parser output, so a
  // stored row missing a field would keep missing it — but a brand-new collection
  // has no older writer, so every row present was written by a build that already
  // had every field. A field ADDED to either collection later will need an entry
  // here for exactly that reason.
  if (candidate.driverCredentials === undefined) {
    candidate.driverCredentials = []
  }

  if (candidate.credentialReviews === undefined) {
    candidate.credentialReviews = []
  }

  // Driver profiles predate the featured-rig flag; absent means not featured.
  if (Array.isArray(candidate.driverProfiles)) {
    candidate.driverProfiles = candidate.driverProfiles.map((profile) => ({
      ...profile,
      featureTruckPhoto: profile.featureTruckPhoto ?? false
    }))
  }

  if (Array.isArray(candidate.assignments)) {
    candidate.assignments = candidate.assignments.map((assignment) => {
      const hadNoBillingClassification =
        assignment.billingCommittedAt == null &&
        assignment.billingModel == null &&
        assignment.billingPlanCodeAtCommitment == null &&
        assignment.billingSubscriptionIdAtCommitment == null &&
        assignment.capacitySource == null
      const preserveAcceptedLegacyObligation =
        hadNoBillingClassification && Boolean(assignment.assignedAt)
      const load = candidate.loadPostings?.find(
        (posting) => posting.id === assignment.loadPostingId
      )
      const driver = candidate.driverProfiles?.find(
        (profile) => profile.id === assignment.driverProfileId
      )
      const historicalCapacitySource =
        load && driver?.companyId === load.companyId
          ? "private_fleet"
          : "logloads_network"

      return {
        ...assignment,
        billingCommittedAt:
          assignment.billingCommittedAt ??
          (preserveAcceptedLegacyObligation ? assignment.assignedAt ?? null : null),
        billingModel:
          assignment.billingModel ??
          (preserveAcceptedLegacyObligation ? "legacy_percentage" : null),
        billingPlanCodeAtCommitment: assignment.billingPlanCodeAtCommitment ?? null,
        billingSubscriptionIdAtCommitment: assignment.billingSubscriptionIdAtCommitment ?? null,
        capacitySource:
          assignment.capacitySource ??
          (preserveAcceptedLegacyObligation ? historicalCapacitySource : null),
        // A truck-slot reservation is the strongest historical physical-load
        // identity available. This lets a cancelled/replacement assignment on
        // the same reservation converge on one billable movement. Only fall
        // back to the assignment when even that source is unavailable.
        loadMovementId:
          assignment.loadMovementId ??
          assignment.truckSlotId ??
          assignment.id,
        termsSnapshot: assignment.termsSnapshot ?? {}
      }
    })
  }

  if (billingAccountsWereMissing) {
    const explicitLegacyOrganizationIds = new Set<string>()

    for (const profile of candidate.hostBillingProfiles ?? []) {
      explicitLegacyOrganizationIds.add(profile.organizationId)
    }
    for (const fee of candidate.platformFeeEvents ?? []) {
      explicitLegacyOrganizationIds.add(fee.organizationId)
    }
    for (const assignment of candidate.assignments ?? []) {
      if (assignment.billingModel === "legacy_percentage") {
        const load = candidate.loadPostings?.find(
          (posting) => posting.id === assignment.loadPostingId
        )
        if (load) {
          explicitLegacyOrganizationIds.add(load.companyId)
        }
      }
      const hostFee = assignment.termsSnapshot.hostFee
      const collectionState =
        hostFee && typeof hostFee === "object" && !Array.isArray(hostFee)
          ? (hostFee as Record<string, unknown>).collectionState
          : null

      if (collectionState !== "accrues_monthly_in_arrears") {
        continue
      }
      const load = candidate.loadPostings?.find(
        (posting) => posting.id === assignment.loadPostingId
      )
      if (load) {
        explicitLegacyOrganizationIds.add(load.companyId)
      }
    }

    candidate.organizationBillingAccounts = Array.from(
      explicitLegacyOrganizationIds
    ).map((organizationId) => {
      const organization = candidate.organizations?.find(
        (entry) => entry.id === organizationId
      )
      const effectiveAt =
        organization?.createdAt ?? "1970-01-01T00:00:00.000Z"

      return organizationBillingAccountSchema.parse({
        activationState: "legacy",
        billingModel: "legacy_percentage",
        createdAt: effectiveAt,
        effectiveAt,
        id: organizationBillingAccountId(organizationId),
        organizationId,
        subscriptionId: null,
        updatedAt: effectiveAt
      })
    })
  }

  if (Array.isArray(candidate.networkOverageInvoices)) {
    candidate.networkOverageInvoices = candidate.networkOverageInvoices.map((invoice) => ({
      ...invoice,
      adjustmentAmountCents: invoice.adjustmentAmountCents ?? 0,
      adjustmentIds: invoice.adjustmentIds ?? [],
      amountDueCents: invoice.amountDueCents ?? invoice.subtotalCents,
      creditCarryforwardCents: invoice.creditCarryforwardCents ?? 0,
      collectionAttemptCount: invoice.collectionAttemptCount ?? 0,
      lastCollectionAttemptAt: invoice.lastCollectionAttemptAt ?? null,
      lastCollectionFailure: invoice.lastCollectionFailure ?? null,
      providerAmountDueCents: invoice.providerAmountDueCents ?? null,
      providerAmountPaidCents: invoice.providerAmountPaidCents ?? null,
      providerAmountRemainingCents:
        invoice.providerAmountRemainingCents ?? null,
      usageSubtotalCents: invoice.usageSubtotalCents ?? invoice.subtotalCents
    }))
  }

  if (Array.isArray(candidate.subscriptionBaseInvoices)) {
    candidate.subscriptionBaseInvoices =
      candidate.subscriptionBaseInvoices.map((invoice) => ({
        ...invoice,
        amountPaidCents:
          invoice.amountPaidCents ??
          Math.max(
            0,
            invoice.amountDueCents - invoice.amountRemainingCents
          )
      }))
  }

  if (Array.isArray(candidate.billingAdjustments)) {
    candidate.billingAdjustments = candidate.billingAdjustments.map((adjustment) => ({
      ...adjustment,
      minimumChargeWriteoffCents:
        adjustment.minimumChargeWriteoffCents ?? 0,
      providerReference: adjustment.providerReference ?? null,
      providerRevenueDeltaCents:
        adjustment.providerRevenueDeltaCents ?? 0,
      providerSettlementAmountCents:
        adjustment.providerSettlementAmountCents ?? null,
      providerSettlementAttemptCount:
        adjustment.providerSettlementAttemptCount ?? 0,
      providerSettlementFailure:
        adjustment.providerSettlementFailure ?? null,
      providerSettlementLastAttemptAt:
        adjustment.providerSettlementLastAttemptAt ?? null,
      providerSettlementRemainingCents:
        adjustment.providerSettlementRemainingCents ?? null,
      providerSettlementSettledAt:
        adjustment.providerSettlementSettledAt ?? null,
      providerSettlementState:
        adjustment.providerSettlementState ?? "not_started",
      settlementIntent: adjustment.settlementIntent ?? "unapplied"
    }))
  }

  if (Array.isArray(candidate.networkUsageEvents)) {
    candidate.networkUsageEvents = candidate.networkUsageEvents.map((event) => ({
      ...event,
      internalBillingTest:
        event.internalBillingTest ?? event.planCode === "internal_billing_test"
    }))
  }

  if (Array.isArray(candidate.billingPeriodSummaries)) {
    candidate.billingPeriodSummaries = candidate.billingPeriodSummaries.map((summary) => ({
      ...summary,
      internalBillingTest:
        summary.internalBillingTest ?? summary.planCode === "internal_billing_test",
      overageMilestoneIntervalUnits:
        summary.overageMilestoneIntervalUnits ?? 10
    }))
  }

  if (Array.isArray(candidate.organizationSubscriptions)) {
    candidate.organizationSubscriptions = candidate.organizationSubscriptions.map(
      (subscription) => {
        const pendingEffectiveAt = subscription.pendingPlanEffectiveAt ?? null
        const pendingPlanSnapshot =
          subscription.pendingPlanSnapshot ??
          (
            subscription.pendingPlanCode && pendingEffectiveAt
              ? (candidate.billingPlanDefinitions ?? [])
                  .filter(
                    (plan) =>
                      plan.code === subscription.pendingPlanCode &&
                      Date.parse(plan.effectiveAt) <= Date.parse(pendingEffectiveAt)
                  )
                  .sort((left, right) => right.version - left.version)[0] ??
                null
              : null
          )

        return {
          ...subscription,
          activationAuthorizedAt:
            subscription.activationAuthorizedAt ??
            subscription.operationalActivatedAt ??
            null,
          activationAuthorizedByUserId:
            subscription.activationAuthorizedByUserId ??
            (
              subscription.operationalActivatedAt
                ? subscription.acceptedByUserId
                : null
            ),
          cancelAtPeriodEnd:
            subscription.planCode === "network_pilot"
              ? true
              : subscription.cancelAtPeriodEnd,
          conversionGraceEndsAt: subscription.conversionGraceEndsAt ?? null,
          convertedFromPlanCode: subscription.convertedFromPlanCode ?? null,
          convertedFromSubscriptionId:
            subscription.convertedFromSubscriptionId ?? null,
          nonRenewalEffectiveAt:
            subscription.nonRenewalEffectiveAt ?? null,
          operationalActivatedAt: subscription.operationalActivatedAt ?? null,
          operationalExpiredAt: subscription.operationalExpiredAt ?? null,
          operatingMarketIds:
            subscription.operatingMarketIds ??
            (
              subscription.planSnapshot.allowancePeriod !== "none"
                ? ["historical_contract_scope_unrecorded"]
                : []
            ),
          overageMilestoneIntervalUnitsSnapshot:
            subscription.overageMilestoneIntervalUnitsSnapshot ?? 10,
          paymentGraceDaysSnapshot:
            subscription.paymentGraceDaysSnapshot ?? 7,
          paymentGraceEndsAt:
            subscription.graceState === "active"
              ? subscription.paymentGraceEndsAt ??
                new Date(
                  Date.parse(subscription.updatedAt) + 7 * 24 * 60 * 60 * 1000
                ).toISOString()
              : subscription.paymentGraceEndsAt ?? null,
          providerPaymentState:
            subscription.providerPaymentState ??
            subscription.paymentState ??
            "none",
          pendingOperatingMarketIds:
            pendingPlanSnapshot
              ? subscription.pendingOperatingMarketIds ??
                subscription.operatingMarketIds ??
                ["historical_contract_scope_unrecorded"]
              : null,
          pendingCustomTerms:
            pendingPlanSnapshot?.customContract
              ? subscription.pendingCustomTerms ?? {
                  snapshotState: "historical_unrecorded"
                }
              : null,
          pendingPlanSnapshot,
          renewalBehavior:
            subscription.planCode === "network_pilot"
              ? "non_renewing"
              : subscription.renewalBehavior,
          stripeScheduleId: subscription.stripeScheduleId ?? null
        }
      }
    )
  }

  // Route packs predate assignment-specific snapshots. A stored pack carries no
  // assignmentId, so it is a load-level source the host maintains — normalize it
  // here rather than leaving undefined fields for every reader to guess at.
  // Defaults come first so a pack that already has these keeps its own values.
  if (Array.isArray(candidate.routePacks)) {
    candidate.routePacks = candidate.routePacks.map((pack) => ({
      ...pack,
      assignmentId: pack.assignmentId ?? null,
      snapshot: pack.snapshot ?? null,
      supersededAt: pack.supersededAt ?? null,
      version: pack.version ?? 1
    }))
  }

  // Trips predate completion tracking. A stored trip has no completionStatus,
  // and "pending" is the honest reading: nobody has said what came off the
  // truck. A trip already marked completed is left pending too — the delivery
  // happened, the accounting of it never did, and inventing agreement here
  // would fabricate a host confirmation that no one gave.
  if (Array.isArray(candidate.tripsV2)) {
    candidate.tripsV2 = candidate.tripsV2.map((trip) => ({
      ...trip,
      completionConfirmedAt: trip.completionConfirmedAt ?? null,
      completionConfirmedByUserId: trip.completionConfirmedByUserId ?? null,
      completionDisputeReason: trip.completionDisputeReason ?? null,
      completionStatus: trip.completionStatus ?? "pending",
      completionSubmittedAt: trip.completionSubmittedAt ?? null,
      completionSubmittedByUserId: trip.completionSubmittedByUserId ?? null,
      deliveredQuantity: trip.deliveredQuantity ?? null,
      haulException: trip.haulException ?? null
    }))
  }

  // Landing safety rules and destination completion evidence are newer than the
  // documents that hold them. The contract types them as arrays, so a stored row
  // without them would hand every reader an undefined the types deny.
  if (Array.isArray(candidate.richLandingDetails)) {
    candidate.richLandingDetails = candidate.richLandingDetails.map((details) => ({
      ...details,
      safetyRequirements: details.safetyRequirements ?? []
    }))
  }

  if (Array.isArray(candidate.destinationFacilities)) {
    candidate.destinationFacilities = candidate.destinationFacilities.map((facility) => ({
      ...facility,
      completionEvidence: facility.completionEvidence ?? []
    }))
  }

  return candidate
}

function rowIdOf(row: unknown): string | null {
  if (!row || typeof row !== "object") {
    return null
  }

  const id = (row as { id?: unknown }).id

  return typeof id === "string" && id.length > 0 ? id : null
}

function summarizeIssues(issues: ReadonlyArray<RowIssue>): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<row>"}: ${issue.message}`)
    .join("; ")
}

/**
 * Decide, row by row, what the stored document is allowed to contribute to
 * runtime state.
 *
 * FAILURE MODE, and why this one. A row that fails its contract is withheld from
 * runtime state and carried on `withheldRows`; the document as a whole still
 * loads. Refusing the whole document instead would be safe for data but there is
 * exactly one document, so a single malformed row would return every request on
 * every instance to an error page with no partial service to fall back on.
 *
 * The usual objection to quarantining — that it silently loses data — is fatal
 * in THIS store, because state is read whole and written whole: a row dropped at
 * read time would be erased from Postgres by the next compare-and-swap, which is
 * destruction, not degradation. So withheld rows are carried through to the write
 * path and put back into the document that is persisted (see
 * `restoreWithheldRows`). The row never becomes runtime state and never leaves
 * the database. It is loud rather than silent: every finding goes to the reporter
 * once, and the full set rides on every snapshot for a health surface to read.
 *
 * A broken reference is reported but NOT withheld. Dropping a row because
 * something it points at is missing does not restore consistency — it moves the
 * hole, deleting a booking or a trip from the operator's view while the missing
 * target stays missing — and, because the reference list is declared by hand, a
 * mistake in it could otherwise withhold healthy rows. References are checked
 * against every id present in the stored document, including withheld rows, so
 * one bad row can never cascade into withholding the collections that point at
 * it.
 */
export function auditStateSnapshot(value: Partial<LogLoadsDatabaseState>): OperatingStateAudit {
  const candidate = backfillStateSnapshot(value)
  const missingCollections = REQUIRED_TABLES.filter((table) => !Array.isArray(candidate[table]))

  if (missingCollections.length > 0) {
    return { defects: [], missingCollections, state: null, withheldRows: {} }
  }

  const defects: OperatingStateDefect[] = []
  const withheldRows: WithheldOperatingStateRows = {}
  const storedIds = new Map<LogLoadsTableName, Set<string>>()
  const keptRows = new Map<LogLoadsTableName, { indexes: number[]; rows: unknown[] }>()
  const mutable = candidate as unknown as Record<string, unknown[]>

  for (const table of REQUIRED_TABLES) {
    // Array-ness was established by the missing-collection check above.
    const stored = mutable[table] as unknown[]
    const validator = ROW_VALIDATORS[table]
    const ids = new Set<string>()
    const kept: unknown[] = []
    const keptIndexes: number[] = []
    const withheld: unknown[] = []

    for (let index = 0; index < stored.length; index += 1) {
      const row = stored[index]
      const rowId = rowIdOf(row)

      if (rowId !== null && ids.has(rowId)) {
        // Two rows claiming one id is unrepresentable: every reader resolves the
        // first and list scans double-count the second, so the shadow row is
        // already invisible to `find` while inflating every total.
        defects.push({
          collection: table,
          detail: `a row with id ${rowId} appears earlier in this collection`,
          kind: "duplicate_id",
          rowId,
          rowIndex: index,
          withheld: true
        })
        withheld.push(row)
        continue
      }

      if (rowId !== null) {
        ids.add(rowId)
      }

      const verdict = validator.safeParse(row)

      if (verdict.success) {
        // The stored row, not the parser's output. Zod output would drop every
        // field this build has not declared, and the next compare-and-swap would
        // persist the stripped document — the rollout data loss PR #69 fixed for
        // whole collections, one field at a time.
        kept.push(row)
        keptIndexes.push(index)
        continue
      }

      // An unrecognized key is what a NEWER deployment's field looks like from
      // here, not corruption, and only the strict contracts even report it.
      // Withholding a row over one would make a rollout hide live records that
      // the newer instance is still writing.
      if (
        verdict.error.issues.length > 0 &&
        verdict.error.issues.every((issue) => issue.code === "unrecognized_keys")
      ) {
        defects.push({
          collection: table,
          detail: summarizeIssues(verdict.error.issues),
          kind: "unknown_fields",
          rowId,
          rowIndex: index,
          withheld: false
        })
        kept.push(row)
        keptIndexes.push(index)
        continue
      }

      defects.push({
        collection: table,
        detail: summarizeIssues(verdict.error.issues),
        kind: "invalid_row",
        rowId,
        rowIndex: index,
        withheld: true
      })
      withheld.push(row)
    }

    storedIds.set(table, ids)
    keptRows.set(table, { indexes: keptIndexes, rows: kept })

    // Only a collection that actually lost a row is replaced, so a healthy
    // document is handed back holding the very arrays it arrived with.
    if (withheld.length > 0) {
      withheldRows[table] = withheld
      mutable[table] = kept
    }
  }

  for (const table of REQUIRED_TABLES) {
    const references = ROW_REFERENCES[table]

    if (!references) {
      continue
    }

    const survivors = keptRows.get(table)

    if (!survivors) {
      continue
    }

    for (let position = 0; position < survivors.rows.length; position += 1) {
      const row = survivors.rows[position]

      if (!row || typeof row !== "object") {
        continue
      }

      for (const reference of references) {
        const target = (row as Record<string, unknown>)[reference.field]

        if (typeof target !== "string" || storedIds.get(reference.target)?.has(target)) {
          continue
        }

        defects.push({
          collection: table,
          detail: `${reference.field} ${target} is not a stored ${reference.target} id`,
          kind: "missing_reference",
          rowId: rowIdOf(row),
          rowIndex: survivors.indexes[position] ?? position,
          withheld: false
        })
      }
    }
  }

  // Cross-collection financial invariants cannot live in a row schema. Keep the
  // rows visible for repair (withholding either side would hide financial
  // history), but report conflicts on every snapshot and let both write paths
  // refuse to create another claim.
  const runtime = candidate as LogLoadsDatabaseState
  const assignmentsById = new Map(runtime.assignments.map((assignment) => [assignment.id, assignment]))
  const activeUsageByMovement = new Map<string, { id: string; index: number }>()

  runtime.networkUsageEvents.forEach((event, index) => {
    if (event.status === "reversed") {
      return
    }

    const prior = activeUsageByMovement.get(event.loadMovementId)

    if (prior) {
      defects.push({
        collection: "networkUsageEvents",
        detail: `physical movement ${event.loadMovementId} is already claimed by usage event ${prior.id}`,
        kind: "billing_conflict",
        rowId: event.id,
        rowIndex: index,
        withheld: false
      })
    } else {
      activeUsageByMovement.set(event.loadMovementId, { id: event.id, index })
    }

    const assignment = assignmentsById.get(event.assignmentId)

    if (
      assignment &&
      (
        assignment.loadMovementId !== event.loadMovementId ||
        assignment.capacitySource !== "logloads_network" ||
        (
          assignment.billingModel !== "subscription_v1" &&
          assignment.billingModel !== "enterprise_custom"
        )
      )
    ) {
      defects.push({
        collection: "networkUsageEvents",
        detail: `usage event classification disagrees with committed assignment ${assignment.id}`,
        kind: "billing_conflict",
        rowId: event.id,
        rowIndex: index,
        withheld: false
      })
    }
  })

  runtime.platformFeeEvents.forEach((event) => {
    if (event.status === "voided") {
      return
    }

    const assignment = assignmentsById.get(event.assignmentId)
    const movementId = assignment?.loadMovementId ?? event.assignmentId
    const usage = activeUsageByMovement.get(movementId)

    if (usage) {
      defects.push({
        collection: "networkUsageEvents",
        detail: `physical movement ${movementId} has legacy fee ${event.id} and Network usage ${usage.id}`,
        kind: "billing_conflict",
        rowId: usage.id,
        rowIndex: usage.index,
        withheld: false
      })
    }
  })

  return { defects, missingCollections: [], state: candidate as LogLoadsDatabaseState, withheldRows }
}

/**
 * Normalize and validate a stored document for runtime use. Returns null when a
 * required collection is missing or is not an array — the one condition that
 * refuses the whole document.
 *
 * A returned state carries only rows their contract accepted, plus rows a strict
 * contract rejected solely for holding keys this build does not declare. It does
 * NOT carry the withheld rows, so a caller that persists what it gets back will
 * erase them: any write path must go through `auditStateSnapshot` and hand
 * `withheldRows` to `updateRemoteOperatingState`.
 */
export function upgradeStateSnapshot(
  value: Partial<LogLoadsDatabaseState>
): LogLoadsDatabaseState | null {
  const audit = auditStateSnapshot(value)

  publishReport(audit)

  return audit.state
}

export function loadStateSnapshot(filePath: string): LogLoadsDatabaseState | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return upgradeStateSnapshot(
      JSON.parse(readFileSync(filePath, "utf8")) as Partial<LogLoadsDatabaseState>
    )
  } catch {
    return null
  }
}

/** Persist a local-development snapshot atomically. Production uses Supabase. */
export async function persistStateSnapshot(
  filePath: string,
  state: LogLoadsDatabaseState
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = join(dirname(filePath), `.${process.pid}-${Date.now()}.snapshot.tmp`)

  await writeFile(temporaryPath, JSON.stringify(state), "utf8")
  await rename(temporaryPath, filePath)
}

/** Server-only canonical store config. The service-role key is never exposed. */
export function remoteSnapshotConfig(): RemoteSnapshotConfig | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return { key, url: url.replace(/\/$/, "") }
}

function requestHeaders(config: RemoteSnapshotConfig): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${config.key}`,
    apikey: config.key
  }
}

async function responseRows(response: Response): Promise<unknown[]> {
  try {
    const value = (await response.json()) as unknown

    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

type RemoteRowOutcome =
  | { ok: true; snapshot: RemoteOperatingStateSnapshot }
  | { ok: false; reason: string }

function parseRemoteRow(value: unknown): RemoteRowOutcome {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "no operating_state row was returned" }
  }

  const row = value as {
    schema_version?: unknown
    state?: Partial<LogLoadsDatabaseState>
    version?: unknown
  }
  const schemaVersion = row.schema_version === undefined ? 1 : Number(row.schema_version)
  const version = row.version === undefined ? 0 : Number(row.version)

  // A snapshot written by a NEWER deployment is accepted, provided every
  // required collection is present. The version number adds nothing to that.
  //
  // Why: `main` auto-deploys, so old and new instances serve traffic at the same
  // time during every rollout. Refusing a higher schema version made the newer
  // instance's first write break every older instance still running — the whole
  // fleet returning "operating state is invalid" until the rollout finished.
  //
  // What survives an older instance writing back, precisely: the STATE document
  // does, including collections this build has never heard of, because the
  // backfill spreads the row it was given, rows are kept by identity rather than
  // reparsed, and the CAS writes that whole draft back. The `schema_version`
  // LABEL does not — `updateRemoteOperatingState` always stamps it with this
  // build's own constant, so during a rollout the row's version can go 3 → 2 → 3
  // while the data itself is never lost. That is safe only because every backfill
  // keys on whether a field is present, never on the version number; nothing may
  // be built on this label being monotonic.
  //
  // A version BELOW 1 is still refused: that is a malformed row, not a future
  // one. This does not authorise a version bump — nothing in this program bumps
  // it — it makes one survivable when it eventually happens.
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, reason: `schema_version ${String(row.schema_version)} is not a stored version` }
  }

  if (!Number.isSafeInteger(version) || version < 0) {
    return { ok: false, reason: `version ${String(row.version)} is not a stored version` }
  }

  if (!row.state || typeof row.state !== "object") {
    return { ok: false, reason: "the row carries no state document" }
  }

  const audit = auditStateSnapshot(row.state)

  publishReport(audit)

  if (!audit.state) {
    // Named, not counted: REQUIRED_TABLES is the type's collection list, so this
    // is what a deploy that adds a collection without a backfill looks like from
    // production, and the collection name is the whole diagnosis.
    return {
      ok: false,
      reason: `collections missing or not an array: ${audit.missingCollections.join(", ")}`
    }
  }

  return {
    ok: true,
    snapshot: {
      defects: audit.defects,
      schemaVersion,
      state: audit.state,
      version,
      withheldRows: audit.withheldRows
    }
  }
}

/**
 * Put withheld rows back into the document being persisted. They are appended,
 * always, and never merged by id: the application cannot see these rows, so
 * treating a write that does not mention one as permission to delete it would
 * make every ordinary mutation a destructive operation. Repairing a withheld row
 * is a database task, and the row stays there until somebody does it.
 *
 * A healthy document has none of these, so this is a no-op on every normal write.
 */
function restoreWithheldRows(
  state: LogLoadsDatabaseState,
  withheldRows: WithheldOperatingStateRows
): LogLoadsDatabaseState {
  const entries = Object.entries(withheldRows) as Array<[LogLoadsTableName, unknown[]]>

  if (entries.length === 0) {
    return state
  }

  const merged = { ...state } as unknown as Record<string, unknown>

  for (const [table, rows] of entries) {
    if (rows.length === 0) {
      continue
    }

    const current = merged[table]

    merged[table] = Array.isArray(current) ? [...current, ...rows] : [...rows]
  }

  return merged as unknown as LogLoadsDatabaseState
}

export async function loadRemoteOperatingState(
  config: RemoteSnapshotConfig,
  timeoutMs = 8000
): Promise<RemoteOperatingStateSnapshot | null> {
  for (let attempt = 1; attempt <= REMOTE_READ_ATTEMPTS; attempt += 1) {
    let response: Response

    try {
      response = await fetch(
        `${config.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&select=state,version,schema_version`,
        {
          headers: requestHeaders(config),
          signal: AbortSignal.timeout(timeoutMs)
        }
      )
    } catch (error) {
      if (attempt < REMOTE_READ_ATTEMPTS) {
        continue
      }

      throw new OperatingStateUnavailableError(
        `Canonical operating state could not be reached: ${error instanceof Error ? error.message : "network error"}`
      )
    }

    if (!response.ok) {
      const transient = response.status === 408 || response.status === 429 || response.status >= 500

      if (transient && attempt < REMOTE_READ_ATTEMPTS) {
        await response.body?.cancel().catch(() => undefined)
        continue
      }

      throw new OperatingStateUnavailableError(
        `Canonical operating state read failed with status ${response.status}`
      )
    }

    const rows = await responseRows(response)

    if (rows.length === 0) {
      return null
    }

    const outcome = parseRemoteRow(rows[0])

    if (!outcome.ok) {
      throw new OperatingStateUnavailableError(
        `Canonical operating state is invalid: ${outcome.reason}`
      )
    }

    return outcome.snapshot
  }

  throw new OperatingStateUnavailableError("Canonical operating state could not be reached")
}

/**
 * Bootstrap an empty canonical table. Conflict-ignore makes concurrent cold
 * starts safe: exactly one insert wins and every caller then loads that row.
 */
export async function initializeRemoteOperatingState(
  config: RemoteSnapshotConfig,
  state: LogLoadsDatabaseState,
  timeoutMs = 8000
): Promise<RemoteOperatingStateSnapshot> {
  const existing = await loadRemoteOperatingState(config, timeoutMs)

  if (existing) {
    return existing
  }

  let response: Response

  try {
    response = await fetch(`${config.url}/rest/v1/operating_state`, {
      body: JSON.stringify({
        id: SNAPSHOT_ROW_ID,
        schema_version: OPERATING_STATE_SCHEMA_VERSION,
        state,
        version: 0
      }),
      headers: {
        ...requestHeaders(config),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state bootstrap could not be reached: ${error instanceof Error ? error.message : "network error"}`
    )
  }

  if (!response.ok) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state bootstrap failed with status ${response.status}`
    )
  }

  const inserted = parseRemoteRow((await responseRows(response))[0])

  if (inserted.ok) {
    return inserted.snapshot
  }

  const raced = await loadRemoteOperatingState(config, timeoutMs)

  if (!raced) {
    throw new OperatingStateUnavailableError("Canonical operating state bootstrap returned no row")
  }

  return raced
}

/**
 * Compare-and-swap a complete state document. A zero-row response is a normal
 * stale-version conflict, never permission to overwrite the newer document.
 */
export async function updateRemoteOperatingState(
  config: RemoteSnapshotConfig,
  state: LogLoadsDatabaseState,
  expectedVersion: number,
  timeoutMs = 8000,
  withheldRows: WithheldOperatingStateRows = {}
): Promise<RemoteOperatingStateSnapshot | null> {
  let response: Response

  try {
    response = await fetch(
      `${config.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&version=eq.${expectedVersion}`,
      {
        body: JSON.stringify({
          schema_version: OPERATING_STATE_SCHEMA_VERSION,
          state: restoreWithheldRows(state, withheldRows),
          updated_at: new Date().toISOString(),
          version: expectedVersion + 1
        }),
        headers: {
          ...requestHeaders(config),
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        method: "PATCH",
        signal: AbortSignal.timeout(timeoutMs)
      }
    )
  } catch (error) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state update could not be reached: ${error instanceof Error ? error.message : "network error"}`
    )
  }

  if (!response.ok) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state update failed with status ${response.status}`
    )
  }

  const rows = await responseRows(response)

  if (rows.length === 0) {
    return null
  }

  const outcome = parseRemoteRow(rows[0])

  if (!outcome.ok) {
    throw new OperatingStateUnavailableError(
      `Canonical operating state update returned invalid data: ${outcome.reason}`
    )
  }

  return outcome.snapshot
}

/**
 * Run a deterministic state-only mutation with optimistic retry. The callback
 * can run more than once and therefore must not perform email, analytics, or
 * other external side effects.
 */
export async function mutateRemoteOperatingState<T>(
  config: RemoteSnapshotConfig,
  initialSnapshot: RemoteOperatingStateSnapshot,
  mutate: (state: LogLoadsDatabaseState, attempt: number) => T,
  options: { maxAttempts?: number; timeoutMs?: number } = {}
): Promise<RemoteMutationResult<T>> {
  const maxAttempts = options.maxAttempts ?? 4
  const timeoutMs = options.timeoutMs ?? 8000
  let current = initialSnapshot

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = structuredClone(current.state)
    const value = mutate(draft, attempt)
    // The withheld rows travel with the snapshot the draft came from, so the
    // document that lands in Postgres still contains them.
    const committed = await updateRemoteOperatingState(
      config,
      draft,
      current.version,
      timeoutMs,
      current.withheldRows
    )

    if (committed) {
      return { attempts: attempt, snapshot: committed, value }
    }

    const latest = await loadRemoteOperatingState(config, timeoutMs)

    if (!latest) {
      throw new OperatingStateUnavailableError("Canonical operating state disappeared during retry")
    }

    current = latest
  }

  throw new OperatingStateConflictError(maxAttempts)
}

/** Backward-compatible state-only read for tooling that does not need metadata. */
export async function loadRemoteSnapshot(
  config: RemoteSnapshotConfig,
  timeoutMs = 8000
): Promise<LogLoadsDatabaseState | null> {
  return (await loadRemoteOperatingState(config, timeoutMs))?.state ?? null
}
