import { z } from "zod"

import { availabilityStatusSchema, loadStatusSchema, truckSlotStatusSchema } from "./enums"
import {
  assignmentBaseSchema,
  loadPostingSchema,
  messageEventSchema,
  notificationSchema,
} from "./schemas"

const optionalIdSchema = z.string().uuid().optional()
const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()

/**
 * The statuses a lifecycle may legitimately START in. Extracted from the domain
 * enums, so renaming or dropping a status there fails the build here instead of
 * silently widening what a client may post.
 *
 * A create call is the one write no state machine can guard: there is no prior
 * status to transition from, so whatever the payload says becomes the record's
 * status. Admitting the whole enum let a client post a load already "completed"
 * or "in_transit" and a slot already "completed" — the platform fee is charged
 * on completed loads, so a load that can be born completed is a fabricable
 * billable event. Every later change goes through state-machines.ts.
 */
export const initialLoadStatusSchema = loadStatusSchema.extract(["draft", "open", "scheduled"])
export const initialTruckSlotStatusSchema = truckSlotStatusSchema.extract(["open"])

export const createLoadPostingInputSchema = loadPostingSchema
  .omit({
    archivedAt: true,
    cancellationReason: true,
    createdAt: true,
    id: true,
    updatedAt: true
  })
  .extend({
    status: initialLoadStatusSchema
  })

/**
 * Updates keep the full status range on purpose: updateLoadPosting() runs every
 * change through transitionLoadPostingStatus, so the machine — not the payload —
 * decides which move is legal from the load's current status.
 */
export const updateLoadPostingInputSchema = createLoadPostingInputSchema.partial().extend({
  id: z.string().uuid(),
  status: loadStatusSchema.optional()
})

export const createTruckSlotInputSchema = z.object({
  loadPostingId: uuidSchema,
  landingId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  slotDate: z.string().date(),
  startAt: timestampSchema,
  endAt: timestampSchema,
  capacity: z.number().int().positive(),
  status: initialTruckSlotStatusSchema,
  notes: z.string().optional().nullable()
})

export const requestAssignmentInputSchema = assignmentBaseSchema.omit({
  assignedAt: true,
  cancelledAt: true,
  completedAt: true,
  createdAt: true,
  driverPaymentReceivedAt: true,
  driverPaymentReceivedByUserId: true,
  driverPaymentSentAt: true,
  driverPaymentSentByUserId: true,
  id: true,
  requestedAt: true,
  status: true,
  updatedAt: true
})

export const createNotificationInputSchema = notificationSchema.omit({
  createdAt: true,
  id: true,
  readAt: true,
  updatedAt: true
})

export const createMessageEventInputSchema = messageEventSchema.omit({
  createdAt: true,
  id: true,
  updatedAt: true
})

export const upsertAvailabilityWindowInputSchema = z.object({
  id: optionalIdSchema,
  driverProfileId: uuidSchema,
  truckProfileId: uuidSchema.optional().nullable(),
  status: availabilityStatusSchema,
  startAt: timestampSchema,
  endAt: timestampSchema,
  preferredRouteIds: z.array(uuidSchema).default([]),
  notes: z.string().optional().nullable(),
  recurringSchedule: z
    .object({
      frequency: z.enum(["daily", "weekly"]),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
      untilDate: z.string().date().optional().nullable()
    })
    .optional()
    .nullable()
})

export type InitialLoadStatus = z.infer<typeof initialLoadStatusSchema>
export type InitialTruckSlotStatus = z.infer<typeof initialTruckSlotStatusSchema>
export type CreateLoadPostingInput = z.infer<typeof createLoadPostingInputSchema>
export type UpdateLoadPostingInput = z.infer<typeof updateLoadPostingInputSchema>
export type CreateTruckSlotInput = z.infer<typeof createTruckSlotInputSchema>
export type RequestAssignmentInput = z.infer<typeof requestAssignmentInputSchema>
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>
export type CreateMessageEventInput = z.infer<typeof createMessageEventInputSchema>
export type UpsertAvailabilityWindowInput = z.infer<typeof upsertAvailabilityWindowInputSchema>
