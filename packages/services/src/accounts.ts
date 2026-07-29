import { randomUUID } from "node:crypto"

import {
  availabilityWindowSchema,
  dispatcherProfileSchema,
  driverProfileSchema,
  entitlementSchema,
  equipmentCombinationSchema,
  loggingCompanySchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationMembershipSchema,
  organizationSchema,
  trailerProfileSchema,
  truckProfileSchema,
  userSchema,
  trailerTypeSchema,
  truckTypeSchema,
  type Organization,
  type OrganizationMembership,
  type User
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

export const accountPathSchema = z.enum(["driver", "fleet", "host"])

export const accountTypeSchema = z.enum([
  "owner_operator",
  "company_driver",
  "leased_on_driver",
  "small_fleet",
  "fleet",
  "logging_contractor",
  "timber_organization",
  "landing_operator"
])

export const onboardingAvailabilityPresetSchema = z.enum(["today", "three_days", "not_ready"])

export const createAccountInputSchema = z.object({
  clerkUserId: z.string().min(1).optional().nullable(),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  path: accountPathSchema,
  accountType: accountTypeSchema,
  availabilityPreset: onboardingAvailabilityPresetSchema.default("three_days"),
  organizationName: z.string().min(2).optional().nullable(),
  region: z.string().min(2),
  equipment: z
    .object({
      truckType: truckTypeSchema,
      trailerType: trailerTypeSchema.optional().nullable(),
      maxPayloadTons: z.number().positive().max(60)
    })
    .optional()
    .nullable()
})

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>

export interface AccountContext {
  profile: User
  memberships: Array<{
    membership: OrganizationMembership
    organization: Organization
  }>
  driverProfileId: string | null
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "org"
}

function uniqueSlug(state: LogLoadsDatabaseState, base: string): string {
  const taken = new Set(state.organizations.map((organization) => organization.slug))
  if (!taken.has(base)) {
    return base
  }

  let counter = 2
  while (taken.has(`${base}-${counter}`)) {
    counter += 1
  }

  return `${base}-${counter}`
}

export function findProfileByClerkId(state: LogLoadsDatabaseState, clerkUserId: string): User | undefined {
  return state.profiles.find((profile) => profile.clerkUserId === clerkUserId && profile.isActive)
}

export function findProfileByEmail(state: LogLoadsDatabaseState, email: string): User | undefined {
  const normalized = email.trim().toLowerCase()

  return state.profiles.find((profile) => profile.email?.toLowerCase() === normalized && profile.isActive)
}

export function getAccountContext(state: LogLoadsDatabaseState, userId: string): AccountContext | null {
  const profile = state.profiles.find((candidate) => candidate.id === userId && candidate.isActive)

  if (!profile) {
    return null
  }

  const memberships = state.organizationMemberships
    .filter((membership) => membership.userId === userId && membership.status === "active")
    .flatMap((membership) => {
      const organization = state.organizations.find((candidate) => candidate.id === membership.organizationId)

      return organization ? [{ membership, organization }] : []
    })

  const driverProfile = state.driverProfiles.find((candidate) => candidate.userId === userId)

  return {
    driverProfileId: driverProfile?.id ?? null,
    memberships,
    profile
  }
}

function userRoleForPath(input: CreateAccountInput): User["role"] {
  if (input.path === "driver") {
    return input.accountType === "owner_operator" ? "owner_operator" : "driver"
  }

  if (input.path === "fleet") {
    return "dispatcher"
  }

  return "logging_company_admin"
}

function organizationTypeForPath(input: CreateAccountInput): Organization["type"] {
  if (input.path === "host") {
    return "landing_source"
  }

  if (input.path === "fleet") {
    return "fleet"
  }

  return "carrier"
}

function membershipRoleForPath(input: CreateAccountInput): OrganizationMembership["role"] {
  if (input.path === "driver") {
    return input.accountType === "owner_operator" ? "owner" : "driver"
  }

  return "owner"
}

export function createAccount(state: LogLoadsDatabaseState, rawInput: unknown): AccountContext {
  const input = createAccountInputSchema.parse(rawInput)
  const normalizedEmail = input.email.trim().toLowerCase()

  if (findProfileByEmail(state, normalizedEmail)) {
    throw new Error("An account already exists for this email address")
  }

  if (input.clerkUserId && findProfileByClerkId(state, input.clerkUserId)) {
    throw new Error("An account already exists for this sign-in")
  }

  const nowDate = new Date()
  const now = nowDate.toISOString()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const organizationName = input.organizationName?.trim() || `${input.fullName.trim()} Hauling`

  const organization = organizationSchema.parse({
    archivedAt: null,
    createdAt: now,
    displayName: organizationName,
    id: organizationId,
    legalName: organizationName,
    primaryRegion: input.region.trim(),
    slug: uniqueSlug(state, slugify(organizationName)),
    type: organizationTypeForPath(input),
    updatedAt: now,
    verificationStatus: "pending"
  })

  const profile = userSchema.parse({
    clerkUserId: input.clerkUserId ?? `local-${userId}`,
    companyId: organizationId,
    createdAt: now,
    email: normalizedEmail,
    fullName: input.fullName.trim(),
    id: userId,
    isActive: true,
    phone: input.phone.trim(),
    role: userRoleForPath(input),
    updatedAt: now,
    verificationStatus: "pending"
  })

  const membership = organizationMembershipSchema.parse({
    createdAt: now,
    id: randomUUID(),
    organizationId,
    role: membershipRoleForPath(input),
    status: "active",
    updatedAt: now,
    userId
  })

  state.organizations.push(organization)
  state.profiles.push(profile)
  state.organizationMemberships.push(membership)

  // Hosts publish loads, which reference companies; keep the seed convention of a
  // company record sharing the organization id.
  if (input.path === "host") {
    state.companies.push(
      loggingCompanySchema.parse({
        archivedAt: null,
        contact: { name: profile.fullName, phone: profile.phone, email: normalizedEmail },
        createdAt: now,
        displayName: organizationName,
        id: organizationId,
        legalName: organizationName,
        notes: null,
        primaryRegion: input.region.trim(),
        slug: organization.slug,
        updatedAt: now,
        verificationStatus: "pending"
      })
    )

    // Every posting carries a dispatch contact so a driver knows who runs the
    // move, and publishing refuses without one. For a host that just signed up
    // that person is whoever signed up — the same reasoning that gives a driver
    // a driver profile here rather than making them ask for one. They can hand
    // dispatch to someone else later; they cannot post work before they do.
    state.dispatcherProfiles.push(
      dispatcherProfileSchema.parse({
        companyId: organizationId,
        contact: { email: normalizedEmail, name: profile.fullName, phone: profile.phone },
        createdAt: now,
        dispatchRegion: input.region.trim(),
        id: randomUUID(),
        updatedAt: now,
        userId
      })
    )

    // A host account is an operating identity, not acceptance of commercial
    // terms. Explicit `unenrolled` prevents both dangerous defaults: silently
    // reviving the legacy 5% model and silently granting a paid subscription.
    state.organizationBillingAccounts.push(
      organizationBillingAccountSchema.parse({
        activationState: "unenrolled",
        billingModel: null,
        createdAt: now,
        effectiveAt: now,
        id: organizationBillingAccountId(organizationId),
        organizationId,
        subscriptionId: null,
        updatedAt: now
      })
    )
  }

  let driverProfileId: string | null = null

  if (input.path === "driver") {
    driverProfileId = randomUUID()
    state.driverProfiles.push(
      driverProfileSchema.parse({
        availabilityStatus: input.availabilityPreset === "not_ready" ? "unavailable" : "available",
        companyId: organizationId,
        createdAt: now,
        equipmentPreferences: [],
        homeBase: input.region.trim(),
        id: driverProfileId,
        licenseNumber: "pending-review",
        notes: null,
        updatedAt: now,
        userId,
        yearsExperience: 0
      })
    )

    if (input.availabilityPreset !== "not_ready") {
      const durationHours = input.availabilityPreset === "today" ? 24 : 72

      state.availabilityWindows.push(
        availabilityWindowSchema.parse({
          createdAt: now,
          driverProfileId,
          endAt: new Date(nowDate.getTime() + durationHours * 60 * 60 * 1000).toISOString(),
          id: randomUUID(),
          notes: "Set during driver onboarding.",
          preferredRouteIds: [],
          recurringSchedule: null,
          startAt: now,
          status: "available",
          truckProfileId: null,
          updatedAt: now
        })
      )
    }
  }

  if (input.equipment && (input.path === "driver" || input.path === "fleet")) {
    const truckId = randomUUID()
    const trailerId = input.equipment.trailerType ? randomUUID() : null

    state.truckProfiles.push(
      truckProfileSchema.parse({
        archivedAt: null,
        axleCount: 5,
        companyId: organizationId,
        createdAt: now,
        equipmentTags: [],
        id: truckId,
        make: "Unspecified",
        maxPayloadTons: input.equipment.maxPayloadTons,
        model: "Unspecified",
        ownerUserId: userId,
        plateNumber: "PENDING",
        roadAccessCapabilities: [],
        truckType: input.equipment.truckType,
        unitNumber: "Unit 1",
        updatedAt: now,
        vin: null
      })
    )

    if (trailerId && input.equipment.trailerType) {
      state.trailerProfiles.push(
        trailerProfileSchema.parse({
          capacityTons: input.equipment.maxPayloadTons,
          createdAt: now,
          equipmentTags: [],
          id: trailerId,
          ownerUserId: userId,
          trailerType: input.equipment.trailerType,
          truckId,
          unitNumber: "Trailer 1",
          updatedAt: now
        })
      )
    }

    state.equipmentCombinations.push(
      equipmentCombinationSchema.parse({
        assignedDriverProfileId: driverProfileId,
        capabilityTags: [],
        createdAt: now,
        homeRegion: input.region.trim(),
        id: randomUUID(),
        label: "Unit 1",
        lastVerifiedAt: null,
        maxPayloadTons: input.equipment.maxPayloadTons,
        organizationId,
        productLengthMaxFeet: null,
        productLengthMinFeet: null,
        status: "available",
        trailerProfileId: trailerId,
        trailerTypes: input.equipment.trailerType ? [input.equipment.trailerType] : [],
        truckProfileId: truckId,
        truckTypes: [input.equipment.truckType],
        updatedAt: now
      })
    )
  }

  // Driver Core remains the free driver product and fleet onboarding retains its
  // existing trial. A new HOST receives no landing_operations entitlement:
  // Dispatch Pro capabilities start only after an explicit accepted agreement.
  if (input.path !== "host") {
    const entitlementProduct =
      input.path === "driver" ? "driver_core" : "fleet_operations"

    state.entitlements.push(
      entitlementSchema.parse({
        activeLandingLimit: null,
        activeTruckLimit: input.path === "fleet" ? 5 : 1,
        createdAt: now,
        currentPeriodEndsAt:
          input.path === "fleet"
            ? new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        features: [],
        id: randomUUID(),
        organizationId,
        product: entitlementProduct,
        status: input.path === "fleet" ? "trialing" : "active",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: now
      })
    )
  }

  state.auditEvents.push({
    action: "account_created",
    actorUserId: userId,
    createdAt: now,
    entityId: organizationId,
    entityType: "organization",
    id: randomUUID(),
    metadata: { path: input.path, accountType: input.accountType }
  })

  const context = getAccountContext(state, userId)

  if (!context) {
    throw new Error("Account provisioning failed")
  }

  return context
}

export function linkProfileToClerkUser(state: LogLoadsDatabaseState, userId: string, clerkUserId: string): User {
  const profile = state.profiles.find((candidate) => candidate.id === userId)

  if (!profile) {
    throw new Error("Profile not found")
  }

  profile.clerkUserId = clerkUserId
  profile.updatedAt = new Date().toISOString()

  return profile
}
