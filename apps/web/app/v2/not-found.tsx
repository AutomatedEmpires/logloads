import Link from "next/link"

/**
 * A missing V2 job or page stays inside the V2 shell. Without this boundary `notFound()` falls through to
 * the root not-found page, whose legacy public header offers signed-in users the legacy workspace chooser.
 */
export default function MarketplaceV2NotFound() {
  return (
    <section className="v2-empty">
      <h1>This page is not available</h1>
      <p>The job may have closed or been removed, or the link may be incomplete.</p>
      <p><Link href="/v2/work">Find work</Link></p>
    </section>
  )
}
