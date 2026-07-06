import { DriverEquipment } from "@/components/v3"
import { getDriverNetwork } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default function Page() {
  return <DriverEquipment network={getDriverNetwork()} />
}
