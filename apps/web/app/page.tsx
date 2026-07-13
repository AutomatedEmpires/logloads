import { PublicHome } from "@/components/v3"
import { getPublicLoads } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const loads = await getPublicLoads()

  return <PublicHome loads={loads} />
}
