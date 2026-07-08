import { AssistantPage } from "@/components/v3"
import { assistantInitialData, buildAssistantGrounding } from "@/lib/assistant-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page() {
  const context = await getCockpitContext("host")
  const grounding = buildAssistantGrounding(context.network, "host", context.actor.profile.fullName)
  const initial = assistantInitialData(grounding)

  return <AssistantPage account={shellAccountFor(context)} intro={initial.intro} role="host" suggestions={initial.suggestions} />
}
