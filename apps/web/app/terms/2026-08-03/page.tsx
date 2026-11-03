import type { Metadata } from "next"

import { ArchivedLegalPage } from "@/components/v3"
import { termsOfService20260803 } from "@/lib/legal-archive"

// Superseded text kept for agreements accepted under it (LE-13). It stays
// reachable at this exact path but out of search results and the sitemap.
export const metadata: Metadata = {
  title: "Terms of Service — archived version effective August 3, 2026",
  description:
    "The superseded LogLoads Terms of Service effective August 3, 2026, published unchanged for agreements accepted under that version.",
  robots: { follow: true, index: false }
}

export default function Page() {
  return <ArchivedLegalPage archive={termsOfService20260803} />
}
