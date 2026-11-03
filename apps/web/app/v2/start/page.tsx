import Link from "next/link"

import { NO_BUSINESS_PROFILE_REFUSAL } from "@/lib/marketplace-v2/viewer"

/**
 * `/v2/start` (#124): where a signed-in account with no business lands when V2 is enabled. Business setup
 * is not part of the preview, so this says so instead of opening the legacy onboarding cockpit.
 */
export default function StartPage() {
  return (
    <section aria-labelledby="start-title">
      <h1 id="start-title">Set up your business</h1>
      <p>{NO_BUSINESS_PROFILE_REFUSAL}</p>
      <p><Link href="/v2/work">Browse public jobs</Link></p>
    </section>
  )
}
