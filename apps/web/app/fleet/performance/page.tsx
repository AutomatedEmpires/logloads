import { PerformancePage } from "@/components/v3"
import { getFleetPerformance } from "@/lib/reliability-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [context, view] = await Promise.all([getCockpitContext("fleet"), getFleetPerformance()])

  return <PerformancePage account={shellAccountFor(context)} role="fleet" view={view} />
}
