import { MessagesPage } from "@/components/v3"
import { getMessagesData } from "@/lib/messages-data"
import { getCockpitContext, shellAccountFor } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const { thread } = await searchParams
  const context = await getCockpitContext("host")
  const data = await getMessagesData("host", thread ?? null)

  return <MessagesPage account={shellAccountFor(context)} data={data} network={context.network} role="host" />
}
