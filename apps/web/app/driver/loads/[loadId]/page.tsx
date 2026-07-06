import { DriverLoadDetail } from "@/components/v3"
import { getDriverNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params
  return <DriverLoadDetail loadId={loadId} network={await getDriverNetwork()} />
}
