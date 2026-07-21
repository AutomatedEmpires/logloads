import { SupportPage } from "@/components/v3"
import { getSupportPageData } from "@/lib/support-data"

export const metadata = {
  title: "Product feedback"
}

export default async function ProductFeedbackPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const parameters = await searchParams
  const rawFrom = typeof parameters.from === "string" ? parameters.from : null
  const data = await getSupportPageData(rawFrom)

  return <SupportPage {...data} />
}
