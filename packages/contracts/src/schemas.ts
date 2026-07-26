import { z } from "zod"

import {
  computePlatformFeeCents,
  FEE_BPS_SCALE,
  hostBillingProfileStatusSchema,
  hostInvoiceStatusSchema,
  invoicePeriodFor,
  platformFeeEventStatusSchema,
  type HostInvoiceStatus
} from "./billing-model"
import {
  assignmentStatusSchema,
  availabilityStatusSchema,
  loadStatusSchema,
  loadTypeSchema,
  notificationTypeSchema,
  rateTypeSchema,
  roadConditionSchema,
  scheduleTypeSchema,
  trailerTypeSchema,
  truckSlotStatusSchema,
  truckTypeSchema,
  userRoleSchema,
  verificationStatusSchema
} from "./enums"
import { isValidTimeRange } from "./helpers/date-time"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const optionalTimestampSchema = timestampSchema.optional().nullable()

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
})

export const mediaReferenceSchema = z.object({
  provider: z.literal("cloudinary"),
  publicId: z.string().min(1),
  version: z.number().int().positive(),
  format: z.enum(["jpg", "jpeg", "png", "webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive().max(10_000_000),
  uploadedAt: timestampSchema
})

export const contactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional().nullable()
})

export const moneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD")
})

export const recurringScheduleSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  untilDate: z.string().date().optional().nullable()
})

export const locationWindowSchema = z
  .object({
    startAt: timestampSchema,
    endAt: timestampSchema
  })
  .refine(isValidTimeRange, "Time windows must end after they start")

