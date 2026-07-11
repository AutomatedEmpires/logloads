import { PublicHome } from "@/components/v3"
import { getPublicHomeSnapshot, getPublicLoads } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const [loads, snapshot] = await Promise.all([getPublicLoads(), getPublicHomeSnapshot()])

  return <PublicHome loads={loads} snapshot={snapshot} />
}
