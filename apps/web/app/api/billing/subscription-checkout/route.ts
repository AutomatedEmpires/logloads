import { organizationRoleCan } from "@logloads/contracts"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"

/**
 * Subscription creation is retired. Existing provider-bound obligations keep
 * their signed webhook reconciliation and restricted portal route, but no
 * browser request can create, convert, restart, or change a subscription.
 */
export async function POST(request: Request) {
  try {
    // Read nothing from the body: authentication and the terminal 410 response
    // are deliberately invariant to any client-supplied plan or price fields.
    void request
    const actor = await requireApiActor()
    const membership = actor.actor.memberships.find(
      (candidate) => candidate.organization.id === actor.organizationId
    )

    if (
      !membership ||
      !organizationRoleCan(membership.membership.role, "manage_billing")
    ) {
      throw new ApiError(
        "Only an organization owner, administrator, or billing manager can manage billing",
        403
      )
    }

    await enforceApiRateLimit(
      "retired-subscription-checkout",
      actor.actorUserId,
      5,
      60_000
    )

    throw new ApiError(
      "New subscription enrollment is closed. Hosts use the current 5% completed-load agreement.",
      410
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
