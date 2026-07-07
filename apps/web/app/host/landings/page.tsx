import { HostLandings } from "@/components/v3"
import { getHostLandingRecords } from "@/lib/host-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")

  return (
    <HostLandings
      account={shellAccountFor(context)}
      landings={getHostLandingRecords(context.network.activeOrganization.id)}
      network={context.network}
    />
  )
}
