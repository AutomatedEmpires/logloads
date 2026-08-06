import { organizationRoleCan } from "@logloads/contracts"
import { cookies } from "next/headers"

import { FleetCommand, type FleetCredentialReadiness } from "@/components/v3"
import { getDriverCredentialVaultView } from "@/lib/credential-data"
import { getFleetCockpitData } from "@/lib/fleet-data"
import {
  firstSearchValue,
  firstRunContinuationCookieName,
  readFirstRunHandoffCookie
} from "@/lib/entry-routing"
import { getSessionActor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[]; welcome?: string | string[] }>
}) {
  const [params, data, cookieStore] = await Promise.all([
    searchParams,
    getFleetCockpitData(),
    cookies()
  ])
  const welcome = firstSearchValue(params.welcome) === "1"
  const handoff = welcome
    ? readFirstRunHandoffCookie(
        "fleet",
        cookieStore.get(firstRunContinuationCookieName("fleet"))?.value,
        data.actorUserId
      )
    : null
  const continuationHref = handoff?.continuation || null
  const firstUnit = data.network.trucks.at(0) ?? null
  let credentialReadiness: FleetCredentialReadiness | null = null

  if (welcome && firstUnit?.driverProfileId) {
    // getFleetCockpitData has already established and refreshed this request's
    // actor. getSessionActor is request-cached, so this reuses that exact actor
    // instead of creating a second, weaker authorization path for credentials.
    const actor = await getSessionActor()
    const role = actor?.activeMembership?.role

    if (
      actor &&
      role &&
      actor.activeOrganization?.id === data.network.activeOrganization.id &&
      organizationRoleCan(role, "manage_drivers")
    ) {
      const vault = getDriverCredentialVaultView(firstUnit.driverProfileId, {
        actorUserId: actor.profile.id,
        audience: "fleet",
        organizationId: data.network.activeOrganization.id
      })
      const exactRig = vault.equipmentReadiness.find(
        (equipment) => equipment.combinationId === firstUnit.id
      )

      if (exactRig) {
        credentialReadiness = {
          missingLabels: exactRig.missingLabels,
          satisfied: exactRig.satisfied
        }
      }
    }
  }

  return (
    <FleetCommand
      account={data.account}
      continuationHref={continuationHref}
      credentialReadiness={credentialReadiness}
      dispatchPlan={data.dispatchPlan}
      network={data.network}
      welcome={welcome}
    />
  )
}
