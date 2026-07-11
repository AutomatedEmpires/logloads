import { FleetTrucks } from "@/components/v3"
import { getFleetCockpitData } from "@/lib/fleet-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getFleetCockpitData()

  return <FleetTrucks account={data.account} driverOptions={data.driverOptions} network={data.network} trucks={data.trucks} />
}
