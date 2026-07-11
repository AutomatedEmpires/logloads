import { DriverProfile } from "@/components/v3"
import { getDriverAvailability } from "@/lib/driver-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { listSubjectVerifications } from "@/lib/verification-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("driver")

  return (
    <DriverProfile
      account={shellAccountFor(context)}
      availability={getDriverAvailability(context.actor.driverProfileId)}
      network={context.network}
      verifications={listSubjectVerifications("person", context.actor.profile.id)}
    />
  )
}
