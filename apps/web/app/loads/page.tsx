import { PublicLoadsPage } from "@/components/v3"
import { getPublicLoads } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function LoadsPage() {
  return <PublicLoadsPage loads={getPublicLoads()} />
}
