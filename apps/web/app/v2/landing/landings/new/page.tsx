import { notFound } from "next/navigation"

import { landingEditorPage } from "@/components/v2/landing/LandingEditor"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"

export const dynamic = "force-dynamic"

/** `/v2/landing/landings/new` (#127, UX B3): add a landing. */
export default async function NewLandingPage() {
  if (!marketplaceV2Enabled()) notFound()

  return landingEditorPage(null)
}
