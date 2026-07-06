import { PublicHome } from "@/components/v3"
import { getFleetNetwork, getHostNetwork, getPublicLoads } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function HomePage() {
  return <PublicHome fleet={getFleetNetwork()} host={getHostNetwork()} loads={getPublicLoads()} />
}
