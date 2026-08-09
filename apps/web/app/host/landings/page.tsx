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
import { hostPublishingOptionsForSurface } from "../publishing-options"

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
  const canViewPrivateLocation =
    role !== undefined && organizationRoleCan(role, "view_private_location")
  const canManageDestinations = role !== undefined && (
    organizationRoleCan(role, "manage_destination") || canPublish
  )
  const publishingOptions = getHostPublishingOptions(organizationId, actorUserId)
  const options = hostPublishingOptionsForSurface(publishingOptions, canPublish)
  const landingRecords = canViewPrivateLocation
    ? getHostLandingRecords(organizationId, role, actorUserId)
    : []

  return (
    <HostLandings
      account={shellAccountFor(context)}
      canManageLandings={canManageLandings}
      canManageDestinations={canManageDestinations}
      canPublish={canPublish}
      continuation={handoff?.continuation || undefined}
      landingDetailsRestricted={!canViewPrivateLocation}
      landings={landingRecords.map((landing) =>
        canManageLandings ? landing : { ...landing, editable: null }
      )}
      network={context.network}
      options={options}
      setup={getHostWorkspaceSetup(organizationId, role, actorUserId)}
      welcome={welcome}
      welcomeSource={handoff?.source}
    />
  )
}
