import { notFound } from "next/navigation"

import { landingEditorPage } from "@/components/v2/landing/LandingEditor"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"

export const dynamic = "force-dynamic"

/** `/v2/landing/landings/[landingId]` (#127): one of the business's own landings, with its private half for its team. */
export default async function EditLandingPage({ params }: { params: Promise<{ landingId: string }> }) {
  if (!marketplaceV2Enabled()) notFound()

  const { landingId } = await params
  return landingEditorPage(landingId)
}
