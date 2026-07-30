import { DriverProfile } from "@/components/v3"
import { getDriverCredentialVaultView } from "@/lib/credential-data"
import { getDriverAvailability } from "@/lib/driver-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { listSubjectVerifications } from "@/lib/verification-data"
import { isDedicatedMediaConfigured } from "@/lib/media-config"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("driver")

  return (
    <DriverProfile
      account={shellAccountFor(context)}
      availability={getDriverAvailability(context.actor.driverProfileId)}
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
    />
  )
}
