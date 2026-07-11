import { FleetCommand } from "@/components/v3"
import { getFleetCockpitData } from "@/lib/fleet-data"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getFleetCockpitData()

  return <FleetCommand account={data.account} dispatchPlan={data.dispatchPlan} network={data.network} />
}
