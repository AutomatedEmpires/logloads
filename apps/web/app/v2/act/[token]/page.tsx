import type { Metadata } from "next"

import { inspectOneTap, productionRuntime } from "../perform"
import { OneTapScreen } from "../screen"
import { oneTapPressPath } from "../token"
import { oneTapModel, oneTapNotice } from "../view"

export const dynamic = "force-dynamic"

interface OneTapPageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ notice?: string | string[] }>
}

/** A read of a signed link. The store is not called. The press lives at `.../press`. */
export function openOneTapPage(token: string, notice: string | string[] | undefined) {
  const model = oneTapModel(inspectOneTap(token, productionRuntime()), oneTapNotice(notice))

  return {
    model,
    pressHref: model.kind === "ready" ? oneTapPressPath(token) : ""
  }
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
