import { notFound } from "next/navigation"

import { PublicLoadDetail } from "@/components/v3"
import { findPublicLoad } from "@/lib/v3"

export const dynamic = "force-dynamic"

export default async function LoadDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const load = findPublicLoad(slug)

  if (!load) {
    notFound()
  }

  return <PublicLoadDetail load={load} />
}
