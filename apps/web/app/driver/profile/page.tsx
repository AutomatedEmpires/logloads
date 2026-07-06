import { DriverProfile } from "@/components/v3"
import { getDriverNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  return <DriverProfile network={await getDriverNetwork()} />
}
