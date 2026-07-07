import { SettingsPage } from "@/components/v3"
import { getSettingsView } from "@/lib/plans"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")

  return <SettingsPage account={shellAccountFor(context)} role="host" settings={getSettingsView(context.network)} />
}
