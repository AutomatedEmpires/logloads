import { HostCommand } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")

  return <HostCommand account={shellAccountFor(context)} network={context.network} />
}
