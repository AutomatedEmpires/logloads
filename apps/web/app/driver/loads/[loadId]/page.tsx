import { DriverLoadDetail } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ loadId: string }> }) {
  const { loadId } = await params
  const context = await getCockpitContext("driver")

  return <DriverLoadDetail account={shellAccountFor(context)} loadId={loadId} network={context.network} />
}
