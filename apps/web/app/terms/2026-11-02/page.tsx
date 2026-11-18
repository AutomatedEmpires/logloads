import type { Metadata } from "next"

import { ArchivedLegalPage } from "@/components/v3"
import { termsOfService20261102 } from "@/lib/legal-archive"

// Superseded text kept for anyone who agreed to it while it was current (LE-13, #329). It stays reachable at this
// exact path but out of search results and the sitemap.
export const metadata: Metadata = {
  title: "Terms of Service — archived version as changed on November 2, 2026",
  description:
    "The superseded LogLoads Terms of Service as changed on November 2, 2026, published unchanged for agreements accepted under that version.",
  robots: { follow: true, index: false }
}

export default function Page() {
  return <ArchivedLegalPage archive={termsOfService20261102} />
}
