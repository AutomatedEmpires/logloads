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

  const { business, capabilities } = await resolveV2Shell()

  return (
    <V2AppShell
      banner={
        <p role="note">
          Marketplace V2 development preview. Listings come from the current LogLoads data store; nothing here
          dispatches trucks, records loads or charges a fee.
        </p>
      }
      business={business}
      capabilities={capabilities}
    >
      {/* Pages not yet built from the layout components keep their v2.css styling inside the shell. */}
      <div className="v2 v2-main">{children}</div>
    </V2AppShell>
  )
}
