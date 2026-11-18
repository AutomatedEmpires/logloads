import { z } from "zod"

/** The roles an owner may invite. Ownership changes hands only through a separate guarded transfer. */
export const MARKETPLACE_INVITABLE_ROLES = ["manager", "staff", "driver"] as const
export type MarketplaceInvitableRole = (typeof MARKETPLACE_INVITABLE_ROLES)[number]

/**
 * Days the adapter sends when a caller omits `validForDays`.
 * `invite_team_member` requires an interval and defines no default; 14 days is inside its 1 hour–30 day window.
 */
export const TEAM_INVITE_DEFAULT_DAYS = 14

export const TEAM_INVITE_ROLE_MESSAGE =
  "Invite a manager, staff member or driver; ownership changes hands only through a separate, guarded transfer"
export const TEAM_EMAIL_MESSAGE = "Enter the email address the person signs in with"
export const TEAM_SEAT_MESSAGE = "Say whether the person needs a Landing Operator seat"
export const TEAM_INVITE_DAYS_MESSAGE = "An invitation stays open between 1 and 30 days."
export const TEAM_DRIVER_SEAT_MESSAGE = "A driver never holds a Landing Operator seat"
export const TEAM_SCOPE_MESSAGE =
  "Only a manager or staff member with a Landing Operator seat can be limited to landings; owners always see every landing"
export const TEAM_LANDING_MESSAGE = "Choose landings of this organization that are not archived"

const email = z
  .string({ required_error: TEAM_EMAIL_MESSAGE, invalid_type_error: TEAM_EMAIL_MESSAGE })
  .trim()
  .toLowerCase()
  .refine((value) => value.length >= 3 && value.length <= 254 && value.indexOf("@") > 1 && !/\s/.test(value), TEAM_EMAIL_MESSAGE)

const landingId = z.string().uuid(TEAM_LANDING_MESSAGE).transform((value) => value.toLowerCase())

/** What an owner submits to invite someone. The schema is the parsed, normalized value. */
export interface MarketplaceTeamInviteInput {
  email: string
  role: MarketplaceInvitableRole
  landingWorkspaceSeat: boolean
  /** Only a seated manager or staff member may be limited to landings; empty means every landing. */
  landingIds: string[]
  /** 1–30 days. Omitted, the adapter sends `TEAM_INVITE_DEFAULT_DAYS`. */
  validForDays?: number
}

/** Limit one member to landings, or to none. */
export interface MarketplaceTeamScopeInput {
  membershipId: string
  /** Empty: every landing. */
  landingIds: string[]
}

export const marketplaceTeamInviteInputSchema: z.ZodType<MarketplaceTeamInviteInput, z.ZodTypeDef, unknown> = z
  .object({
    email,
    landingIds: z.array(landingId).default([]),
    landingWorkspaceSeat: z.boolean({ invalid_type_error: TEAM_SEAT_MESSAGE, required_error: TEAM_SEAT_MESSAGE }),
    role: z.enum(MARKETPLACE_INVITABLE_ROLES, { errorMap: () => ({ message: TEAM_INVITE_ROLE_MESSAGE }) }),
    validForDays: z.number().int(TEAM_INVITE_DAYS_MESSAGE).min(1, TEAM_INVITE_DAYS_MESSAGE).max(30, TEAM_INVITE_DAYS_MESSAGE).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === "driver" && value.landingWorkspaceSeat) {
      context.addIssue({ code: "custom", message: TEAM_DRIVER_SEAT_MESSAGE, path: ["landingWorkspaceSeat"] })
    }

    if (value.landingIds.length > 0 && (value.role === "driver" || !value.landingWorkspaceSeat)) {
      context.addIssue({ code: "custom", message: TEAM_SCOPE_MESSAGE, path: ["landingIds"] })
    }
  })

export const marketplaceTeamScopeInputSchema: z.ZodType<MarketplaceTeamScopeInput, z.ZodTypeDef, unknown> = z
  .object({
    landingIds: z.array(landingId).default([]),
    membershipId: z.string().uuid("Membership not found").transform((value) => value.toLowerCase())
  })
  .strict()
