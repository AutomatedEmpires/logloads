import type { Metadata } from "next"

import { openOneTapPage } from "../open"
import { OneTapScreen } from "../screen"

export const dynamic = "force-dynamic"

interface OneTapPageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ notice?: string | string[] }>
}

export async function generateMetadata({ params }: OneTapPageProps): Promise<Metadata> {
  const { token } = await params
  const { model } = openOneTapPage(token, undefined)

  return {
    referrer: "no-referrer",
    robots: { follow: false, index: false },
    title: `${model.title} — LogLoads`
  }
}

export default async function OneTapPage({ params, searchParams }: OneTapPageProps) {
  const { token } = await params
  const query = await searchParams
  const opened = openOneTapPage(token, query.notice)

  return <OneTapScreen model={opened.model} pressHref={opened.pressHref} />
}
