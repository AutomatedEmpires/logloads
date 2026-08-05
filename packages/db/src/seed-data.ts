import {
  assignmentSchema,
  auditEventSchema,
  availabilityWindowSchema,
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
  landingSchema,
  loaderProfileSchema,
  loggingCompanySchema,
  loadPostingSchema,
  messageEventSchema,
  messageThreadSchema,
  millSchema,
  notificationSchema,
  operationalNoticeSchema,
  opportunityCapacitySchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationInvitationSchema,
  organizationMembershipSchema,
  organizationSchema,
  privateNetworkRelationshipSchema,
  rateSchema,
  richLandingDetailsSchema,
  routePackSchema,
  trailerProfileSchema,
  tripDocumentSchema,
  tripEventSchema,
  tripReviewSchema,
  tripSchemaV2,
  truckProfileSchema,
  truckSlotSchema,
  userSchema,
  verificationRecordSchema,
  PERCENTAGE_V1_TERMS_VERSION,
  SUBSCRIPTION_PLAN_CATALOG,
  PLATFORM_FEE_BPS,
  type Assignment,
  type AuditEvent,
  type AvailabilityWindow,
  type CredentialReview,
  type DestinationFacility,
  type DirectOffer,
  type DispatcherProfile,
  type DriverCredential,
  type DriverProfile,
  type Entitlement,
  type EquipmentCombination,
  type FutureAvailability,
  type HaulRoute,
  type HostBillingProfile,
  type Landing,
  type LoaderProfile,
  type LoggingCompany,
  type LoadPosting,
  type MessageEvent,
  type MessageThread,
  type Mill,
  type Notification,
  type OperationalNotice,
  type OpportunityCapacity,
  type Organization,
  type OrganizationBillingAccount,
  type OrganizationInvitation,
  type OrganizationMembership,
  type PrivateNetworkRelationship,
  type Rate,
  type RichLandingDetails,
  type RoutePack,
  type TrailerProfile,
  type TripDocument,
  type TripEvent,
  type TripReview,
  type TripV2,
  type TruckProfile,
  type TruckSlot,
  type User,
  type VerificationRecord
} from "@logloads/contracts"

import type { LogLoadsDatabaseState } from "./types"

const parseMany = <T>(schema: { parse: (value: unknown) => T }, values: unknown[]): T[] =>
  values.map((value) => schema.parse(value))

const timestamps = {
  created: "2026-06-04T16:00:00.000Z",
  updated: "2026-06-04T16:00:00.000Z",
  requested: "2026-06-05T12:00:00.000Z",
  assigned: "2026-06-05T13:00:00.000Z",
  completed: "2026-06-05T19:30:00.000Z",
  cancelled: "2026-06-05T14:45:00.000Z"
}

