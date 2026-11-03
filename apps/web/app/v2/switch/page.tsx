import Link from "next/link"

import { v2MembershipChoices } from "@/lib/marketplace-v2/business-switcher"
import { switchV2BusinessAction } from "@/lib/marketplace-v2/switch-actions"
import { resolveV2Actor } from "@/lib/marketplace-v2/viewer"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** `/v2/switch` (#124): the account's real memberships only. Choosing one re-checks it on the server. */
export default async function SwitchBusinessPage({ searchParams }: { searchParams: SearchParams }) {
  const [resolved, params] = await Promise.all([resolveV2Actor("/v2/switch"), searchParams])

  if (!resolved.ok) {
    return (
      <section>
        <h1>Switch business</h1>
        <p className="v2-banner">{resolved.refusal}</p>
        <p><Link href="/v2/work">Browse public jobs</Link></p>
      </section>
    )
  }

  const choices = v2MembershipChoices(resolved.actor)

  return (
    <section aria-labelledby="switch-title">
      <h1 id="switch-title">Switch business</h1>
      <p className="v2-muted">Choose the business you are acting for. You only see businesses you are a member of.</p>
      {params.unavailable ? (
        <p className="v2-banner" role="alert">That business is not available to your account right now. Choose another one.</p>
      ) : null}
      {choices.length === 0 ? (
        <p>Your sign-in is not linked to a LogLoads business yet. Setting up a business is not available in this preview yet.</p>
      ) : (
        <ul className="v2-list">
          {choices.map((choice) => (
            <li className="v2-card" key={choice.id}>
              <p><strong>{choice.name}</strong></p>
              <p className="v2-muted">{choice.kind} · {choice.roleLabel}</p>
              {choice.current ? (
                <p><span className="v2-tag v2-tag--ok">Acting as this business</span></p>
              ) : (
                <form action={switchV2BusinessAction}>
                  <input name="organizationId" type="hidden" value={choice.id} />
                  <button type="submit">Act as {choice.name}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
