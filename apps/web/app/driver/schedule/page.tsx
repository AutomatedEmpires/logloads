import { DriverSchedule } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"
import { isDedicatedMediaConfigured } from "@/lib/media-config"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("driver")

  return <DriverSchedule account={shellAccountFor(context)} mediaReady={isDedicatedMediaConfigured(process.env)} network={context.network} />
}
