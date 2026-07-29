import { organizationRoleCan } from "@logloads/contracts"

import { HostLandings } from "@/components/v3"
import {
  getHostLandingRecords,
  getHostPublishingOptions,
  getHostWorkspaceSetup
} from "@/lib/host-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const context = await getCockpitContext("host")
  const organizationId = context.network.activeOrganization.id
  const welcome = (await searchParams).welcome === "1"
  // The host cockpit admits billing and destination managers too, so these
  // controls follow the same role matrix the services enforce rather than
  // offering a form that would be refused. Establishing a landing is the
  // landing manager's job (manage_landing); the lanes and rates a posting needs
  // answer to publish_load, so every role that may publish can produce them.
  const role = context.actor.activeMembership?.role
  const canManageLandings = role !== undefined && organizationRoleCan(role, "manage_landing")
  const canPublish = role !== undefined && organizationRoleCan(role, "publish_load")

  return (
    <HostLandings
      account={shellAccountFor(context)}
      canManageLandings={canManageLandings}
      canPublish={canPublish}
      landings={getHostLandingRecords(organizationId, role)}
      network={context.network}
      options={getHostPublishingOptions(organizationId)}
      setup={getHostWorkspaceSetup(organizationId)}
      welcome={welcome}
    />
  )
}
