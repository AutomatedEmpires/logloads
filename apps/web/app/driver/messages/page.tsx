import { MessagesPage } from "@/components/v3"
import { getMessagesData } from "@/lib/messages-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const { thread } = await searchParams
  const context = await getCockpitContext("driver")
  const data = await getMessagesData("driver", thread ?? null)

  return <MessagesPage account={shellAccountFor(context)} data={data} network={context.network} role="driver" />
}
