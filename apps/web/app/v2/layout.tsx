import type { Metadata } from "next"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { V2AppShell } from "@/components/v2/V2AppShell"
import { resolveV2Shell } from "@/lib/marketplace-v2/business-switcher"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"

// DS-01 (#144): the semantic token layer. Tokens apply only inside .ll-theme (the AppShell root), so legacy
// pages are unaffected. DS-02 (#145): the shared AppShell replaces the hand-rolled header.
import "@logloads/ui/tokens.css"

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "LogLoads V2 preview"
}

export const dynamic = "force-dynamic"

export default async function MarketplaceV2Layout({ children }: { children: ReactNode }) {
  if (!marketplaceV2Enabled()) {
    notFound()
  }

  const { account, business, capabilities } = await resolveV2Shell()

  // The development-preview notice is in the account menu on every page, not a banner (#124 criterion 7).
  return (
    <V2AppShell account={account} business={business} capabilities={capabilities}>
      {children}
    </V2AppShell>
  )
}
