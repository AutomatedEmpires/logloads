import { SettingsPage } from "@/components/v3"
import { getSettingsView } from "@/lib/plans"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("fleet")

  return <SettingsPage account={shellAccountFor(context)} role="fleet" settings={getSettingsView(context.network)} />
}
