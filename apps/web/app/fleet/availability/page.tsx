import { FleetAvailability } from "@/components/v3"
import { getFleetCockpitData } from "@/lib/fleet-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getFleetCockpitData()

  return <FleetAvailability account={data.account} combinations={data.combinations} network={data.network} />
}
