import { cookies } from "next/headers"

import { DriverProfile } from "@/components/v3"
import { getDriverCredentialVaultView } from "@/lib/credential-data"
import { getDriverAvailability } from "@/lib/driver-data"
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

  return (
    <DriverProfile
      account={shellAccountFor(context)}
      availability={getDriverAvailability(context.actor.driverProfileId)}
      continuationHref={handoff?.continuation || null}
      credentialVault={
        context.actor.driverProfileId
          ? getDriverCredentialVaultView(context.actor.driverProfileId, {
              actorUserId: context.actor.profile.id,
              audience: "driver",
              organizationId: context.network.activeOrganization.id
            })
          : null
      }
      mediaReady={isDedicatedMediaConfigured(process.env)}
      network={context.network}
      verifications={listSubjectVerifications("person", context.actor.profile.id)}
      welcome={welcome}
    />
  )
}
