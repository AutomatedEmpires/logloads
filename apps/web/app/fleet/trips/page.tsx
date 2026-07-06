import { FleetTrips } from "@/components/v3"
import { getFleetNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function Page() {
  return <FleetTrips network={getFleetNetwork()} />
}
