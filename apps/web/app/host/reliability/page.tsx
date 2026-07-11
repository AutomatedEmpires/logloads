import { PerformancePage } from "@/components/v3"
import { getHostCarrierPerformance } from "@/lib/reliability-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [context, view] = await Promise.all([getCockpitContext("host"), getHostCarrierPerformance()])

  return <PerformancePage account={shellAccountFor(context)} role="host" view={view} />
}
