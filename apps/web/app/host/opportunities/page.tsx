import { HostOpportunities } from "@/components/v3"
import { getHostLoadPlanFacts, getHostPublishingOptions } from "@/lib/host-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const organizationId = context.network.activeOrganization.id

  return (
    <HostOpportunities
      account={shellAccountFor(context)}
      network={context.network}
      options={getHostPublishingOptions(organizationId)}
      planFacts={getHostLoadPlanFacts(organizationId)}
    />
  )
}
