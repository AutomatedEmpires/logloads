import { FleetDrivers } from "@/components/v3"
import { getFleetCockpitData } from "@/lib/fleet-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getFleetCockpitData()

  return <FleetDrivers account={data.account} drivers={data.drivers} network={data.network} />
}
