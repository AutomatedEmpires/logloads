import { DriverToday } from "@/components/v3"
import { getDriverAvailability } from "@/lib/driver-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("driver")

  return (
    <DriverToday
      account={shellAccountFor(context)}
      availability={getDriverAvailability(context.actor.driverProfileId)}
      network={context.network}
    />
  )
}
