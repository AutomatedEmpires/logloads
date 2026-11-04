import { organizationRoleCan } from "@logloads/contracts"

import {
  ApiError,
  apiErrorResponse,
  requireApiActor
} from "@/lib/api-actor"

/**
 * Refuses a new percentage-fee acceptance. The completed-load fee is retired.
 * The active organization comes only from the authenticated actor.
 */
export async function POST() {
  try {
    const actor = await requireApiActor()
    const membership = actor.actor.memberships.find(
      (candidate) => candidate.organization.id === actor.organizationId
    )

    if (
      !membership ||
      !organizationRoleCan(membership.membership.role, "manage_billing")
    ) {
      throw new ApiError(
        "Only an organization owner, administrator, or billing manager can accept billing terms",
        403
      )
    }

    if (
      !["landing_source", "destination"].includes(
        membership.organization.type
      )
    ) {
      throw new ApiError(
        "The host percentage agreement is only available to host organizations",
        403
      )
    }

    throw new ApiError(
      "The completed-load percentage fee is retired and cannot be accepted.",
      410
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