export const seedProfiles: User[] = parseMany(userSchema, [
  {
    id: "11111111-1111-4111-8111-111111111111",
    clerkUserId: "clerk-admin-1",
    role: "admin",
    fullName: "LogLoads Admin",
    phone: "555-0001",
    email: "admin@logloads.example",
    companyId: null,
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222221",
    clerkUserId: "clerk-driver-1",
    role: "driver",
    fullName: "Hank Hauler",
    phone: "555-1001",
    email: "hank@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    clerkUserId: "clerk-driver-2",
    role: "driver",
    fullName: "Maya Mills",
    phone: "555-1002",
    email: "maya@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222223",
    clerkUserId: "clerk-driver-3",
    role: "owner_operator",
    fullName: "Cole Cedar",
    phone: "555-1003",
    email: "cole@summit.example",
    companyId: "33333333-3333-4333-8333-333333333332",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222224",
    clerkUserId: "clerk-dispatch-1",
    role: "dispatcher",
    fullName: "Dana Dispatch",
    phone: "555-2001",
    email: "dispatch@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222225",
    clerkUserId: "clerk-loader-1",
    role: "loader",
    fullName: "Lee Loader",
    phone: "555-2002",
    email: "loader@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222226",
    clerkUserId: "clerk-driver-4",
    role: "driver",
    fullName: "Riley Rivers",
    phone: "555-1004",
    email: "riley@northpine.example",
    companyId: "33333333-3333-4333-8333-333333333331",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222227",
    clerkUserId: "clerk-empty-fleet-1",
    role: "dispatcher",
    fullName: "Morgan Newfleet",
    phone: "555-4001",
    email: "emptyfleet@logloads.example",
    companyId: "33333333-3333-4333-8333-333333333334",
    verificationStatus: "pending",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "22222222-2222-4222-8222-222222222228",
    clerkUserId: "clerk-driver-5",
    role: "driver",
    fullName: "Taylor Timber",
    phone: "555-1005",
    email: "taylor@summit.example",
    companyId: "33333333-3333-4333-8333-333333333332",
    verificationStatus: "verified",
    isActive: true,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedCompanies: LoggingCompany[] = parseMany(loggingCompanySchema, [
  {
    id: "33333333-3333-4333-8333-333333333331",
    slug: "north-pine-logging",
    legalName: "North Pine Logging LLC",
    displayName: "North Pine Logging",
    verificationStatus: "verified",
    primaryRegion: "Cascade Foothills",
    contact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    notes: "Primary production crew covering weekday chip and saw-log runs.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    slug: "summit-ridge-timber",
    legalName: "Summit Ridge Timber Inc.",
    displayName: "Summit Ridge Timber",
    verificationStatus: "verified",
    primaryRegion: "Blue River Corridor",
    contact: {
      name: "Cole Cedar",
      phone: "555-1003",
      email: "cole@summit.example"
    },
    notes: "Owner-operator heavy outfit handling mixed terrain landings.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "33333333-3333-4333-8333-333333333334",
    slug: "new-river-hauling",
    legalName: "New River Hauling LLC",
    displayName: "New River Hauling",
    verificationStatus: "pending",
    primaryRegion: "Cascade Foothills",
    contact: {
      name: "Morgan Newfleet",
      phone: "555-4001",
      email: "emptyfleet@logloads.example"
    },
    notes: "Synthetic empty-state organization for the local founder demo.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedDriverProfiles: DriverProfile[] = parseMany(driverProfileSchema, [
  {
    id: "44444444-4444-4444-8444-444444444441",
    userId: "22222222-2222-4222-8222-222222222221",
    companyId: "33333333-3333-4333-8333-333333333331",
    availabilityStatus: "available",
    licenseNumber: "CDL-A-9001",
    yearsExperience: 11,
    homeBase: "Cascade Foothills",
    equipmentPreferences: ["tridem", "self-loader"],
    notes: "Prefers sunrise dispatch and chip loads.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    userId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333331",
    availabilityStatus: "limited",
    licenseNumber: "CDL-A-9002",
    yearsExperience: 7,
    homeBase: "Oak Landing",
    equipmentPreferences: ["pole-trailer"],
    notes: "Unavailable after 16:00 on Fridays.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    userId: "22222222-2222-4222-8222-222222222223",
    companyId: "33333333-3333-4333-8333-333333333332",
    availabilityStatus: "available",
    licenseNumber: "CDL-A-9003",
    yearsExperience: 14,
    homeBase: "Blue River",
    equipmentPreferences: ["bunk-trailer", "chains"],
    notes: "Comfortable with snowy high-grade routes.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "22222222-2222-4222-8222-222222222226",
    companyId: "33333333-3333-4333-8333-333333333331",
    availabilityStatus: "unavailable",
    licenseNumber: "CDL-A-9004",
    yearsExperience: 5,
    homeBase: "Cascade Foothills",
    equipmentPreferences: ["pole-trailer"],
    notes: "Truck is out of service; do not assign until availability changes.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "44444444-4444-4444-8444-444444444445",
    userId: "22222222-2222-4222-8222-222222222228",
    companyId: "33333333-3333-4333-8333-333333333332",
    availabilityStatus: "available",
    licenseNumber: "CDL-A-9005",
    yearsExperience: 9,
    homeBase: "Blue River",
    equipmentPreferences: ["bunk-trailer", "chains"],
    notes: "Assigned to Summit Ridge high-grade work.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

/**
 * ── The seeded credential vault ───────────────────────────────────────────────
 *
 * ONE driver is fully cleared, and only one. Hank (…441) is the driver every
 * seeded e2e journey signs in as to request a haul, so his vault is complete and
 * valid — without it those journeys would fail on a credential rule they were not
 * written to test.
 *
 * EVERY OTHER SEEDED DRIVER IS BLOCKED, deliberately. A seeded approval is a
 * claim that somebody's insurance and licence were submitted and checked; handing
 * one to five synthetic drivers so the bench looks busy would be a fabricated
 * safety claim, which is the exact class of lie this product refuses everywhere
 * else. So the blocked paths are the ones that carry real coverage here:
 *
 *   Maya (…442)   — licence approved, insurance came back needing more evidence,
 *                   no equipment photos at all. Blocked WITH a reason to act on.
 *   Taylor (…445) — insurance approved but LAPSED in January, with the renewal
 *                   still under review. Blocked by expiry, not by absence.
 *   Cole (…443), Riley (…444) — nothing submitted. Blocked on an empty vault.
 *
 * Maya and Taylor already have completed hauls in this seed. That is not a
 * contradiction: the vault is newer than that history, and a rule does not
 * retroactively un-happen a load that was hauled before it existed.
 *
 * The 30-day expiry WARNING has no fixture here, because it cannot have one: the
 * window is measured against the caller's clock, and a static seed would either go
 * stale or need a moving date. It is proven in
 * packages/contracts/src/credentials.test.ts against explicit instants instead.
 */

/**
 * A synthetic stored-document reference for the seeded vault.
 *
 * It resolves to nothing. A media reference names a provider and a public id but
 * no project, so this points at no media object at all. Same posture as the
 * synthetic Stripe ids further down: an obviously fake reference to an object a
 * provider would hold, never real bytes.
 *
 * It exists because `credentialIsValidAt` refuses an approved credential with no
 * document. That rule is what stops a self-certified approval from counting, so
 * the bench has to satisfy it the same way a real driver would.
 */
const syntheticCredentialDocument = (slug: string, uploadedAt: string) => ({
  provider: "supabase" as const,
  publicId: `logloads/driver-credentials/${slug}`,
  version: 1,
  format: "jpg" as const,
  width: 1_240,
  height: 1_754,
  bytes: 486_000,
  uploadedAt
})

const credentialClock = {
  submitted: "2026-06-01T09:00:00.000Z",
  reviewed: "2026-06-01T09:04:00.000Z",
  lapsedSubmitted: "2026-01-05T09:00:00.000Z",
  lapsedReviewed: "2026-01-05T09:03:00.000Z",
  renewalSubmitted: "2026-06-02T15:20:00.000Z"
}

export const seedDriverCredentials: DriverCredential[] = parseMany(driverCredentialSchema, [
  {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    kind: "insurance",
    status: "approved",
    documentMedia: syntheticCredentialDocument("np-101-liability", credentialClock.submitted),
    issuer: "Cascade Mutual Insurance",
    identifier: "CM-4471-002",
    issuedOn: "2025-07-01T00:00:00.000Z",
    // Comfortably past any clock this bench runs under. A fixture that lapses
    // while nobody is looking would break every e2e journey with a failure that
    // reads as a bug in the acceptance flow.
    expiresOn: "2027-06-30T23:59:59.000Z",
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes: "Approved. Send us the new certificate before 30 June 2027 to stay eligible.",
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c102",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    kind: "cdl",
    status: "approved",
    documentMedia: syntheticCredentialDocument("hank-licence", credentialClock.submitted),
    issuer: "Oregon DMV",
    identifier: "CDL-A-9001",
    issuedOn: "2023-03-14T00:00:00.000Z",
    expiresOn: "2029-03-14T23:59:59.000Z",
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes: "Approved. The licence class and the expiry date both read clearly.",
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c103",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    kind: "truck",
    status: "approved",
    documentMedia: syntheticCredentialDocument("np-101-truck", credentialClock.submitted),
    // A photograph has no issuer and no expiry. null here means exactly that,
    // and the gate reads it as "cannot lapse" rather than as missing data.
    issuer: null,
    identifier: "NP-101",
    issuedOn: null,
    expiresOn: null,
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes: "Approved. Unit number NP-101 matches the truck on your profile.",
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c104",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    kind: "trailer",
    status: "approved",
    documentMedia: syntheticCredentialDocument("trl-101-trailer", credentialClock.submitted),
    issuer: null,
    identifier: "TRL-101",
    issuedOn: null,
    expiresOn: null,
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes: "Approved. The stakes and the unit number are both visible.",
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c105",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    kind: "cdl",
    status: "approved",
    documentMedia: syntheticCredentialDocument("maya-licence", credentialClock.submitted),
    issuer: "Oregon DMV",
    identifier: "CDL-A-9002",
    issuedOn: "2022-11-30T00:00:00.000Z",
    expiresOn: "2028-11-30T23:59:59.000Z",
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes: "Approved.",
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    // The actionable refusal: something was submitted, it could not be read, and
    // the driver is told exactly which page to photograph again. Nothing is
    // extracted, because nothing was legible — inventing an issuer here would be
    // the platform guessing at an insurer on a driver's behalf.
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c106",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    kind: "insurance",
    status: "more_info_required",
    documentMedia: syntheticCredentialDocument("maya-liability-page-1", credentialClock.submitted),
    issuer: null,
    identifier: null,
    issuedOn: null,
    expiresOn: null,
    submittedAt: credentialClock.submitted,
    reviewedAt: credentialClock.reviewed,
    reviewNotes:
      "We can read your insurer's name but not the expiry date — the bottom of the page is cut off.",
    requestedEvidence: [
      "A photo of the page that shows the policy expiry date",
      "The full page, with all four corners in frame"
    ],
    supersededByCredentialId: null,
    createdAt: credentialClock.submitted,
    updatedAt: credentialClock.reviewed
  },
  {
    // Approved, and lapsed anyway. January 2026 is in the past for the June bench
    // clock AND for any real clock this seed will ever be read under, so "an
    // expired credential stops counting" is demonstrable rather than dependent on
    // when somebody runs it.
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c107",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    kind: "insurance",
    status: "approved",
    documentMedia: syntheticCredentialDocument("taylor-liability-2025", credentialClock.lapsedSubmitted),
    issuer: "Cascade Mutual Insurance",
    identifier: "CM-9920-117",
    issuedOn: "2025-01-31T00:00:00.000Z",
    expiresOn: "2026-01-31T23:59:59.000Z",
    submittedAt: credentialClock.lapsedSubmitted,
    reviewedAt: credentialClock.lapsedReviewed,
    reviewNotes: "Approved. Send the new certificate before 31 January 2026 to stay eligible.",
    requestedEvidence: [],
    // A renewal REPLACES rather than rewrites: this row keeps saying what was
    // approved in January, and the pointer says where the current record is.
    supersededByCredentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c108",
    createdAt: credentialClock.lapsedSubmitted,
    // June, not January: `reviewedAt` is when the decision was made and never
    // moves, while `updatedAt` is when this row last changed — which was the day
    // the renewal arrived and the pointer above was written.
    updatedAt: credentialClock.renewalSubmitted
  },
  {
    // The renewal, awaiting review. Pending, so it carries no reviewedAt, no
    // review row, and no normalized dates — nobody has read it yet, and a
    // pre-filled expiry would be the platform assuming what the document says.
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c108",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    kind: "insurance",
    status: "pending",
    documentMedia: syntheticCredentialDocument("taylor-liability-2026", credentialClock.renewalSubmitted),
    issuer: null,
    identifier: null,
    issuedOn: null,
    expiresOn: null,
    submittedAt: credentialClock.renewalSubmitted,
    reviewedAt: null,
    reviewNotes: null,
    requestedEvidence: [],
    supersededByCredentialId: null,
    createdAt: credentialClock.renewalSubmitted,
    updatedAt: credentialClock.renewalSubmitted
  }
])

/**
 * The decision trail behind the vault above. One row per decision, append-only.
 *
 * `decidedBy: "ai"` with `model: "seed-synthetic-reviewer"` — deliberately not the
 * name of a real model. No AI reviewer is wired yet, so naming one would claim an
 * integration that does not exist; the row contract requires an AI decision to
 * name its decider, and this is the honest thing to put there.
 *
 * `confidence` is null on every row for the same reason. A fabricated 0.97 would
 * be a fabricated measurement, and it would be the number a driver was shown when
 * they asked how sure the machine was.
 *
 * Taylor's pending renewal has no row here at all: nothing has been decided about
 * it, and an empty trail is what "awaiting review" actually looks like.
 */
export const seedCredentialReviews: CredentialReview[] = parseMany(credentialReviewSchema, [
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c201",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["kind_matches_document", "holder_name_matches_profile", "expiry_is_in_the_future"],
    rationale:
      "The certificate names Hank Hauler, is issued by Cascade Mutual Insurance and runs to 30 June 2027.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "insurance",
      holderName: "Hank Hauler",
      issuer: "Cascade Mutual Insurance",
      identifier: "CM-4471-002",
      // As PRINTED on the page, not normalized. The credential row holds the
      // platform's instants; this holds what was on the document.
      issuedOn: "07/01/2025",
      expiresOn: "06/30/2027",
      unitNumber: null,
      plateNumber: null
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c202",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c102",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["kind_matches_document", "holder_name_matches_profile", "expiry_is_in_the_future"],
    rationale: "A Class A licence for Hank Hauler, valid to 14 March 2029.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "cdl",
      holderName: "Hank Hauler",
      issuer: "Oregon DMV",
      identifier: "CDL-A-9001",
      issuedOn: "03/14/2023",
      expiresOn: "03/14/2029",
      unitNumber: null,
      plateNumber: null
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c203",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c103",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["unit_number_matches_profile", "plate_is_legible"],
    rationale: "The photo shows a log truck carrying unit number NP-101 and plate LOG101.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "truck",
      holderName: null,
      issuer: null,
      identifier: null,
      issuedOn: null,
      expiresOn: null,
      unitNumber: "NP-101",
      plateNumber: "LOG101"
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c204",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c104",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["unit_number_matches_profile"],
    rationale: "The photo shows a pole trailer carrying unit number TRL-101.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "trailer",
      holderName: null,
      issuer: null,
      identifier: null,
      issuedOn: null,
      expiresOn: null,
      unitNumber: "TRL-101",
      plateNumber: null
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c205",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c105",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["kind_matches_document", "holder_name_matches_profile", "expiry_is_in_the_future"],
    rationale: "A Class A licence for Maya Mills, valid to 30 November 2028.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "cdl",
      holderName: "Maya Mills",
      issuer: "Oregon DMV",
      identifier: "CDL-A-9002",
      issuedOn: "11/30/2022",
      expiresOn: "11/30/2028",
      unitNumber: null,
      plateNumber: null
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c206",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c106",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    decision: "more_info_required",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["expiry_not_found", "page_cropped"],
    rationale:
      "The insurer's name is readable but the expiry date is not, so we cannot tell whether this policy is still in force.",
    requestedEvidence: [
      "A photo of the page that shows the policy expiry date",
      "The full page, with all four corners in frame"
    ],
    extracted: {
      detectedKind: "insurance",
      holderName: null,
      issuer: "Cascade Mutual Insurance",
      identifier: null,
      issuedOn: null,
      expiresOn: null,
      unitNumber: null,
      plateNumber: null
    },
    decidedAt: credentialClock.reviewed,
    createdAt: credentialClock.reviewed,
    updatedAt: credentialClock.reviewed
  },
  {
    id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c207",
    credentialId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c107",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    decision: "approved",
    decidedBy: "ai",
    model: "seed-synthetic-reviewer",
    confidence: null,
    findings: ["kind_matches_document", "holder_name_matches_profile", "expiry_is_in_the_future"],
    rationale:
      "The certificate names Taylor Timber and runs to 31 January 2026. Approved as of 5 January 2026.",
    requestedEvidence: [],
    extracted: {
      detectedKind: "insurance",
      holderName: "Taylor Timber",
      issuer: "Cascade Mutual Insurance",
      identifier: "CM-9920-117",
      issuedOn: "01/31/2025",
      expiresOn: "01/31/2026",
      unitNumber: null,
      plateNumber: null
    },
    decidedAt: credentialClock.lapsedReviewed,
    createdAt: credentialClock.lapsedReviewed,
    updatedAt: credentialClock.lapsedReviewed
  }
])

export const seedDispatcherProfiles: DispatcherProfile[] = parseMany(dispatcherProfileSchema, [
  {
    id: "55555555-5555-4555-8555-555555555551",
    userId: "22222222-2222-4222-8222-222222222224",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatchRegion: "Cascade Foothills",
    contact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "55555555-5555-4555-8555-555555555553",
    userId: "22222222-2222-4222-8222-222222222223",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatchRegion: "Blue River Basin",
    contact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLoaderProfiles: LoaderProfile[] = parseMany(loaderProfileSchema, [
  {
    id: "55555555-5555-4555-8555-555555555552",
    userId: "22222222-2222-4222-8222-222222222225",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    contact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    shiftNotes: "Loader starts 05:30 weekdays.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTruckProfiles: TruckProfile[] = parseMany(truckProfileSchema, [
  {
    id: "77777777-7777-4777-8777-777777777771",
    ownerUserId: "22222222-2222-4222-8222-222222222221",
    companyId: "33333333-3333-4333-8333-333333333331",
    truckType: "log_truck",
    unitNumber: "NP-101",
    make: "Kenworth",
    model: "T880",
    plateNumber: "LOG101",
    vin: "VIN-NP-101",
    axleCount: 4,
    maxPayloadTons: 30,
    equipmentTags: ["chains", "radio"],
    roadAccessCapabilities: ["steep-grade", "gravel"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777772",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333331",
    truckType: "chip_truck",
    unitNumber: "NP-202",
    make: "Peterbilt",
    model: "567",
    plateNumber: "CHP202",
    vin: "VIN-NP-202",
    axleCount: 5,
    maxPayloadTons: 31,
    equipmentTags: ["chip-box"],
    roadAccessCapabilities: ["paved", "mill-yard"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777773",
    ownerUserId: "22222222-2222-4222-8222-222222222223",
    companyId: "33333333-3333-4333-8333-333333333332",
    truckType: "log_truck",
    unitNumber: "SR-330",
    make: "Western Star",
    model: "49X",
    plateNumber: "LOG330",
    vin: "VIN-SR-330",
    axleCount: 4,
    maxPayloadTons: 29,
    equipmentTags: ["chains", "snow-kit"],
    roadAccessCapabilities: ["forest-road", "snow"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777774",
    ownerUserId: "22222222-2222-4222-8222-222222222228",
    companyId: "33333333-3333-4333-8333-333333333332",
    truckType: "log_truck",
    unitNumber: "SR-440",
    make: "Kenworth",
    model: "T880",
    plateNumber: "LOG440",
    vin: "VIN-SR-440",
    axleCount: 4,
    maxPayloadTons: 29,
    equipmentTags: ["chains", "snow-kit"],
    roadAccessCapabilities: ["forest-road", "snow"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "77777777-7777-4777-8777-777777777775",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    companyId: "33333333-3333-4333-8333-333333333331",
    truckType: "log_truck",
    unitNumber: "NP-220",
    make: "Kenworth",
    model: "T880",
    plateNumber: "LOG220",
    vin: "VIN-NP-220",
    axleCount: 4,
    maxPayloadTons: 30,
    equipmentTags: ["chains", "snow-kit"],
    roadAccessCapabilities: ["forest-road", "snow"],
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTrailerProfiles: TrailerProfile[] = parseMany(trailerProfileSchema, [
  {
    id: "88888888-8888-4888-8888-888888888881",
    ownerUserId: "22222222-2222-4222-8222-222222222221",
    truckId: "77777777-7777-4777-8777-777777777771",
    trailerType: "pole_trailer",
    unitNumber: "TRL-101",
    capacityTons: 30,
    equipmentTags: ["stakes"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888882",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    truckId: "77777777-7777-4777-8777-777777777772",
    trailerType: "chip_van",
    unitNumber: "TRL-202",
    capacityTons: 32,
    equipmentTags: ["chip-box"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888883",
    ownerUserId: "22222222-2222-4222-8222-222222222223",
    truckId: "77777777-7777-4777-8777-777777777773",
    trailerType: "bunk_trailer",
    unitNumber: "TRL-330",
    capacityTons: 29,
    equipmentTags: ["chains"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888884",
    ownerUserId: "22222222-2222-4222-8222-222222222228",
    truckId: "77777777-7777-4777-8777-777777777774",
    trailerType: "bunk_trailer",
    unitNumber: "TRL-440",
    capacityTons: 29,
    equipmentTags: ["chains"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "88888888-8888-4888-8888-888888888885",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    truckId: "77777777-7777-4777-8777-777777777775",
    trailerType: "bunk_trailer",
    unitNumber: "TRL-220",
    capacityTons: 30,
    equipmentTags: ["chains"],
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLandings: Landing[] = parseMany(landingSchema, [
  {
    id: "66666666-6666-4666-8666-666666666661",
    companyId: "33333333-3333-4333-8333-333333333331",
    name: "Oak Landing",
    addressLine1: "100 Timber Rd",
    city: "Oakridge",
    state: "OR",
    postalCode: "97463",
    coordinates: { lat: 43.7471, lng: -122.4617 },
    contact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    slotWindowMinutes: 30,
    accessNotes: "Single-lane bridge before entry.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "66666666-6666-4666-8666-666666666662",
    companyId: "33333333-3333-4333-8333-333333333332",
    name: "Blue River Landing",
    addressLine1: "44 Spur Rd",
    city: "Blue River",
    state: "OR",
    postalCode: "97413",
    coordinates: { lat: 44.1926, lng: -122.0898 },
    contact: {
      name: "Cole Cedar",
      phone: "555-1003",
      email: "cole@summit.example"
    },
    slotWindowMinutes: 20,
    accessNotes: "Chains required during winter advisories.",
    roadCondition: "wet",
    weatherNotes: "Monitor afternoon storms.",
    isActive: true,
    loaderProfileId: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMills: Mill[] = parseMany(millSchema, [
  {
    id: "99999999-9999-4999-8999-999999999991",
    companyId: null,
    name: "Cascade Mill",
    addressLine1: "12 Mill Ave",
    city: "Springfield",
    state: "OR",
    postalCode: "97477",
    coordinates: { lat: 44.0462, lng: -123.022 },
    contact: {
      name: "Scale House",
      phone: "555-3001",
      email: "scale@cascade.example"
    },
    slotWindowMinutes: 15,
    accessNotes: "Check in at gate 2.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    millCode: "CAS-MILL",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "99999999-9999-4999-8999-999999999992",
    companyId: null,
    name: "River Pulp",
    addressLine1: "88 River Loop",
    city: "Eugene",
    state: "OR",
    postalCode: "97402",
    coordinates: { lat: 44.0521, lng: -123.1492 },
    contact: {
      name: "Unload Desk",
      phone: "555-3002",
      email: "unload@riverpulp.example"
    },
    slotWindowMinutes: 20,
    accessNotes: "Chip deliveries use west entrance.",
    roadCondition: "good",
    weatherNotes: null,
    isActive: true,
    millCode: "RIV-PULP",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedHaulRoutes: HaulRoute[] = parseMany(haulRouteSchema, [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    millId: "99999999-9999-4999-8999-999999999991",
    routeName: "Oak Landing to Cascade Mill",
    estimatedDistanceMiles: 54.2,
    estimatedRunTimeMinutes: 105,
    roadCondition: "good",
    mapPolyline: null,
    roadNotes: "Use Highway 58 after leaving the timber road.",
    weatherNotes: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    companyId: "33333333-3333-4333-8333-333333333331",
    landingId: "66666666-6666-4666-8666-666666666661",
    millId: "99999999-9999-4999-8999-999999999992",
    routeName: "Oak Landing to River Pulp",
    estimatedDistanceMiles: 48.5,
    estimatedRunTimeMinutes: 95,
    roadCondition: "wet",
    mapPolyline: null,
    roadNotes: "Expect heavier traffic through Eugene.",
    weatherNotes: "Morning fog is common.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    companyId: "33333333-3333-4333-8333-333333333332",
    landingId: "66666666-6666-4666-8666-666666666662",
    millId: "99999999-9999-4999-8999-999999999991",
    routeName: "Blue River to Cascade Mill",
    estimatedDistanceMiles: 67.8,
    estimatedRunTimeMinutes: 120,
    roadCondition: "wet",
    mapPolyline: null,
    roadNotes: "Grade increases sharply after mile 18.",
    weatherNotes: "Chains may be needed overnight.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    companyId: "33333333-3333-4333-8333-333333333332",
    landingId: "66666666-6666-4666-8666-666666666662",
    millId: "99999999-9999-4999-8999-999999999992",
    routeName: "Blue River to River Pulp",
    estimatedDistanceMiles: 61.3,
    estimatedRunTimeMinutes: 112,
    roadCondition: "restricted",
    mapPolyline: null,
    roadNotes: "Temporary one-lane control at county bridge.",
    weatherNotes: "Watch for thunderstorm debris.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedRates: Rate[] = parseMany(rateSchema, [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    companyId: "33333333-3333-4333-8333-333333333331",
    rateType: "per_load",
    baseRate: { amountCents: 185000, currency: "USD" },
    fuelSurchargeCents: 12000,
    notes: "Oak Landing saw-log baseline.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    companyId: "33333333-3333-4333-8333-333333333331",
    rateType: "per_ton",
    baseRate: { amountCents: 6200, currency: "USD" },
    fuelSurchargeCents: 900,
    notes: "Chip load rate to River Pulp.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    companyId: "33333333-3333-4333-8333-333333333332",
    rateType: "flat_rate",
    baseRate: { amountCents: 210000, currency: "USD" },
    fuelSurchargeCents: 15000,
    notes: "High-elevation haul incentive.",
    effectiveDate: "2026-06-01",
    expiresAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedLoadPostings: LoadPosting[] = parseMany(loadPostingSchema, [
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    title: "Oak saw-log morning run",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "one_off",
    loadDate: "2026-06-06",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 3,
    // One of two loads carrying a host-stated figure (the other is the two-day
    // series at the end of this list). The remaining seeded loads still fall
    // back to their rate card, so the bench shows both sides of the migration
    // at once rather than only the finished state.
    driverPayCents: 52_500,
    estimatedTonsPerLoad: 28,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: ["radio"],
    roadCondition: "good",
    weatherNotes: null,
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999992",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    title: "Oak chip shuttle",
    loadType: "chips",
    status: "scheduled",
    scheduleType: "recurring",
    loadDate: null,
    campaignStartDate: "2026-06-06",
    campaignEndDate: "2026-06-20",
    recurringSchedule: {
      frequency: "weekly",
      daysOfWeek: [1, 3, 5],
      untilDate: "2026-06-20"
    },
    dailyTruckCountNeeded: 2,
    estimatedTonsPerLoad: 30,
    equipmentRequirements: ["chip-box"],
    accessRequirements: ["west-gate"],
    roadCondition: "wet",
    weatherNotes: "Fog through 09:00.",
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River high-grade campaign",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "campaign",
    loadDate: null,
    campaignStartDate: "2026-06-06",
    campaignEndDate: "2026-06-14",
    recurringSchedule: null,
    dailyTruckCountNeeded: 4,
    driverPayCents: 52_500,
    estimatedTonsPerLoad: 29,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "restricted",
    weatherNotes: "Evening snow possible above 3000 ft.",
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999992",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River pulp contingency",
    loadType: "pulpwood",
    status: "filled",
    scheduleType: "one_off",
    loadDate: "2026-06-07",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 27,
    equipmentRequirements: ["bunk-trailer"],
    accessRequirements: ["bridge-control"],
    roadCondition: "restricted",
    weatherNotes: null,
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
    companyId: "33333333-3333-4333-8333-333333333331",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    pickupLandingId: "66666666-6666-4666-8666-666666666661",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    title: "Oak recovery load",
    loadType: "mixed",
    status: "cancelled",
    scheduleType: "one_off",
    loadDate: "2026-06-08",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 24,
    equipmentRequirements: ["pole-trailer"],
    accessRequirements: ["radio"],
    roadCondition: "muddy",
    weatherNotes: "Landing too soft after rain.",
    dispatcherContact: {
      name: "Dana Dispatch",
      phone: "555-2001",
      email: "dispatch@northpine.example"
    },
    loaderContact: {
      name: "Lee Loader",
      phone: "555-2002",
      email: "loader@northpine.example"
    },
    cancellationReason: "Landing access closed after storm.",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc6",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River standby swing shift",
    loadType: "biomass",
    status: "draft",
    scheduleType: "one_off",
    loadDate: "2026-06-09",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 2,
    estimatedTonsPerLoad: 22,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "wet",
    weatherNotes: null,
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River assigned mountain run",
    loadType: "saw_logs",
    status: "scheduled",
    scheduleType: "one_off",
    loadDate: "2026-06-06",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 29,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "restricted",
    weatherNotes: "Assigned demo haul; evening snow possible above 3000 ft.",
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.assigned
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River partner high-grade block",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "one_off",
    loadDate: "2026-06-06",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 2,
    driverPayCents: 52_500,
    estimatedTonsPerLoad: 29,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "restricted",
    weatherNotes: "Synthetic partner offer with one completed and one invited truckload.",
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River partner offer history",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "one_off",
    loadDate: "2026-06-09",
    campaignStartDate: null,
    campaignEndDate: null,
    recurringSchedule: null,
    dailyTruckCountNeeded: 1,
    estimatedTonsPerLoad: 29,
    equipmentRequirements: ["chains"],
    accessRequirements: ["snow-kit"],
    roadCondition: "restricted",
    weatherNotes: "Synthetic terminal invitation history; no truckload was committed.",
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  // Six truckloads over two days, as ONE posting. A posting is a series, so the
  // series case needs a loading slot per day rather than six listings — and it
  // is the shape `provisionLoadCapacity` already produces for a two-day
  // campaign (perDay x scheduled dates), not a hand-tuned arrangement.
  //
  // Appended, never prepended: `truck-slots.test.ts` and `economics.test.ts`
  // both anchor on `loadPostings[0]`.
  //
  // Without this the seed had no posting offering ONE driver more than a single
  // takeable slot, so the slot picker had nothing to pick. The only other
  // multi-slot posting (…ccc1) is work the demo driver already holds, and
  // `selectable` is viewer-gated, so his board showed one run and the control
  // never rendered.
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
    companyId: "33333333-3333-4333-8333-333333333332",
    dispatcherProfileId: "55555555-5555-4555-8555-555555555553",
    loaderProfileId: null,
    pickupLandingId: "66666666-6666-4666-8666-666666666662",
    dropoffMillId: "99999999-9999-4999-8999-999999999991",
    routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    title: "Blue River two-day high-grade series",
    loadType: "saw_logs",
    status: "open",
    scheduleType: "campaign",
    loadDate: null,
    campaignStartDate: "2026-06-08",
    campaignEndDate: "2026-06-09",
    recurringSchedule: null,
    dailyTruckCountNeeded: 3,
    driverPayCents: 62_500,
    estimatedTonsPerLoad: 29,
    // Chains only. The demo driver's rig carries chains, so the series he is
    // meant to pick a run from must not require kit he does not have.
    equipmentRequirements: ["chains"],
    accessRequirements: [],
    roadCondition: "good",
    // Deliberately null. The load detail surface renders weatherNotes to the
    // driver under "Check before requesting", so describing the fixture here
    // would put fixture metadata in a safety caution. What this posting is gets
    // said in its title and its slot notes instead.
    weatherNotes: null,
    dispatcherContact: {
      name: "Cole Cedar",
      phone: "555-3001",
      email: "dispatch@summit.example"
    },
    loaderContact: null,
    cancellationReason: null,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTruckSlots: TruckSlot[] = parseMany(truckSlotSchema, [
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-06",
    startAt: "2026-06-06T13:00:00.000Z",
    endAt: "2026-06-06T13:30:00.000Z",
    capacity: 2,
    reservedCount: 1,
    status: "reserved",
    notes: "First wave loadout.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-06",
    startAt: "2026-06-06T14:00:00.000Z",
    endAt: "2026-06-06T14:30:00.000Z",
    capacity: 2,
    reservedCount: 0,
    status: "open",
    notes: "Second wave loadout.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    landingId: "66666666-6666-4666-8666-666666666661",
    loaderProfileId: "55555555-5555-4555-8555-555555555552",
    slotDate: "2026-06-07",
    startAt: "2026-06-07T13:00:00.000Z",
    endAt: "2026-06-07T13:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "filled",
    notes: "Chip shuttle slot.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T15:00:00.000Z",
    endAt: "2026-06-06T15:20:00.000Z",
    capacity: 2,
    reservedCount: 1,
    status: "requested",
    notes: "Awaiting confirmation from high-grade crew.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-07",
    startAt: "2026-06-07T16:00:00.000Z",
    endAt: "2026-06-07T16:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "completed",
    notes: "Completed contingency run.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T15:00:00.000Z",
    endAt: "2026-06-06T15:30:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "reserved",
    notes: "Confirmed Summit Ridge mountain run.",
    createdAt: timestamps.created,
    updatedAt: timestamps.assigned
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd7",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T20:30:00.000Z",
    endAt: "2026-06-06T20:50:00.000Z",
    capacity: 1,
    reservedCount: 0,
    status: "open",
    notes: "Remaining partner-offer truckload window.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  // The two-day series: one loading slot per scheduled day, three trucks per
  // day. Window and capacity are exactly what `provisionLoadCapacity` mints for
  // a campaign (13:00-21:00Z, capacity = dailyTruckCountNeeded), so this models
  // a posting the product can actually publish rather than an impossible state.
  //
  // Kept in the June band deliberately: `services.test.ts` asserts nothing is
  // requestable at 2026-07-13T12:00Z, and the web app shifts the whole seed
  // forward in whole days from 2026-06-05, so June dates land in the future on
  // a bench booted today.
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddccd1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-08",
    startAt: "2026-06-08T13:00:00.000Z",
    endAt: "2026-06-08T21:00:00.000Z",
    capacity: 3,
    reservedCount: 0,
    status: "open",
    notes: "Day one of the two-day series.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddccd2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-09",
    startAt: "2026-06-09T13:00:00.000Z",
    endAt: "2026-06-09T21:00:00.000Z",
    capacity: 3,
    reservedCount: 0,
    status: "open",
    notes: "Day two of the two-day series.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedAvailabilityWindows: AvailabilityWindow[] = parseMany(availabilityWindowSchema, [
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    status: "available",
    startAt: "2026-06-06T12:30:00.000Z",
    endAt: "2026-06-06T22:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
    notes: "Open for full day saw-log work.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    status: "limited",
    startAt: "2026-06-06T12:30:00.000Z",
    endAt: "2026-06-06T20:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"],
    notes: "Needs to clear by 20:00.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
    driverProfileId: "44444444-4444-4444-8444-444444444443",
    truckProfileId: "77777777-7777-4777-8777-777777777773",
    status: "available",
    startAt: "2026-06-06T14:00:00.000Z",
    endAt: "2026-06-06T23:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"],
    notes: "Mountain haul capable.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    truckProfileId: "77777777-7777-4777-8777-777777777774",
    status: "available",
    startAt: "2026-06-06T14:00:00.000Z",
    endAt: "2026-06-06T23:00:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"],
    notes: "Taylor's demo mountain-haul window.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777775",
    status: "available",
    startAt: "2026-06-06T15:30:00.000Z",
    endAt: "2026-06-06T19:30:00.000Z",
    preferredRouteIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"],
    notes: "NP-220 covered the completed partner high-grade claim.",
    recurringSchedule: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedAssignments: Assignment[] = parseMany(assignmentSchema, [
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    status: "accepted",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Be on channel 4 entering the landing.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    trailerProfileId: "88888888-8888-4888-8888-888888888882",
    status: "completed",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: timestamps.completed,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Completed before noon window closed.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
    driverProfileId: "44444444-4444-4444-8444-444444444443",
    truckProfileId: "77777777-7777-4777-8777-777777777773",
    trailerProfileId: "88888888-8888-4888-8888-888888888883",
    status: "requested",
    requestedAt: timestamps.requested,
    assignedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Pending confirmation on route restrictions.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff4",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    status: "cancelled",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: null,
    cancelledAt: timestamps.cancelled,
    cancellationReason: "Landing closure due to washout.",
    dispatcherNotes: "Reassign when weather clears.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff5",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    truckProfileId: "77777777-7777-4777-8777-777777777774",
    trailerProfileId: "88888888-8888-4888-8888-888888888884",
    status: "accepted",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Cole confirmed the high-grade mountain run.",
    createdAt: timestamps.created,
    updatedAt: timestamps.assigned
  }
])

export const seedNotifications: Notification[] = parseMany(notificationSchema, [
  {
    id: "12121212-1212-4212-8212-121212121211",
    userId: "22222222-2222-4222-8222-222222222221",
    type: "assignment_confirmed",
    title: "Assignment confirmed",
    body: "Oak saw-log morning run is confirmed for 06/06.",
    relatedEntityType: "assignment",
    relatedEntityId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    readAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "12121212-1212-4212-8212-121212121212",
    userId: "22222222-2222-4222-8222-222222222223",
    type: "assignment_requested",
    title: "Assignment request pending",
    body: "Blue River high-grade campaign request is awaiting dispatcher review.",
    relatedEntityType: "assignment",
    relatedEntityId: "ffffffff-ffff-4fff-8fff-fffffffffff3",
    readAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMessageThreads: MessageThread[] = parseMany(messageThreadSchema, [
  {
    id: "13131313-1313-4313-8313-131313131311",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    participantUserIds: [
      "22222222-2222-4222-8222-222222222221",
      "22222222-2222-4222-8222-222222222224",
      "22222222-2222-4222-8222-222222222225"
    ],
    subject: "Oak saw-log morning coordination",
    lastMessageAt: timestamps.assigned,
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedMessageEvents: MessageEvent[] = parseMany(messageEventSchema, [
  {
    id: "14141414-1414-4414-8414-141414141411",
    threadId: "13131313-1313-4313-8313-131313131311",
    authorUserId: "22222222-2222-4222-8222-222222222224",
    body: "Loader is ready at 06:00, use channel 4 for arrival.",
    createdAt: timestamps.assigned,
    updatedAt: timestamps.assigned
  },
  {
    id: "14141414-1414-4414-8414-141414141412",
    threadId: "13131313-1313-4313-8313-131313131311",
    authorUserId: "22222222-2222-4222-8222-222222222221",
    body: "Copy that, leaving yard at 05:15.",
    createdAt: timestamps.assigned,
    updatedAt: timestamps.assigned
  }
])

export const seedAuditEvents: AuditEvent[] = parseMany(auditEventSchema, [
  {
    id: "15151515-1515-4515-8515-151515151511",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    entityType: "load_posting",
    entityId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    action: "created",
    metadata: {
      dailyTruckCountNeeded: 3,
      routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
    },
    createdAt: timestamps.created
  },
  {
    id: "15151515-1515-4515-8515-151515151512",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    entityType: "assignment",
    entityId: "ffffffff-ffff-4fff-8fff-fffffffffff4",
    action: "cancelled",
    metadata: {
      reason: "Landing closure due to washout."
    },
    createdAt: timestamps.cancelled
  }
])


export const seedOrganizations: Organization[] = parseMany(organizationSchema, [
  {
    id: "33333333-3333-4333-8333-333333333331",
    slug: "north-pine-logging",
    type: "fleet",
    legalName: "North Pine Logging LLC",
    displayName: "North Pine Logging",
    primaryRegion: "Cascade Foothills",
    verificationStatus: "verified",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    slug: "summit-ridge-timber",
    type: "landing_source",
    legalName: "Summit Ridge Timber Inc.",
    displayName: "Summit Ridge Timber",
    primaryRegion: "Blue River Corridor",
    verificationStatus: "verified",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "33333333-3333-4333-8333-333333333334",
    slug: "new-river-hauling",
    type: "fleet",
    legalName: "New River Hauling LLC",
    displayName: "New River Hauling",
    primaryRegion: "Cascade Foothills",
    verificationStatus: "pending",
    archivedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedOrganizationMemberships: OrganizationMembership[] = parseMany(organizationMembershipSchema, [
  {
    id: "16161616-1616-4616-8616-161616161611",
    organizationId: "33333333-3333-4333-8333-333333333331",
    userId: "22222222-2222-4222-8222-222222222224",
    role: "dispatcher",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161612",
    organizationId: "33333333-3333-4333-8333-333333333331",
    userId: "22222222-2222-4222-8222-222222222221",
    role: "driver",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161613",
    organizationId: "33333333-3333-4333-8333-333333333331",
    userId: "22222222-2222-4222-8222-222222222222",
    role: "driver",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161614",
    organizationId: "33333333-3333-4333-8333-333333333331",
    userId: "22222222-2222-4222-8222-222222222225",
    role: "landing_manager",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161615",
    organizationId: "33333333-3333-4333-8333-333333333332",
    userId: "22222222-2222-4222-8222-222222222223",
    role: "owner",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161616",
    organizationId: "33333333-3333-4333-8333-333333333332",
    userId: "22222222-2222-4222-8222-222222222224",
    role: "dispatcher",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161617",
    organizationId: "33333333-3333-4333-8333-333333333331",
    userId: "22222222-2222-4222-8222-222222222226",
    role: "driver",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161618",
    organizationId: "33333333-3333-4333-8333-333333333334",
    userId: "22222222-2222-4222-8222-222222222227",
    role: "owner",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "16161616-1616-4616-8616-161616161619",
    organizationId: "33333333-3333-4333-8333-333333333332",
    userId: "22222222-2222-4222-8222-222222222228",
    role: "driver",
    status: "active",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedOrganizationInvitations: OrganizationInvitation[] = parseMany(organizationInvitationSchema, [
  // A live pending invitation: Summit invites a landing manager who has not
  // signed up yet, so the onboarding join path is demonstrable from seed.
  // Status is "created", not "sent" — nothing sends email, and the seed must
  // not model a delivery that never happened.
  {
    id: "17171717-1717-4717-8717-171717171711",
    organizationId: "33333333-3333-4333-8333-333333333332",
    invitedEmail: "casey@summit.example",
    invitedRole: "landing_manager",
    status: "created",
    invitedByUserId: "22222222-2222-4222-8222-222222222223",
    acceptedByUserId: null,
    expiresAt: "2026-07-05T18:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedPrivateNetworkRelationships: PrivateNetworkRelationship[] = parseMany(privateNetworkRelationshipSchema, [
  {
    id: "17171717-1717-4717-8717-171717171712",
    ownerOrganizationId: "33333333-3333-4333-8333-333333333332",
    partnerOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "active",
    visibilityScope: "private_loads",
    preferred: true,
    notes: "Summit exposes high-grade Blue River work to North Pine before open discovery.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "17171717-1717-4717-8717-171717171713",
    ownerOrganizationId: "33333333-3333-4333-8333-333333333331",
    partnerOrganizationId: "33333333-3333-4333-8333-333333333332",
    status: "active",
    visibilityScope: "availability",
    preferred: false,
    notes: "North Pine shares future capacity windows with Summit dispatchers.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedEquipmentCombinations: EquipmentCombination[] = parseMany(equipmentCombinationSchema, [
  {
    id: "18181818-1818-4818-8818-181818181811",
    organizationId: "33333333-3333-4333-8333-333333333331",
    truckProfileId: "77777777-7777-4777-8777-777777777771",
    trailerProfileId: "88888888-8888-4888-8888-888888888881",
    assignedDriverProfileId: "44444444-4444-4444-8444-444444444441",
    label: "NP-101 with pole trailer",
    truckTypes: ["log_truck"],
    trailerTypes: ["pole_trailer"],
    capabilityTags: ["radio", "chains", "steep-grade"],
    productLengthMinFeet: 24,
    productLengthMaxFeet: 42,
    maxPayloadTons: 30,
    status: "available",
    homeRegion: "Cascade Foothills",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "18181818-1818-4818-8818-181818181812",
    organizationId: "33333333-3333-4333-8333-333333333331",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    trailerProfileId: "88888888-8888-4888-8888-888888888882",
    assignedDriverProfileId: "44444444-4444-4444-8444-444444444442",
    label: "NP-202 chip van",
    truckTypes: ["chip_truck"],
    trailerTypes: ["chip_van"],
    capabilityTags: ["chip-box", "mill-yard"],
    productLengthMinFeet: null,
    productLengthMaxFeet: null,
    maxPayloadTons: 31,
    status: "committed",
    homeRegion: "Oak Landing",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "18181818-1818-4818-8818-181818181813",
    organizationId: "33333333-3333-4333-8333-333333333332",
    truckProfileId: "77777777-7777-4777-8777-777777777773",
    trailerProfileId: "88888888-8888-4888-8888-888888888883",
    assignedDriverProfileId: "44444444-4444-4444-8444-444444444443",
    label: "SR-330 mountain bunk",
    truckTypes: ["log_truck"],
    trailerTypes: ["bunk_trailer"],
    capabilityTags: ["chains", "snow-kit", "forest-road"],
    productLengthMinFeet: 16,
    productLengthMaxFeet: 40,
    maxPayloadTons: 29,
    status: "committed",
    homeRegion: "Blue River Corridor",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "18181818-1818-4818-8818-181818181814",
    organizationId: "33333333-3333-4333-8333-333333333332",
    truckProfileId: "77777777-7777-4777-8777-777777777774",
    trailerProfileId: "88888888-8888-4888-8888-888888888884",
    assignedDriverProfileId: "44444444-4444-4444-8444-444444444445",
    label: "SR-440 mountain bunk",
    truckTypes: ["log_truck"],
    trailerTypes: ["bunk_trailer"],
    capabilityTags: ["chains", "snow-kit", "forest-road"],
    productLengthMinFeet: 16,
    productLengthMaxFeet: 40,
    maxPayloadTons: 29,
    status: "committed",
    homeRegion: "Blue River Corridor",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "18181818-1818-4818-8818-181818181815",
    organizationId: "33333333-3333-4333-8333-333333333331",
    truckProfileId: "77777777-7777-4777-8777-777777777775",
    trailerProfileId: "88888888-8888-4888-8888-888888888885",
    assignedDriverProfileId: "44444444-4444-4444-8444-444444444442",
    label: "NP-220 mountain bunk",
    truckTypes: ["log_truck"],
    trailerTypes: ["bunk_trailer"],
    capabilityTags: ["chains", "snow-kit", "forest-road"],
    productLengthMinFeet: 16,
    productLengthMaxFeet: 40,
    maxPayloadTons: 30,
    status: "available",
    homeRegion: "Cascade Foothills",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedRichLandingDetails: RichLandingDetails[] = parseMany(richLandingDetailsSchema, [
  {
    id: "19191919-1919-4919-8919-191919191911",
    landingId: "66666666-6666-4666-8666-666666666661",
    controlledByOrganizationId: "33333333-3333-4333-8333-333333333331",
    publicApproximateArea: "Oakridge, OR - Cascade Foothills",
    entranceLat: 43.7463,
    entranceLng: -122.4628,
    exactLocationVisibility: "assigned_only",
    privateRoadNotes: "Consumer map pins are offset; use the timber road entrance after the bridge.",
    gateInstructions: "Gate code rotates daily and is visible only after assignment acceptance.",
    loadingEquipment: ["heel-boom loader", "landing radio channel 4"],
    turnaroundConstraints: ["single-lane bridge", "no chip vans past upper spur"],
    stagingInstructions: "Stage on the gravel apron west of the loader, nose out.",
    communicationInstructions: "Call loader before entering the one-lane bridge.",
    safetyRequirements: ["hard hat and hi-vis outside the cab", "no foot traffic inside the loader swing"],
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "19191919-1919-4919-8919-191919191912",
    landingId: "66666666-6666-4666-8666-666666666662",
    controlledByOrganizationId: "33333333-3333-4333-8333-333333333332",
    publicApproximateArea: "Blue River, OR - upper corridor",
    entranceLat: 44.1919,
    entranceLng: -122.0925,
    exactLocationVisibility: "private_network",
    privateRoadNotes: "High-grade switchback after mile 18; chains required when restricted.",
    gateInstructions: "Summit dispatcher confirms gate status during morning check-in.",
    loadingEquipment: ["shovel loader", "portable scale pad"],
    turnaroundConstraints: ["short wheelbase preferred", "bridge control at county crossing"],
    stagingInstructions: "Hold at the lower landing until radio clearance.",
    communicationInstructions: "Use VHF channel 7; cell coverage is intermittent.",
    safetyRequirements: ["hard hat, hi-vis, and caulk boots on the switchback", "chains carried when the road is restricted"],
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedDestinationFacilities: DestinationFacility[] = parseMany(destinationFacilitySchema, [
  {
    id: "20202020-2020-4020-8020-202020202011",
    millId: "99999999-9999-4999-8999-999999999991",
    facilityType: "mill",
    managedByOrganizationId: null,
    recordStatus: "verified",
    truckEntranceLat: 44.0468,
    truckEntranceLng: -123.0209,
    receivingHours: "Mon-Fri 05:30-15:30",
    productRestrictions: ["saw logs only at north scale", "no mud over bolsters"],
    checkInProcess: "Use gate 2 kiosk, then wait for scale light.",
    scaleProcess: "Gross scale before unload, tare scale after sweep-out.",
    unloadingInstructions: "Unload at bay 3 unless scale house redirects.",
    completionEvidence: ["scale ticket showing gross and tare", "bay 3 delivery record"],
    currentStatus: "open",
    currentNotice: null,
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "20202020-2020-4020-8020-202020202012",
    millId: "99999999-9999-4999-8999-999999999992",
    facilityType: "mill",
    managedByOrganizationId: null,
    recordStatus: "verified",
    truckEntranceLat: 44.0509,
    truckEntranceLng: -123.1511,
    receivingHours: "Mon-Sat 06:00-14:00",
    productRestrictions: ["chip vans only at west entrance", "covered loads required in rain"],
    checkInProcess: "Call unload desk before entering the west gate.",
    scaleProcess: "Auto-scale lane records inbound and outbound weights.",
    unloadingInstructions: "Follow yard marshal to live-bottom bay.",
    completionEvidence: ["auto-scale ticket printed at the west lane"],
    currentStatus: "limited",
    currentNotice: "West entrance queue is running 20 minutes behind.",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedOpportunityCapacities: OpportunityCapacity[] = parseMany(opportunityCapacitySchema, [
  {
    id: "21212121-2121-4121-8121-212121212111",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    visibilityMode: "open_network",
    allocationMode: "request_approval",
    totalTruckloads: 3,
    committedTruckloads: 1,
    completedTruckloads: 0,
    remainingTruckloads: 2,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", fuelSurchargeCents: 12000 },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212112",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    visibilityMode: "verified_network",
    allocationMode: "dispatcher_assignment",
    totalTruckloads: 2,
    committedTruckloads: 1,
    completedTruckloads: 1,
    remainingTruckloads: 1,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212113",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    visibilityMode: "private_network",
    allocationMode: "request_approval",
    totalTruckloads: 4,
    committedTruckloads: 3,
    completedTruckloads: 2,
    remainingTruckloads: 1,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", restriction: "chains required" },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212114",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
    visibilityMode: "direct_offer",
    allocationMode: "direct_offer",
    totalTruckloads: 1,
    committedTruckloads: 1,
    completedTruckloads: 0,
    remainingTruckloads: 0,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3" },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212115",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
    visibilityMode: "open_network",
    allocationMode: "request_approval",
    totalTruckloads: 1,
    committedTruckloads: 0,
    completedTruckloads: 0,
    remainingTruckloads: 0,
    acceptedTermsSnapshot: { cancelledReason: "Landing access closed after storm." },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212116",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc6",
    visibilityMode: "private_network",
    allocationMode: "dispatcher_assignment",
    totalTruckloads: 2,
    committedTruckloads: 0,
    completedTruckloads: 0,
    remainingTruckloads: 2,
    acceptedTermsSnapshot: {},
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "21212121-2121-4121-8121-212121212117",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    visibilityMode: "private_network",
    allocationMode: "dispatcher_assignment",
    totalTruckloads: 1,
    committedTruckloads: 1,
    completedTruckloads: 0,
    remainingTruckloads: 0,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", restriction: "chains required" },
    createdAt: timestamps.created,
    updatedAt: timestamps.assigned
  },
  {
    id: "21212121-2121-4121-8121-212121212118",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    visibilityMode: "direct_offer",
    allocationMode: "direct_offer",
    totalTruckloads: 2,
    committedTruckloads: 1,
    completedTruckloads: 1,
    remainingTruckloads: 1,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", restriction: "chains required" },
    createdAt: timestamps.created,
    updatedAt: "2026-06-06T18:00:00.000Z"
  },
  {
    id: "21212121-2121-4121-8121-212121212119",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    visibilityMode: "direct_offer",
    allocationMode: "direct_offer",
    totalTruckloads: 1,
    committedTruckloads: 0,
    completedTruckloads: 0,
    remainingTruckloads: 1,
    acceptedTermsSnapshot: { rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3" },
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  // The two-day series ledger, nothing worked yet: 6 = 3 trucks x 2 days, which
  // is both `provisionLoadCapacity`'s arithmetic and the sum of the two slots'
  // capacity. `request_approval` because a driver must be able to ASK for a run
  // — a direct_offer posting never offers a picker. An empty terms snapshot is
  // what a real publish writes; the driver-facing figure is the host's stated
  // pay on the posting, not this rate card.
  {
    id: "21212121-2121-4121-8121-212121212120",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
    visibilityMode: "private_network",
    allocationMode: "request_approval",
    totalTruckloads: 6,
    committedTruckloads: 0,
    completedTruckloads: 0,
    remainingTruckloads: 6,
    acceptedTermsSnapshot: {},
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedRoutePacks: RoutePack[] = parseMany(routePackSchema, [
  {
    id: "23232323-2323-4323-8323-232323232311",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    landingId: "66666666-6666-4666-8666-666666666661",
    destinationId: "99999999-9999-4999-8999-999999999991",
    haulRouteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    visibility: "assigned_only",
    cacheableOffline: true,
    calculatedRouteSummary: "Highway 58 to Oak timber road, then operator entrance pin after the bridge.",
    localInstructions: [
      {
        source: "operator_provided",
        severity: "critical",
        title: "Use bridge entrance, not consumer pin",
        detail: "Consumer navigation points trucks to a closed spur. Enter at the bridge pin and call loader before crossing.",
        verifiedAt: timestamps.updated
      },
      {
        source: "facility_verified",
        severity: "standard",
        title: "Cascade Mill gate 2",
        detail: "Check in at gate 2 and wait for the scale light before entering the yard.",
        verifiedAt: timestamps.updated
      }
    ],
    currentRoadCondition: "good",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "23232323-2323-4323-8323-232323232312",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    landingId: "66666666-6666-4666-8666-666666666661",
    destinationId: "99999999-9999-4999-8999-999999999992",
    haulRouteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    visibility: "organization",
    cacheableOffline: true,
    calculatedRouteSummary: "Oak Landing to River Pulp west chip gate via Highway 58.",
    localInstructions: [
      {
        source: "facility_verified",
        severity: "critical",
        title: "West entrance only",
        detail: "Chip vans must use the west entrance and call the unload desk before entering.",
        verifiedAt: timestamps.updated
      }
    ],
    currentRoadCondition: "wet",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "23232323-2323-4323-8323-232323232313",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    landingId: "66666666-6666-4666-8666-666666666662",
    destinationId: "99999999-9999-4999-8999-999999999991",
    haulRouteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    visibility: "private_network",
    cacheableOffline: true,
    calculatedRouteSummary: "Blue River lower hold point to Cascade Mill; high-grade restriction after mile 18.",
    localInstructions: [
      {
        source: "operator_provided",
        severity: "critical",
        title: "Chains required above mile 18",
        detail: "Dispatch will pause requests if snow begins above 3000 feet.",
        verifiedAt: timestamps.updated
      },
      {
        source: "driver_reported",
        severity: "standard",
        title: "Bridge control delay",
        detail: "Expect alternating one-lane control at the county bridge.",
        verifiedAt: "2026-06-05T15:30:00.000Z"
      }
    ],
    currentRoadCondition: "restricted",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "23232323-2323-4323-8323-232323232314",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    landingId: "66666666-6666-4666-8666-666666666662",
    destinationId: "99999999-9999-4999-8999-999999999991",
    haulRouteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    visibility: "assigned_only",
    cacheableOffline: true,
    calculatedRouteSummary: "Blue River lower hold point to Cascade Mill; high-grade restriction after mile 18.",
    localInstructions: [
      {
        source: "operator_provided",
        severity: "critical",
        title: "Chains required above mile 18",
        detail: "Dispatch will pause the run if snow begins above 3000 feet.",
        verifiedAt: timestamps.updated
      }
    ],
    currentRoadCondition: "restricted",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "23232323-2323-4323-8323-232323232315",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    landingId: "66666666-6666-4666-8666-666666666662",
    destinationId: "99999999-9999-4999-8999-999999999991",
    haulRouteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    visibility: "assigned_only",
    cacheableOffline: true,
    calculatedRouteSummary: "Blue River lower hold point to Cascade Mill; high-grade restriction after mile 18.",
    localInstructions: [
      {
        source: "operator_provided",
        severity: "critical",
        title: "Chains required above mile 18",
        detail: "Dispatch pauses the partner block if snow begins above 3000 feet.",
        verifiedAt: timestamps.updated
      }
    ],
    currentRoadCondition: "restricted",
    lastVerifiedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedTripsV2: TripV2[] = parseMany(tripSchemaV2, [
  {
    id: "24242424-2424-4424-8424-242424242411",
    assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    routePackId: "23232323-2323-4323-8323-232323232311",
    driverProfileId: "44444444-4444-4444-8444-444444444441",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181811",
    status: "assigned",
    locationVisibility: "active_trip_participants",
    locationSharingStartedAt: null,
    locationSharingEndsAt: null,
    lastSyncedAt: timestamps.assigned,
    createdAt: timestamps.assigned,
    updatedAt: timestamps.assigned,
    completedAt: null
  },
  {
    id: "24242424-2424-4424-8424-242424242412",
    assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    routePackId: "23232323-2323-4323-8323-232323232312",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181812",
    status: "completed",
    locationVisibility: "never_public",
    locationSharingStartedAt: "2026-06-05T13:05:00.000Z",
    locationSharingEndsAt: timestamps.completed,
    lastSyncedAt: timestamps.completed,
    createdAt: timestamps.assigned,
    updatedAt: timestamps.completed,
    completedAt: timestamps.completed
  },
  {
    id: "24242424-2424-4424-8424-242424242415",
    assignmentId: "ffffffff-ffff-4fff-8fff-fffffffffff5",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
    routePackId: "23232323-2323-4323-8323-232323232314",
    driverProfileId: "44444444-4444-4444-8444-444444444445",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181814",
    status: "en_route_to_landing",
    locationVisibility: "active_trip_participants",
    locationSharingStartedAt: "2026-06-05T13:15:00.000Z",
    locationSharingEndsAt: null,
    lastSyncedAt: "2026-06-05T13:20:00.000Z",
    createdAt: timestamps.assigned,
    updatedAt: "2026-06-05T13:20:00.000Z",
    completedAt: null
  }
])

export const seedTripEvents: TripEvent[] = parseMany(tripEventSchema, [
  {
    id: "25252525-2525-4525-8525-252525252511",
    tripId: "24242424-2424-4424-8424-242424242411",
    type: "assignment_created",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    source: "dispatcher",
    occurredAt: timestamps.assigned,
    note: "Assignment accepted by North Pine dispatch.",
    metadata: { slotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1" },
    createdAt: timestamps.assigned
  },
  {
    id: "25252525-2525-4525-8525-252525252512",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "assignment_created",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    source: "dispatcher",
    occurredAt: "2026-06-05T13:00:00.000Z",
    note: "Chip shuttle assigned.",
    metadata: {},
    createdAt: "2026-06-05T13:00:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252513",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "landing_check_in",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    source: "driver",
    occurredAt: "2026-06-05T13:35:00.000Z",
    note: "Checked in at Oak chip lane.",
    metadata: { queuePosition: 1 },
    createdAt: "2026-06-05T13:35:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252514",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "loading_started",
    actorUserId: "22222222-2222-4222-8222-222222222225",
    source: "landing",
    occurredAt: "2026-06-05T13:45:00.000Z",
    note: "Chip loading started.",
    metadata: {},
    createdAt: "2026-06-05T13:45:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252515",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "departed_landing",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    source: "driver",
    occurredAt: "2026-06-05T14:05:00.000Z",
    note: "Departed Oak Landing for River Pulp.",
    metadata: { loadedTonsEstimate: 30 },
    createdAt: "2026-06-05T14:05:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252516",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "destination_arrival",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    source: "driver",
    occurredAt: "2026-06-05T15:45:00.000Z",
    note: "Arrived at River Pulp west entrance.",
    metadata: {},
    createdAt: "2026-06-05T15:45:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252517",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "ticket_uploaded",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    source: "driver",
    occurredAt: timestamps.completed,
    note: "Scale ticket uploaded and linked to completed haul.",
    metadata: { documentId: "26262626-2626-4626-8626-262626262611" },
    createdAt: timestamps.completed
  },
  {
    id: "25252525-2525-4525-8525-252525252518",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "completed",
    actorUserId: "22222222-2222-4222-8222-222222222224",
    source: "dispatcher",
    occurredAt: timestamps.completed,
    note: "Delivery accepted by receiving facility.",
    metadata: {},
    createdAt: timestamps.completed
  },
  {
    id: "25252525-2525-4525-8525-252525252519",
    tripId: "24242424-2424-4424-8424-242424242415",
    type: "driver_status",
    actorUserId: "22222222-2222-4222-8222-222222222228",
    source: "driver",
    occurredAt: "2026-06-05T13:15:00.000Z",
    note: "Taylor started toward Blue River Landing; location is visible only to trip participants.",
    metadata: { status: "en_route_to_landing" },
    createdAt: "2026-06-05T13:15:00.000Z"
  },
  {
    id: "25252525-2525-4525-8525-252525252520",
    tripId: "24242424-2424-4424-8424-242424242415",
    type: "assignment_created",
    actorUserId: "22222222-2222-4222-8222-222222222223",
    source: "dispatcher",
    occurredAt: timestamps.assigned,
    note: "Cole assigned Taylor to the Summit Ridge mountain run.",
    metadata: { slotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6" },
    createdAt: timestamps.assigned
  }
])

export const seedTripDocuments: TripDocument[] = parseMany(tripDocumentSchema, [
  // These provider labels predate stored `media` references. They remain as
  // explicit legacy metadata fixtures: neither row claims downloadable bytes.
  {
    id: "26262626-2626-4626-8626-262626262611",
    tripId: "24242424-2424-4424-8424-242424242412",
    type: "scale_ticket",
    storageProvider: "cloudinary",
    storageKey: "logloads/demo/river-pulp-scale-ff2.pdf",
    filename: "river-pulp-scale-ticket-0605.pdf",
    contentType: "application/pdf",
    uploadedByUserId: "22222222-2222-4222-8222-222222222222",
    uploadedAt: timestamps.completed,
    processingStatus: "ready",
    auditMetadata: { grossTons: 30.4, source: "driver_upload" }
  },
  {
    id: "26262626-2626-4626-8626-262626262612",
    tripId: "24242424-2424-4424-8424-242424242415",
    type: "photo",
    storageProvider: "cloudinary",
    storageKey: "logloads/demo/provider-disabled-photo.jpg",
    filename: "oak-landing-condition.jpg",
    contentType: "image/jpeg",
    uploadedByUserId: "22222222-2222-4222-8222-222222222228",
    uploadedAt: "2026-06-05T13:18:00.000Z",
    processingStatus: "failed",
    media: null,
    auditMetadata: {
      demoScenario: "provider-free-failure",
      failureCode: "upload_not_completed",
      synthetic: true
    }
  }
])

// Cross-org completed hauls: North Pine's maya (44…442) hauled two truckloads of
// Summit Ridge's high-grade campaign (ccc…3, company 332). These give both orgs a
// genuine two-sided track record. Slots are "filled" so they add no open capacity
// (existing recommendation/requestability behavior is unchanged).
export const seedCrossOrgTruckSlots: TruckSlot[] = parseMany(truckSlotSchema, [
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T15:00:00.000Z",
    endAt: "2026-06-06T15:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "filled",
    notes: "High-grade truckload — North Pine crew.",
    createdAt: timestamps.created,
    updatedAt: "2026-06-06T18:00:00.000Z"
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-07",
    startAt: "2026-06-07T15:00:00.000Z",
    endAt: "2026-06-07T15:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "filled",
    notes: "Second high-grade truckload.",
    createdAt: timestamps.created,
    updatedAt: "2026-06-07T18:00:00.000Z"
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    landingId: "66666666-6666-4666-8666-666666666662",
    loaderProfileId: null,
    slotDate: "2026-06-06",
    startAt: "2026-06-06T16:00:00.000Z",
    endAt: "2026-06-06T16:20:00.000Z",
    capacity: 1,
    reservedCount: 1,
    status: "filled",
    notes: "Completed first truckload from the partner offer.",
    createdAt: timestamps.created,
    updatedAt: "2026-06-06T18:00:00.000Z"
  }
])

export const seedCrossOrgAssignments: Assignment[] = parseMany(assignmentSchema, [
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffaaa1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa1",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    trailerProfileId: "88888888-8888-4888-8888-888888888882",
    status: "completed",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: "2026-06-06T18:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "High-grade run for Summit Ridge.",
    createdAt: timestamps.created,
    updatedAt: "2026-06-06T18:00:00.000Z"
  },
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffaaa2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa2",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777772",
    trailerProfileId: "88888888-8888-4888-8888-888888888882",
    status: "completed",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: "2026-06-07T18:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "Second high-grade run for Summit Ridge.",
    createdAt: timestamps.created,
    updatedAt: "2026-06-07T18:00:00.000Z"
  },
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffaaa3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    directOfferId: "29292929-2929-4929-8929-292929292915",
    truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddaaa3",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    truckProfileId: "77777777-7777-4777-8777-777777777775",
    trailerProfileId: "88888888-8888-4888-8888-888888888885",
    status: "completed",
    requestedAt: timestamps.requested,
    assignedAt: timestamps.assigned,
    completedAt: "2026-06-06T18:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    dispatcherNotes: "First partner-offer truckload completed with a compatible mountain rig.",
    termsSnapshot: {
      baseRateCents: 210000,
      capacityReservation: "none_until_truck_claimed",
      currency: "USD",
      estimatedDistanceMiles: 67.8,
      estimatedTonsPerLoad: 29,
      fuelSurchargeCents: 15000,
      hostOrganizationId: "33333333-3333-4333-8333-333333333332",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
      loadVersion: timestamps.updated,
      paymentMode: "off_platform",
      rateBasis: "flat_rate",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
    },
    createdAt: timestamps.created,
    updatedAt: "2026-06-06T18:00:00.000Z"
  }
])

export const seedCrossOrgTrips: TripV2[] = parseMany(tripSchemaV2, [
  {
    id: "24242424-2424-4424-8424-242424242413",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    routePackId: null,
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    equipmentCombinationId: null,
    status: "completed",
    locationVisibility: "never_public",
    locationSharingStartedAt: null,
    locationSharingEndsAt: null,
    lastSyncedAt: "2026-06-06T18:00:00.000Z",
    createdAt: timestamps.assigned,
    updatedAt: "2026-06-06T18:00:00.000Z",
    completedAt: "2026-06-06T18:00:00.000Z"
  },
  {
    id: "24242424-2424-4424-8424-242424242414",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    routePackId: null,
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    equipmentCombinationId: null,
    status: "completed",
    locationVisibility: "never_public",
    locationSharingStartedAt: null,
    locationSharingEndsAt: null,
    lastSyncedAt: "2026-06-07T18:00:00.000Z",
    createdAt: timestamps.assigned,
    updatedAt: "2026-06-07T18:00:00.000Z",
    completedAt: "2026-06-07T18:00:00.000Z"
  },
  {
    id: "24242424-2424-4424-8424-242424242416",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa3",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    routePackId: "23232323-2323-4323-8323-232323232315",
    driverProfileId: "44444444-4444-4444-8444-444444444442",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181815",
    status: "completed",
    locationVisibility: "never_public",
    locationSharingStartedAt: null,
    locationSharingEndsAt: null,
    lastSyncedAt: "2026-06-06T18:00:00.000Z",
    createdAt: timestamps.assigned,
    updatedAt: "2026-06-06T18:00:00.000Z",
    completedAt: "2026-06-06T18:00:00.000Z"
  }
])

// Two-sided reviews on the cross-org hauls. Trip …413 is reviewed both ways;
// trip …414 keeps its hauler_rates_host side open so it can be exercised live.
export const seedTripReviews: TripReview[] = parseMany(tripReviewSchema, [
  {
    id: "32323232-3232-4232-8232-323232323211",
    tripId: "24242424-2424-4424-8424-242424242413",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    direction: "host_rates_hauler",
    raterOrganizationId: "33333333-3333-4333-8333-333333333332",
    raterUserId: "22222222-2222-4222-8222-222222222223",
    subjectOrganizationId: "33333333-3333-4333-8333-333333333331",
    subjectDriverProfileId: "44444444-4444-4444-8444-444444444442",
    stars: 5,
    tags: ["on_time", "professional", "accurate_load"],
    note: "Showed up early, tidy loadout, no issues at the scale.",
    createdAt: "2026-06-06T19:00:00.000Z",
    updatedAt: "2026-06-06T19:00:00.000Z"
  },
  {
    id: "32323232-3232-4232-8232-323232323212",
    tripId: "24242424-2424-4424-8424-242424242413",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa1",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    direction: "hauler_rates_host",
    raterOrganizationId: "33333333-3333-4333-8333-333333333331",
    raterUserId: "22222222-2222-4222-8222-222222222222",
    subjectOrganizationId: "33333333-3333-4333-8333-333333333332",
    subjectDriverProfileId: null,
    stars: 5,
    tags: ["clear_instructions", "easy_access", "good_communication"],
    note: "Landing was ready on arrival and the directions were spot on.",
    createdAt: "2026-06-06T19:10:00.000Z",
    updatedAt: "2026-06-06T19:10:00.000Z"
  },
  {
    id: "32323232-3232-4232-8232-323232323213",
    tripId: "24242424-2424-4424-8424-242424242414",
    assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffaaa2",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    direction: "host_rates_hauler",
    raterOrganizationId: "33333333-3333-4333-8333-333333333332",
    raterUserId: "22222222-2222-4222-8222-222222222223",
    subjectOrganizationId: "33333333-3333-4333-8333-333333333331",
    subjectDriverProfileId: "44444444-4444-4444-8444-444444444442",
    stars: 4,
    tags: ["on_time", "safe"],
    note: "Another solid run.",
    createdAt: "2026-06-07T19:00:00.000Z",
    updatedAt: "2026-06-07T19:00:00.000Z"
  }
])

export const seedVerificationRecords: VerificationRecord[] = parseMany(verificationRecordSchema, [
  {
    id: "27272727-2727-4727-8727-272727272711",
    subjectType: "organization",
    subjectId: "33333333-3333-4333-8333-333333333331",
    verificationType: "carrier_identifier",
    status: "verified",
    source: "official_record_reviewed",
    evidenceSummary: "Carrier identifiers reviewed for North Pine operating records.",
    reviewerUserId: "11111111-1111-4111-8111-111111111111",
    verifiedAt: timestamps.updated,
    expiresAt: "2027-06-04T16:00:00.000Z",
    lastCheckedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "27272727-2727-4727-8727-272727272712",
    subjectType: "organization",
    subjectId: "33333333-3333-4333-8333-333333333332",
    verificationType: "facility_control",
    status: "verified",
    source: "landing_confirmed",
    evidenceSummary: "Summit confirmed operational control of Blue River Landing.",
    reviewerUserId: "11111111-1111-4111-8111-111111111111",
    verifiedAt: timestamps.updated,
    expiresAt: "2027-06-04T16:00:00.000Z",
    lastCheckedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "27272727-2727-4727-8727-272727272713",
    subjectType: "equipment",
    subjectId: "18181818-1818-4818-8818-181818181811",
    verificationType: "equipment",
    status: "verified",
    source: "platform_review",
    evidenceSummary: "NP-101 and TRL-101 inspected for pole-trailer saw-log work.",
    reviewerUserId: "11111111-1111-4111-8111-111111111111",
    verifiedAt: timestamps.updated,
    expiresAt: null,
    lastCheckedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "27272727-2727-4727-8727-272727272714",
    subjectType: "landing",
    subjectId: "66666666-6666-4666-8666-666666666662",
    verificationType: "landing_authorization",
    status: "verified",
    source: "landing_confirmed",
    evidenceSummary: "Blue River exact entrance and staging instructions confirmed by Summit.",
    reviewerUserId: "11111111-1111-4111-8111-111111111111",
    verifiedAt: timestamps.updated,
    expiresAt: null,
    lastCheckedAt: timestamps.updated,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedEntitlements: Entitlement[] = parseMany(entitlementSchema, [
  {
    id: "28282828-2828-4828-8828-282828282811",
    organizationId: "33333333-3333-4333-8333-333333333331",
    product: "fleet_operations",
    status: "active",
    features: ["private_network", "route_packs", "trip_documents", "fleet_dispatch"],
    activeTruckLimit: null,
    activeLandingLimit: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEndsAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "28282828-2828-4828-8828-282828282812",
    organizationId: "33333333-3333-4333-8333-333333333332",
    product: "landing_operations",
    status: "active",
    features: ["private_loads", "landing_control", "route_pack_publishing"],
    activeTruckLimit: null,
    activeLandingLimit: 3,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEndsAt: "2026-08-04T16:00:00.000Z",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedDirectOffers: DirectOffer[] = parseMany(directOfferSchema, [
  {
    id: "29292929-2929-4929-8929-292929292911",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    offeredByOrganizationId: "33333333-3333-4333-8333-333333333332",
    offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "sent",
    offeredTruckloads: 1,
    termsSnapshot: {
      baseRateCents: 210000,
      capacityReservation: "none_until_truck_claimed",
      currency: "USD",
      driverPayCents: 52_500,
      estimatedDistanceMiles: 67.8,
      estimatedTonsPerLoad: 29,
      fuelSurchargeCents: 15000,
      hostOrganizationId: "33333333-3333-4333-8333-333333333332",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      loadVersion: timestamps.updated,
      paymentMode: "off_platform",
      rateBasis: "flat_rate",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
    },
    expiresAt: "2026-06-06T20:00:00.000Z",
    respondedAt: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "29292929-2929-4929-8929-292929292915",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
    offeredByOrganizationId: "33333333-3333-4333-8333-333333333332",
    offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "sent",
    offeredTruckloads: 2,
    termsSnapshot: {
      baseRateCents: 210000,
      capacityReservation: "none_until_truck_claimed",
      currency: "USD",
      driverPayCents: 52_500,
      estimatedDistanceMiles: 67.8,
      estimatedTonsPerLoad: 29,
      fuelSurchargeCents: 15000,
      hostOrganizationId: "33333333-3333-4333-8333-333333333332",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
      loadVersion: timestamps.updated,
      paymentMode: "off_platform",
      rateBasis: "flat_rate",
      rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
    },
    expiresAt: "2026-06-06T23:00:00.000Z",
    respondedAt: timestamps.assigned,
    createdAt: timestamps.created,
    updatedAt: timestamps.assigned
  },
  {
    id: "29292929-2929-4929-8929-292929292912",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    offeredByOrganizationId: "33333333-3333-4333-8333-333333333332",
    offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "declined",
    offeredTruckloads: 1,
    termsSnapshot: {
      baseRateCents: 210000,
      currency: "USD",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
      paymentMode: "off_platform",
      rateBasis: "flat_rate"
    },
    expiresAt: "2026-06-07T20:00:00.000Z",
    respondedAt: "2026-06-05T15:00:00.000Z",
    createdAt: timestamps.created,
    updatedAt: "2026-06-05T15:00:00.000Z"
  },
  {
    id: "29292929-2929-4929-8929-292929292913",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    offeredByOrganizationId: "33333333-3333-4333-8333-333333333332",
    offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "revoked",
    offeredTruckloads: 1,
    termsSnapshot: {
      baseRateCents: 210000,
      currency: "USD",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
      paymentMode: "off_platform",
      rateBasis: "flat_rate"
    },
    expiresAt: "2026-06-08T20:00:00.000Z",
    respondedAt: null,
    createdAt: timestamps.created,
    updatedAt: "2026-06-05T16:00:00.000Z"
  },
  {
    id: "29292929-2929-4929-8929-292929292914",
    loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
    offeredByOrganizationId: "33333333-3333-4333-8333-333333333332",
    offeredToOrganizationId: "33333333-3333-4333-8333-333333333331",
    status: "expired",
    offeredTruckloads: 1,
    termsSnapshot: {
      baseRateCents: 210000,
      currency: "USD",
      loadPostingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
      paymentMode: "off_platform",
      rateBasis: "flat_rate"
    },
    expiresAt: "2026-06-05T10:00:00.000Z",
    respondedAt: null,
    createdAt: timestamps.created,
    updatedAt: "2026-06-05T10:00:00.000Z"
  }
])

export const seedFutureAvailability: FutureAvailability[] = parseMany(futureAvailabilitySchema, [
  {
    id: "30303030-3030-4030-8030-303030303011",
    organizationId: "33333333-3333-4333-8333-333333333331",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181811",
    startsAt: "2026-06-07T12:00:00.000Z",
    endsAt: "2026-06-07T22:00:00.000Z",
    status: "available",
    visibleToRelationshipIds: ["17171717-1717-4717-8717-171717171713"],
    notes: "NP-101 is open for private network saw-log work after Oak morning run.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "30303030-3030-4030-8030-303030303012",
    organizationId: "33333333-3333-4333-8333-333333333332",
    equipmentCombinationId: "18181818-1818-4818-8818-181818181813",
    startsAt: "2026-06-08T14:00:00.000Z",
    endsAt: "2026-06-08T23:00:00.000Z",
    status: "tentative",
    visibleToRelationshipIds: ["17171717-1717-4717-8717-171717171712"],
    notes: "SR-330 may release if Blue River bridge control clears.",
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

export const seedOperationalNotices: OperationalNotice[] = parseMany(operationalNoticeSchema, [
  {
    id: "31313131-3131-4131-8131-313131313111",
    organizationId: "33333333-3333-4333-8333-333333333332",
    relatedLoadId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    relatedLandingId: "66666666-6666-4666-8666-666666666662",
    relatedDestinationId: null,
    severity: "critical",
    title: "Blue River bridge control active",
    body: "Use lower hold point until Summit clears each truck over the county bridge.",
    effectiveAt: "2026-06-05T15:30:00.000Z",
    expiresAt: "2026-06-08T00:00:00.000Z",
    createdAt: "2026-06-05T15:30:00.000Z"
  },
  {
    id: "31313131-3131-4131-8131-313131313112",
    organizationId: "33333333-3333-4333-8333-333333333331",
    relatedLoadId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    relatedLandingId: null,
    relatedDestinationId: "99999999-9999-4999-8999-999999999992",
    severity: "watch",
    title: "River Pulp west entrance queue",
    body: "Receiving is open but the west entrance is running behind; call unload desk before entering.",
    effectiveAt: "2026-06-05T14:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-06-05T14:00:00.000Z"
  }
])

/**
 * A card on file for both host organizations that post the seeded loads.
 *
 * Publishing requires an attached payment method, so without these the entire
 * seeded bench — every e2e journey and service test that posts a load — would be
 * blocked by the billing gate rather than by anything it was written to prove.
 *
 * The Stripe ids are obviously synthetic and belong to no Stripe account. They are
 * references to objects Stripe would hold, not card data: the only card details
 * stored anywhere here are a brand and four digits, which is all a host needs to
 * recognise which card is on file.
 */
export const seedHostBillingProfiles: HostBillingProfile[] = parseMany(hostBillingProfileSchema, [
  {
    id: "34343434-3434-4434-8434-343434343431",
    organizationId: "33333333-3333-4333-8333-333333333331",
    stripeCustomerId: "cus_seed_north_pine",
    defaultPaymentMethodId: "pm_seed_north_pine",
    paymentMethodBrand: "visa",
    paymentMethodLast4: "4242",
    status: "attached",
    attachedAt: timestamps.created,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  },
  {
    id: "34343434-3434-4434-8434-343434343432",
    organizationId: "33333333-3333-4333-8333-333333333332",
    stripeCustomerId: "cus_seed_summit_ridge",
    defaultPaymentMethodId: "pm_seed_summit_ridge",
    paymentMethodBrand: "mastercard",
    paymentMethodLast4: "4444",
    status: "attached",
    attachedAt: timestamps.created,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: timestamps.created,
    updatedAt: timestamps.updated
  }
])

/**
 * The landing-source demo host carries an agreement accepted by its actual owner
 * so new demo activity exercises production behavior. The fleet organization
 * stays explicit legacy history because it has no billing-authorized member.
 * Already-assigned rows remain frozen legacy below in either case.
 */
export const seedOrganizationBillingAccounts: OrganizationBillingAccount[] = parseMany(
  organizationBillingAccountSchema,
  [
    {
      activationState: "legacy",
      billingModel: "legacy_percentage",
      createdAt: timestamps.created,
      effectiveAt: timestamps.created,
      id: organizationBillingAccountId("33333333-3333-4333-8333-333333333331"),
      organizationId: "33333333-3333-4333-8333-333333333331",
      percentageTermsSnapshot: null,
      subscriptionId: null,
      updatedAt: timestamps.updated
    },
    {
      activationState: "percentage_active",
      billingModel: "percentage_v1",
      createdAt: timestamps.created,
      effectiveAt: "2026-08-03T00:00:00.000Z",
      id: organizationBillingAccountId("33333333-3333-4333-8333-333333333332"),
      organizationId: "33333333-3333-4333-8333-333333333332",
      percentageTermsSnapshot: {
        acceptedAt: "2026-08-03T00:00:00.000Z",
        acceptedByUserId: "22222222-2222-4222-8222-222222222223",
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        billingCadence: "monthly_in_arrears",
        currency: "USD",
        feeBps: PLATFORM_FEE_BPS
      },
      subscriptionId: null,
      updatedAt: "2026-08-03T00:00:00.000Z"
    }
  ]
)

function freezeSeedAssignmentBilling(assignment: Assignment): Assignment {
  const load = seedLoadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
  const driver = seedDriverProfiles.find((candidate) => candidate.id === assignment.driverProfileId)
  const committed = Boolean(assignment.assignedAt)

  return assignmentSchema.parse({
    ...assignment,
    billingCommittedAt: committed ? assignment.assignedAt : null,
    billingModel: committed ? "legacy_percentage" : null,
    billingPlanCodeAtCommitment: null,
    billingSubscriptionIdAtCommitment: null,
    capacitySource: committed && load && driver
      ? (load.companyId === driver.companyId ? "private_fleet" : "logloads_network")
      : null,
    loadMovementId: assignment.id
  })
}

export const seedDatabaseState: LogLoadsDatabaseState = {
  profiles: seedProfiles,
  companies: seedCompanies,
  organizations: seedOrganizations,
  organizationMemberships: seedOrganizationMemberships,
  organizationInvitations: seedOrganizationInvitations,
  privateNetworkRelationships: seedPrivateNetworkRelationships,
  driverProfiles: seedDriverProfiles,
  driverCredentials: seedDriverCredentials,
  credentialReviews: seedCredentialReviews,
  dispatcherProfiles: seedDispatcherProfiles,
  loaderProfiles: seedLoaderProfiles,
  truckProfiles: seedTruckProfiles,
  trailerProfiles: seedTrailerProfiles,
  equipmentCombinations: seedEquipmentCombinations,
  landings: seedLandings,
  richLandingDetails: seedRichLandingDetails,
  mills: seedMills,
  destinationFacilities: seedDestinationFacilities,
  haulRoutes: seedHaulRoutes,
  routePacks: seedRoutePacks,
  rates: seedRates,
  loadPostings: seedLoadPostings,
  opportunityCapacities: seedOpportunityCapacities,
  truckSlots: [...seedTruckSlots, ...seedCrossOrgTruckSlots],
  availabilityWindows: seedAvailabilityWindows,
  futureAvailability: seedFutureAvailability,
  assignments: [...seedAssignments, ...seedCrossOrgAssignments].map(freezeSeedAssignmentBilling),
  directOffers: seedDirectOffers,
  tripsV2: [...seedTripsV2, ...seedCrossOrgTrips],
  tripEvents: seedTripEvents,
  tripDocuments: seedTripDocuments,
  tripInspections: [],
  tripReviews: seedTripReviews,
  verificationRecords: seedVerificationRecords,
  entitlements: seedEntitlements,
  hostBillingProfiles: seedHostBillingProfiles,
  // The fee ledger and the invoice book start EMPTY, deliberately.
  //
  // No host has ever been charged by LogLoads. Seeding fee events for the loads
  // that this bench shows as completed would put revenue on a demo screen that
  // nobody was billed for and no invoice was raised against — a fabricated
  // financial record, which is exactly the class of claim this product refuses to
  // make anywhere else. An empty ledger is the true one, and the accrual path is
  // what fills it.
  platformFeeEvents: [],
  hostInvoices: [],
  billingPlanDefinitions: SUBSCRIPTION_PLAN_CATALOG.map((plan) => structuredClone(plan)),
  organizationBillingAccounts: seedOrganizationBillingAccounts,
  organizationSubscriptions: [],
  networkUsageEvents: [],
  billingPeriodSummaries: [],
  billingAdjustments: [],
  networkOverageInvoices: [],
  subscriptionBaseInvoices: [],
  operationalNotices: seedOperationalNotices,
  notifications: seedNotifications,
  supportRequests: [],
  messageThreads: seedMessageThreads,
  messageEvents: seedMessageEvents,
  auditEvents: seedAuditEvents
}