export const userSchema = z.object({
  id: uuidSchema,
  clerkUserId: z.string().min(1),
  role: userRoleSchema,
  fullName: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional().nullable(),
  companyId: uuidSchema.optional().nullable(),
  verificationStatus: verificationStatusSchema,
  isActive: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loggingCompanySchema = z.object({
  id: uuidSchema,
  slug: z.string().min(2),
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  verificationStatus: verificationStatusSchema,
  primaryRegion: z.string().min(1),
  contact: contactSchema,
  notes: z.string().optional().nullable(),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const driverProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  availabilityStatus: availabilityStatusSchema,
  licenseNumber: z.string().min(1),
  yearsExperience: z.number().int().min(0),
  homeBase: z.string().min(1),
  homeBaseCoordinates: coordinatesSchema.optional().nullable(),
  preferredFuelPriceCentsPerGallon: z.number().int().min(100).max(1000).optional().nullable(),
  operatingRadiusMiles: z.number().positive().optional().nullable(),
  profilePhoto: mediaReferenceSchema.optional().nullable(),
  /**
   * The driver's choice to show their rig's photo on their profile to the
   * people they work with. Presentation only — the photo itself lives on the
   * truck profile, and readers re-resolve it through the current active
   * equipment at request time.
   */
  featureTruckPhoto: z.boolean().default(false),
  equipmentPreferences: z.array(z.string()).default([]),
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const dispatcherProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema,
  dispatchRegion: z.string().min(1),
  contact: contactSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loaderProfileSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  companyId: uuidSchema,
  landingId: uuidSchema.optional().nullable(),
  contact: contactSchema,
  shiftNotes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const truckProfileSchema = z.object({
  id: uuidSchema,
  ownerUserId: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  truckType: truckTypeSchema,
  unitNumber: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  plateNumber: z.string().min(1),
  vin: z.string().min(6).optional().nullable(),
  axleCount: z.number().int().positive(),
  maxPayloadTons: z.number().positive(),
  fuelEconomyMpg: z.number().min(3).max(15).optional().nullable(),
  photo: mediaReferenceSchema.optional().nullable(),
  equipmentTags: z.array(z.string()).default([]),
  roadAccessCapabilities: z.array(z.string()).default([]),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const trailerProfileSchema = z.object({
  id: uuidSchema,
  ownerUserId: uuidSchema,
  truckId: uuidSchema.optional().nullable(),
  trailerType: trailerTypeSchema,
  unitNumber: z.string().min(1),
  capacityTons: z.number().positive(),
  photo: mediaReferenceSchema.optional().nullable(),
  equipmentTags: z.array(z.string()).default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

const siteBaseSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema.optional().nullable(),
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2),
  postalCode: z.string().min(3),
  coordinates: coordinatesSchema,
  contact: contactSchema,
  slotWindowMinutes: z.number().int().positive().optional().nullable(),
  accessNotes: z.string().optional().nullable(),
  roadCondition: roadConditionSchema.optional().nullable(),
  weatherNotes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const landingSchema = siteBaseSchema.extend({
  loaderProfileId: uuidSchema.optional().nullable()
})

export const millSchema = siteBaseSchema.extend({
  millCode: z.string().min(1)
})

export const haulRouteSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  landingId: uuidSchema,
  millId: uuidSchema,
  routeName: z.string().min(1),
  estimatedDistanceMiles: z.number().positive(),
  estimatedRunTimeMinutes: z.number().int().positive(),
  roadCondition: roadConditionSchema,
  mapPolyline: z.string().optional().nullable(),
  roadNotes: z.string().optional().nullable(),
  weatherNotes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const rateSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  rateType: rateTypeSchema,
  baseRate: moneySchema,
  fuelSurchargeCents: z.number().int().min(0).default(0),
  notes: z.string().optional().nullable(),
  effectiveDate: z.string().date(),
  expiresAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const loadPostingSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  dispatcherProfileId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  pickupLandingId: uuidSchema,
  dropoffMillId: uuidSchema,
  routeId: uuidSchema,
  rateId: uuidSchema,
  title: z.string().min(1),
  loadType: loadTypeSchema,
  status: loadStatusSchema,
  scheduleType: scheduleTypeSchema,
  loadDate: z.string().date().optional().nullable(),
  campaignStartDate: z.string().date().optional().nullable(),
  campaignEndDate: z.string().date().optional().nullable(),
  recurringSchedule: recurringScheduleSchema.optional().nullable(),
  dailyTruckCountNeeded: z.number().int().positive(),
  /**
   * What the host states this load pays the driver, in whole cents.
   *
   * This is the authoritative figure a driver reads — not a derivation of the
   * company rate card (`rateId`), which is a price list rather than a promise
   * about one load. The platform fee is charged to the host ON TOP of this
   * number and is never deducted from it.
   *
   * Optional only for the migration: loads posted before this field existed
   * keep falling back to their rate-derived label, because backfilling an
   * estimate into a field that means "the host said so" would manufacture a
   * commitment nobody made. Newly posted loads carry a real number.
   */
  driverPayCents: z.number().int().positive().optional().nullable(),
  estimatedTonsPerLoad: z.number().positive().optional().nullable(),
  equipmentRequirements: z.array(z.string()).default([]),
  accessRequirements: z.array(z.string()).default([]),
  roadCondition: roadConditionSchema,
  weatherNotes: z.string().optional().nullable(),
  dispatcherContact: contactSchema,
  loaderContact: contactSchema.optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const truckSlotSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  landingId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  slotDate: z.string().date(),
  startAt: timestampSchema,
  endAt: timestampSchema,
  capacity: z.number().int().positive(),
  reservedCount: z.number().int().min(0),
  status: truckSlotStatusSchema,
  notes: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
  .refine((value) => value.reservedCount <= value.capacity, {
    message: "Reserved count cannot exceed slot capacity",
    path: ["reservedCount"]
  })
  .refine((value) => isValidTimeRange({ startAt: value.startAt, endAt: value.endAt }), {
    message: "Truck slot must end after it starts",
    path: ["endAt"]
  })

export const availabilityWindowSchema = z
  .object({
    id: uuidSchema,
    driverProfileId: uuidSchema,
    truckProfileId: uuidSchema.optional().nullable(),
    status: availabilityStatusSchema,
    startAt: timestampSchema,
    endAt: timestampSchema,
    preferredRouteIds: z.array(uuidSchema).default([]),
    notes: z.string().optional().nullable(),
    recurringSchedule: recurringScheduleSchema.optional().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine(isValidTimeRange, {
    message: "Availability windows must end after they start",
    path: ["endAt"]
  })

export const assignmentSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema,
  /**
   * The invitation that authorized this assignment, when capacity was claimed
   * through a direct offer. This is a typed relationship rather than a value
   * hidden in termsSnapshot so retries, limits, and audits can be enforced.
   */
  directOfferId: uuidSchema.optional().nullable().default(null),
  truckSlotId: uuidSchema,
  driverProfileId: uuidSchema,
  truckProfileId: uuidSchema,
  trailerProfileId: uuidSchema.optional().nullable(),
  status: assignmentStatusSchema,
  requestedAt: timestampSchema,
  assignedAt: optionalTimestampSchema,
  completedAt: optionalTimestampSchema,
  cancelledAt: optionalTimestampSchema,
  cancellationReason: z.string().optional().nullable(),
  dispatcherNotes: z.string().optional().nullable(),
  termsSnapshot: z.record(z.unknown()).default({}),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const notificationSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  type: notificationTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  relatedEntityType: z.string().optional().nullable(),
  relatedEntityId: uuidSchema.optional().nullable(),
  readAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const messageThreadSchema = z.object({
  id: uuidSchema,
  loadPostingId: uuidSchema.optional().nullable(),
  assignmentId: uuidSchema.optional().nullable(),
  participantUserIds: z.array(uuidSchema).min(2),
  subject: z.string().optional().nullable(),
  lastMessageAt: optionalTimestampSchema,
  archivedAt: optionalTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const messageEventSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  authorUserId: uuidSchema,
  body: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const auditEventSchema = z.object({
  id: uuidSchema,
  actorUserId: uuidSchema.optional().nullable(),
  entityType: z.string().min(1),
  entityId: uuidSchema,
  action: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  createdAt: timestampSchema
})

/**
 * ── Platform fee billing ──────────────────────────────────────────────────────
 *
 * Three persisted facts: the fee accrued on a completed load, the monthly bill it
 * lands on, and whether the host has a card that bill can be charged to.
 *
 * None of these records driver money. LogLoads never holds, routes or pays out
 * driver funds — driver pay moves host → driver directly, off-platform — so there
 * is deliberately no amount here that belongs to a driver, and no field that could
 * carry one.
 *
 * The refinements below are not decoration. The operating state is one JSONB
 * document with no unique index, no foreign key and no CHECK constraint, so a row
 * contract is the only place an invariant about a money record can be enforced at
 * the storage boundary: a row that breaks one is withheld from runtime state and
 * reported, instead of being read as a bill.
 */

export const platformFeeEventSchema = z
  .object({
    /**
     * platformFeeEventId(assignmentId). Deterministic, so a second accrual for the
     * same assignment computes an id that is already present.
     */
    id: uuidSchema,
    /** The HOST organization being billed. Never a driver. */
    organizationId: uuidSchema,
    loadPostingId: uuidSchema,
    assignmentId: uuidSchema,
    truckSlotId: uuidSchema,
    /**
     * The host-stated driver pay, FROZEN at accrual. Copied rather than referenced
     * so the charge can still be explained years later after the posting has been
     * edited, cancelled or archived. Editing a load must never restate a bill the
     * host has already been given.
     */
    driverPayCents: z.number().int().positive(),
    /**
     * The rate in basis points, FROZEN at accrual. A later rate change re-rates
     * nothing: this is the rate the host was charged under, not a pointer to the
     * current one.
     */
    feeBps: z.number().int().min(0).max(FEE_BPS_SCALE),
    /** The charge itself, stored. A recomputed fee is a bill that can restate itself. */
    feeCents: z.number().int().nonnegative(),
    status: platformFeeEventStatusSchema,
    /** When the load became billable — the completion this fee is for. */
    occurredAt: timestampSchema,
    invoiceId: uuidSchema.optional().nullable(),
    voidReason: z.string().min(1).max(300).optional().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine(
    (value) => {
      try {
        return value.feeCents === computePlatformFeeCents(value.driverPayCents, value.feeBps)
      } catch {
        // Zod still runs refinements after a field-level failure, and this row
        // contract is applied to every stored row on every read of the operating
        // state document. A refinement that threw would turn one malformed row into
        // a failed read of the whole database, so an unusable row is simply
        // rejected here and the field contracts above report why.
        return false
      }
    },
    {
      message: "A stored fee must equal what its own frozen pay and rate produce",
      path: ["feeCents"]
    }
  )
  .refine((value) => value.status !== "invoiced" || Boolean(value.invoiceId), {
    message: "An invoiced fee must name the invoice it is on",
    path: ["invoiceId"]
  })
  .refine((value) => value.status !== "accrued" || !value.invoiceId, {
    message: "An accrued fee is not on an invoice yet",
    path: ["invoiceId"]
  })
  // A voided fee keeps any invoiceId it already had; withdrawing a charge must not
  // erase which bill it was raised on.
  .refine((value) => value.status !== "voided" || Boolean(value.voidReason), {
    message: "A voided fee must say why it was withdrawn",
    path: ["voidReason"]
  })
  .refine((value) => value.status === "voided" || !value.voidReason, {
    message: "Only a voided fee carries a void reason",
    path: ["voidReason"]
  })

/**
 * Which timestamps a bill in each state must already carry.
 *
 * An exhaustive record: adding a state to `hostInvoiceStatusSchema` will not
 * compile until somebody says what must be true of a bill in it. A status is a
 * claim to the host about their money, and an unmapped one would make that claim
 * with nothing behind it.
 */
const HOST_INVOICE_REQUIRED_TIMESTAMPS: Record<
  HostInvoiceStatus,
  ReadonlyArray<"issuedAt" | "paidAt" | "voidedAt">
> = {
  draft: [],
  open: ["issuedAt"],
  paid: ["issuedAt", "paidAt"],
  uncollectible: ["issuedAt"],
  void: ["voidedAt"]
}

export const hostInvoiceSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    /** First instant of the UTC month. Inclusive. */
    periodStart: timestampSchema,
    /** First instant of the next UTC month. Exclusive, so periods cannot overlap. */
    periodEnd: timestampSchema,
    status: hostInvoiceStatusSchema,
    /** invoiceSubtotalCents(feeEvents). Stored, so an issued bill cannot restate itself. */
    subtotalCents: z.number().int().nonnegative(),
    /** The fees this bill is made of. Enumerated, so a total is always explainable. */
    feeEventIds: z.array(uuidSchema).default([]),
    stripeInvoiceId: z.string().min(1).optional().nullable(),
    issuedAt: optionalTimestampSchema,
    paidAt: optionalTimestampSchema,
    voidedAt: optionalTimestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  // Compared as instants rather than as strings: the same month boundary has
  // several valid ISO spellings, and only one of them is what invoicePeriodFor
  // happens to emit.
  //
  // Every refinement below is total. Zod runs refinements even after a field-level
  // failure, and these contracts validate every stored row on every read of the
  // operating state document, so one that threw would turn a single malformed bill
  // into a failed read of the whole database.
  .refine(
    (value) => {
      try {
        const period = invoicePeriodFor(value.periodStart)

        return (
          Date.parse(period.periodStart) === Date.parse(value.periodStart) &&
          Date.parse(period.periodEnd) === Date.parse(value.periodEnd)
        )
      } catch {
        return false
      }
    },
    {
      message: "A bill covers exactly one UTC calendar month",
      path: ["periodEnd"]
    }
  )
  .refine(
    (value) =>
      Array.isArray(value.feeEventIds) &&
      new Set(value.feeEventIds).size === value.feeEventIds.length,
    {
      message: "A fee may appear on a bill once",
      path: ["feeEventIds"]
    }
  )
  .refine(
    (value) =>
      (HOST_INVOICE_REQUIRED_TIMESTAMPS[value.status] ?? []).every((field) => Boolean(value[field])),
    {
      message: "A bill must carry the timestamps its status claims",
      path: ["status"]
    }
  )

export const hostBillingProfileSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    stripeCustomerId: z.string().min(1).optional().nullable(),
    /**
     * The Stripe payment method charged in arrears. LogLoads holds no card data of
     * its own — this is a reference to something Stripe holds.
     */
    defaultPaymentMethodId: z.string().min(1).optional().nullable(),
    /** DISPLAY ONLY, so a host can recognise which card is on file. */
    paymentMethodBrand: z.string().min(1).max(40).optional().nullable(),
    /**
     * DISPLAY ONLY. Exactly four digits by contract — the pattern is what makes it
     * impossible for a full card number to be stored in this column, rather than a
     * convention someone has to remember.
     */
    paymentMethodLast4: z
      .string()
      .regex(/^\d{4}$/, "Only the last four digits may be stored")
      .optional()
      .nullable(),
    status: hostBillingProfileStatusSchema,
    attachedAt: optionalTimestampSchema,
    lastFailureAt: optionalTimestampSchema,
    lastFailureReason: z.string().min(1).max(300).optional().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  // "attached" is what gates publishing, so it has to mean something: a customer,
  // a default payment method, and when it was attached.
  .refine(
    (value) =>
      value.status !== "attached" ||
      Boolean(value.stripeCustomerId && value.defaultPaymentMethodId && value.attachedAt),
    {
      message: "An attached profile must name its customer, payment method and when it attached",
      path: ["status"]
    }
  )
  .refine((value) => value.status !== "none" || !value.defaultPaymentMethodId, {
    message: "A profile with no card on file must not name a payment method",
    path: ["defaultPaymentMethodId"]
  })
  .refine(
    (value) =>
      value.status !== "failed" || Boolean(value.lastFailureAt && value.lastFailureReason),
    {
      message: "A failed profile must record when it failed and why",
      path: ["status"]
    }
  )

export type User = z.infer<typeof userSchema>
export type DriverProfile = z.infer<typeof driverProfileSchema>
export type MediaReference = z.infer<typeof mediaReferenceSchema>
export type TruckProfile = z.infer<typeof truckProfileSchema>
export type TrailerProfile = z.infer<typeof trailerProfileSchema>
export type LoggingCompany = z.infer<typeof loggingCompanySchema>
export type DispatcherProfile = z.infer<typeof dispatcherProfileSchema>
export type LoaderProfile = z.infer<typeof loaderProfileSchema>
export type Landing = z.infer<typeof landingSchema>
export type Mill = z.infer<typeof millSchema>
export type HaulRoute = z.infer<typeof haulRouteSchema>
export type LoadPosting = z.infer<typeof loadPostingSchema>
export type TruckSlot = z.infer<typeof truckSlotSchema>
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>
export type Assignment = z.infer<typeof assignmentSchema>
export type Rate = z.infer<typeof rateSchema>
export type Notification = z.infer<typeof notificationSchema>
export type MessageThread = z.infer<typeof messageThreadSchema>
export type MessageEvent = z.infer<typeof messageEventSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type PlatformFeeEvent = z.infer<typeof platformFeeEventSchema>
export type HostInvoice = z.infer<typeof hostInvoiceSchema>
export type HostBillingProfile = z.infer<typeof hostBillingProfileSchema>
