import "server-only"

import type { MarketplaceAdminAction } from "@logloads/contracts"

import type { NormalizedFeature } from "../normalized-adapter"
import { MARKETPLACE_FUNCTIONS } from "../normalized-db"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { unavailableMarketplaceV2Feature, type MarketplaceAdminPort } from "../port"
import { adminMethods } from "./methods"
import { ADMIN_FUNCTIONS, ADMIN_STATEMENT_NAMES, type AdminStatementName } from "./statements"

/**
 * admin (#255): LogLoads staff tools (verification, moderation, reports, grants), over the normalized store.
 *
 * The writes and private reads call the stage 03, 11, 16 and 33 functions already in `MARKETPLACE_FUNCTIONS`
 * (normalized-db.ts); each checks the staff role and writes the audit row. The lists and the person's own staff role
 * are table reads in `statements.ts`, and the queue counts need a new function, `admin_queue_counts`, because the
 * moderation holds have no client grant. Both catalogues are shared files this task does not edit. Until they hold
 * everything every method needs, the whole group refuses with `MarketplaceFeatureUnavailableError` and reaches no
 * store, as the shared port v3 test requires of a group that is not supported:
 *
 * - `admin_queue_counts` is not in stages 01–34: it needs a schema stage (SQL on #255), then its catalogue entry;
 * - `admin_roles`, `admin_verification_queue` and `admin_reports` wait on their `MARKETPLACE_QUERIES` entries.
 *
 * The 12-month verification lapse (`./lapse-worker.ts`) runs on a worker's service-role connection and needs
 * `lapse_expired_org_verifications` (SQL on #255). `supported` stays false until that wiring is on; the task that
 * completes it sets it and updates the shared test.
 */

/** What each port method runs through the adapter: catalogue functions it calls and this group's statements. */
export const ADMIN_METHOD_NEEDS: Readonly<Record<keyof MarketplaceAdminPort, { functions: readonly string[]; statements: readonly AdminStatementName[] }>> = {
  adminAccess: { functions: [], statements: ["admin_roles"] },
  adminGrantFoundingHaulerBadge: { functions: ["admin_grant_founding_hauler_badge"], statements: ["admin_roles"] },
  adminGrantFoundingPromotion: { functions: ["admin_grant_founding_promotion"], statements: ["admin_roles"] },
  adminModerateJob: { functions: ["admin_moderate_job_posting"], statements: ["admin_roles"] },
  adminQueue: { functions: ["admin_queue_counts"], statements: ["admin_roles"] },
  adminReadInquiryThread: { functions: ["admin_read_interest_thread"], statements: ["admin_roles"] },
  adminReadLandingPrivate: { functions: ["admin_read_landing_private"], statements: ["admin_roles"] },
  adminReleaseJobHold: { functions: ["admin_release_job_moderation_hold"], statements: ["admin_roles"] },
  adminReports: { functions: [], statements: ["admin_roles", "admin_reports"] },
  adminResolveReport: { functions: ["admin_resolve_report"], statements: ["admin_roles"] },
  adminSetVerification: { functions: ["admin_set_org_verification"], statements: ["admin_roles"] },
  adminVerificationQueue: { functions: [], statements: ["admin_roles", "admin_verification_queue"] }
}

/** The staff action each method is, for its role check (`MARKETPLACE_ADMIN_ACTION_ROLES`). `adminAccess` needs none. */
export const ADMIN_METHOD_ACTIONS: Readonly<Record<Exclude<keyof MarketplaceAdminPort, "adminAccess">, MarketplaceAdminAction>> = {
  adminGrantFoundingHaulerBadge: "grantFoundingHaulerBadge",
  adminGrantFoundingPromotion: "grantFoundingPromotion",
  adminModerateJob: "moderateJob",
  adminQueue: "queue",
  adminReadInquiryThread: "readInquiryThread",
  adminReadLandingPrivate: "readLandingPrivate",
  adminReleaseJobHold: "releaseJobHold",
  adminReports: "reports",
  adminResolveReport: "resolveReport",
  adminSetVerification: "setVerification",
  adminVerificationQueue: "verificationQueue"
}

export interface AdminCatalogue {
  functions: ReadonlySet<string>
  statements: ReadonlySet<string>
}

const CATALOGUE: AdminCatalogue = {
  functions: new Set(Object.keys(MARKETPLACE_FUNCTIONS)),
  statements: new Set(Object.keys(MARKETPLACE_QUERIES))
}

/** The functions and statements this group runs that the catalogues do not have yet. */
export function missingAdminCatalogueEntries(catalogue: AdminCatalogue = CATALOGUE): { functions: string[]; statements: string[] } {
  const functions = new Set<string>(ADMIN_FUNCTIONS)

  for (const needs of Object.values(ADMIN_METHOD_NEEDS)) {
    for (const name of needs.functions) functions.add(name)
  }

  return {
    functions: [...functions].filter((name) => !catalogue.functions.has(name)).sort(),
    statements: [...ADMIN_STATEMENT_NAMES].filter((name) => !catalogue.statements.has(name)).sort()
  }
}

/** True once the catalogues hold every function and statement any admin method runs. */
export function adminCatalogueReady(catalogue: AdminCatalogue = CATALOGUE): boolean {
  const missing = missingAdminCatalogueEntries(catalogue)

  return missing.functions.length === 0 && missing.statements.length === 0
}

export const normalizedAdmin: NormalizedFeature<"admin"> = {
  methods: (context) => (adminCatalogueReady() ? adminMethods(context) : unavailableMarketplaceV2Feature("admin")),
  supported: false
}

export { adminMethods } from "./methods"
export {
  runVerificationLapse,
  type VerificationLapseOptions,
  type VerificationLapseRun,
  type VerificationLapseStore
} from "./lapse-worker"
