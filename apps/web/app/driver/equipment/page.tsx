import { DriverEquipment } from "@/components/v3"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("driver")

  return <DriverEquipment account={shellAccountFor(context)} network={context.network} />
}
