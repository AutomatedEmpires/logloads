import { organizationRoleCan } from "@logloads/contracts"

import { HostOpportunities } from "@/components/v3"
import { getHostLoadPlanFacts, getHostPublishingOptions } from "@/lib/host-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { hostPublishingOptionsForSurface } from "../publishing-options"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const organizationId = context.network.activeOrganization.id
  const actorUserId = context.actor.profile.id
  // The host cockpit admits billing and destination managers too, so the
  // publishing surface follows the same role matrix the service enforces
  // rather than offering controls that would be refused. A viewer without an
  // active membership (a platform admin looking in) simply cannot publish.
  const role = context.actor.activeMembership?.role
  const canPublish = role !== undefined && organizationRoleCan(role, "publish_load")
  const publishingOptions = getHostPublishingOptions(organizationId, actorUserId)
  const options = hostPublishingOptionsForSurface(publishingOptions, canPublish)

  return (
    <HostOpportunities
      account={shellAccountFor(context)}
      canPublish={canPublish}
      network={context.network}
      options={options}
      planFacts={getHostLoadPlanFacts(organizationId)}
    />
  )
}
