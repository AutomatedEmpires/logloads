import { z } from "zod"

export const userRoleSchema = z.enum([
  "admin",
  "driver",
  "owner_operator",
  "dispatcher",
  "loader",
  "logging_company_admin",
  "mill_manager"
])

export const truckTypeSchema = z.enum([
  "log_truck",
  "chip_truck",
  "service_truck",
  "lowboy",
  "other"
])

export const trailerTypeSchema = z.enum([
  "pole_trailer",
  "bunk_trailer",
  "self_loader",
  "flatbed",
  "chip_van",
  "other"
])

export const loadStatusSchema = z.enum([
  "draft",
  "open",
  "scheduled",
  "filled",
  "in_transit",
  "completed",
  "cancelled",
  "archived"
])

export const truckSlotStatusSchema = z.enum([
  "open",
  "requested",
  "reserved",
  "filled",
  "completed",
  "cancelled"
])

export const assignmentStatusSchema = z.enum([
  "requested",
  "offered",
  "accepted",
  "checked_in",
  "loading",
  "hauled",
  "completed",
  "cancelled",
  "declined"
])

export const availabilityStatusSchema = z.enum([
  "available",
  "limited",
  "unavailable"
])

export const rateTypeSchema = z.enum([
  "per_load",
  "per_ton",
  "per_hour",
  "per_mile",
  "flat_rate",
  "negotiated"
])

export const roadConditionSchema = z.enum([
  "good",
  "wet",
  "muddy",
  "icy",
  "snow",
  "restricted",
  "closed"
])

export const verificationStatusSchema = z.enum([
  "pending",
  "verified",
  "rejected",
  "suspended"
])

export const notificationTypeSchema = z.enum([
  "load_opened",
  "slot_updated",
  "assignment_requested",
  "assignment_confirmed",
  "assignment_cancelled",
  "availability_reminder",
  "message_received",
  "system_alert"
])

export const loadTypeSchema = z.enum([
  "saw_logs",
  "pulpwood",
  "chips",
  "biomass",
  "mixed",
  "other"
])

export const scheduleTypeSchema = z.enum(["one_off", "recurring", "campaign"])

export const reviewTagSchema = z.enum([
  // Positive
  "on_time",
  "professional",
  "clear_instructions",
  "accurate_load",
  "easy_access",
  "good_communication",
  "safe",
  // Needs-work
  "late",
  "unsafe_access",
  "inaccurate_load",
  "poor_communication",
  "access_issues"
])

export type UserRole = z.infer<typeof userRoleSchema>
export type TruckType = z.infer<typeof truckTypeSchema>
export type TrailerType = z.infer<typeof trailerTypeSchema>
export type LoadStatus = z.infer<typeof loadStatusSchema>
export type TruckSlotStatus = z.infer<typeof truckSlotStatusSchema>
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>
export type RateType = z.infer<typeof rateTypeSchema>
export type RoadCondition = z.infer<typeof roadConditionSchema>
export type VerificationStatus = z.infer<typeof verificationStatusSchema>
export type NotificationType = z.infer<typeof notificationTypeSchema>
export type LoadType = z.infer<typeof loadTypeSchema>
export type ScheduleType = z.infer<typeof scheduleTypeSchema>
export type ReviewTag = z.infer<typeof reviewTagSchema>