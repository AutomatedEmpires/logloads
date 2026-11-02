import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"

import "./v2.css"

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "LogLoads V2 preview"
}

export const dynamic = "force-dynamic"

export default function MarketplaceV2Layout({ children }: { children: ReactNode }) {
  if (!marketplaceV2Enabled()) {
    notFound()
  }

  return (
    <div className="v2">
      <header className="v2-top">
        <Link className="v2-brand" href="/v2/work">LogLoads</Link>
        <nav aria-label="Marketplace V2">
          <Link href="/v2/work">Find work</Link>
          <Link href="/v2/inquiries">My inquiries</Link>
          <Link href="/v2/landing/inquiries">Landing inbox</Link>
          <Link href="/v2/landing/jobs">Post jobs</Link>
        </nav>
      </header>
      <p className="v2-preview" role="note">
        Marketplace V2 development preview. Listings come from the current LogLoads data store; nothing here
        dispatches trucks, records loads or charges a fee.
      </p>
      <main className="v2-main">{children}</main>
    </div>
  )
}
