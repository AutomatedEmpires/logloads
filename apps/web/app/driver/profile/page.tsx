import { cookies } from "next/headers"

import { DriverProfile } from "@/components/v3"
import { getDriverCredentialVaultView } from "@/lib/credential-data"
import { getDriverAvailability, getDriverProfileShowcase } from "@/lib/driver-data"
import {
  firstSearchValue,
  firstRunContinuationCookieName,
  readFirstRunHandoffCookie
} from "@/lib/entry-routing"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { listSubjectVerifications } from "@/lib/verification-data"
import { isDedicatedMediaConfigured } from "@/lib/media-config"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[]; welcome?: string | string[] }>
}) {
  const [context, params, cookieStore] = await Promise.all([
    getCockpitContext("driver"),
    searchParams,
    cookies()
  ])
  const welcome = firstSearchValue(params.welcome) === "1"
  const handoff = welcome
    ? readFirstRunHandoffCookie(
        "driver",
        cookieStore.get(firstRunContinuationCookieName("driver"))?.value,
        context.actor.profile.id
      )
    : null
  const driverProfileId = context.actor.driverProfileId
  const availability = getDriverAvailability(driverProfileId)
  const credentialVault = driverProfileId
    ? getDriverCredentialVaultView(driverProfileId, {
        actorUserId: context.actor.profile.id,
        audience: "driver",
        organizationId: context.network.activeOrganization.id
      })
    : null
  const mediaReady = isDedicatedMediaConfigured(process.env)

  return (
    <DriverProfile
      account={shellAccountFor(context)}
      availability={availability}
      continuationHref={handoff?.continuation || null}
      credentialVault={credentialVault}
      mediaReady={mediaReady}
      network={context.network}
      showcase={getDriverProfileShowcase({
        availabilityStatus: availability.current?.status ?? null,
        driverProfileId,
        mediaReady,
        network: context.network,
        vault: credentialVault
      })}
      verifications={listSubjectVerifications("person", context.actor.profile.id)}
      welcome={welcome}
    />
  )
}
