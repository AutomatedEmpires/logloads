import { FleetOpportunityDetail } from "@/components/v3"
import { getFleetOpportunityData } from "@/lib/fleet-data"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params
  const data = await getFleetOpportunityData(loadId)

  return <FleetOpportunityDetail account={data.account} load={data.load} network={data.network} options={data.options} />
}
