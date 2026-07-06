import { z } from "zod"

import { availabilityStatusSchema, truckSlotStatusSchema } from "./enums"
import {
  assignmentSchema,
  loadPostingSchema,
  messageEventSchema,
  notificationSchema,
} from "./schemas"

const optionalIdSchema = z.string().uuid().optional()
const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()

export const createLoadPostingInputSchema = loadPostingSchema.omit({
  archivedAt: true,
  cancellationReason: true,
  createdAt: true,
  id: true,
  updatedAt: true
})

export const updateLoadPostingInputSchema = createLoadPostingInputSchema.partial().extend({
  id: z.string().uuid()
})

export const createTruckSlotInputSchema = z.object({
  loadPostingId: uuidSchema,
  landingId: uuidSchema,
  loaderProfileId: uuidSchema.optional().nullable(),
  slotDate: z.string().date(),
  startAt: timestampSchema,
  endAt: timestampSchema,
  capacity: z.number().int().positive(),
  status: truckSlotStatusSchema,
  notes: z.string().optional().nullable()
})

export const requestAssignmentInputSchema = assignmentSchema.omit({
  assignedAt: true,
  cancelledAt: true,
  completedAt: true,
  createdAt: true,
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

export type CreateLoadPostingInput = z.infer<typeof createLoadPostingInputSchema>
export type UpdateLoadPostingInput = z.infer<typeof updateLoadPostingInputSchema>
export type CreateTruckSlotInput = z.infer<typeof createTruckSlotInputSchema>
export type RequestAssignmentInput = z.infer<typeof requestAssignmentInputSchema>
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>
export type CreateMessageEventInput = z.infer<typeof createMessageEventInputSchema>
export type UpsertAvailabilityWindowInput = z.infer<typeof upsertAvailabilityWindowInputSchema>