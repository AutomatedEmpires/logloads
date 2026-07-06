import { HostAnalytics } from "@/components/v3"
import { getHostNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  return <HostAnalytics network={await getHostNetwork()} />
}
