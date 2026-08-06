import { organizationRoleCan } from "@logloads/contracts"
import { cookies } from "next/headers"

import { HostLandings } from "@/components/v3"
import {
  getHostLandingRecords,
  getHostPublishingOptions,
  getHostWorkspaceSetup
} from "@/lib/host-data"
import {
  firstSearchValue,
  firstRunContinuationCookieName,
  readFirstRunHandoffCookie
} from "@/lib/entry-routing"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[]; welcome?: string | string[] }>
}) {
  const [context, params, cookieStore] = await Promise.all([
    getCockpitContext("host"),
    searchParams,
    cookies()
  ])
  const organizationId = context.network.activeOrganization.id
  const actorUserId = context.actor.profile.id
  const welcome = firstSearchValue(params.welcome) === "1"
  const handoff = welcome
    ? readFirstRunHandoffCookie(
        "host",
        cookieStore.get(firstRunContinuationCookieName("host"))?.value,
        actorUserId
      )
    : null
  // The host cockpit admits billing and destination managers too, so these
  // controls follow the same role matrix the services enforce rather than
  // offering a form that would be refused. Establishing a landing is the
  // landing manager's job (manage_landing); the lanes and rates a posting needs
  // answer to publish_load, so every role that may publish can produce them.
  const role = context.actor.activeMembership?.role
  const canManageLandings = role !== undefined && organizationRoleCan(role, "manage_landing")
  const canPublish = role !== undefined && organizationRoleCan(role, "publish_load")
  const canManageDestinations = role !== undefined && (
    organizationRoleCan(role, "manage_destination") || canPublish
  )

  return (
    <HostLandings
      account={shellAccountFor(context)}
      canManageLandings={canManageLandings}
      canManageDestinations={canManageDestinations}
      canPublish={canPublish}
      continuation={handoff?.continuation || undefined}
      landings={getHostLandingRecords(organizationId, role, actorUserId)}
      network={context.network}
      options={getHostPublishingOptions(organizationId, actorUserId)}
      setup={getHostWorkspaceSetup(organizationId, role, actorUserId)}
      welcome={welcome}
      welcomeSource={handoff?.source}
    />
  )
}
