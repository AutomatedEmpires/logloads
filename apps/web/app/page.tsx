import { PublicHome } from "@/components/v3"
import { getPublicHomeSnapshot, getPublicLoads } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function HomePage() {
  return <PublicHome loads={getPublicLoads()} snapshot={getPublicHomeSnapshot()} />
}
