import Link from "next/link"
import type { ComponentProps } from "react"

import { prefetchFor } from "@/lib/link-prefetch"

type AppLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">

/**
 * The link the cockpit and legacy pages use instead of `next/link` (#153, #159; enforced in `apps/web/.eslintrc.json`).
 *
 * It turns prefetch off for every page rendered per request and keeps it for statically prerendered pages. See
 * `lib/link-prefetch.ts` for why: in Next 15.5 a click from a partial prefetch can leave the navigation uncommitted.
 * `prefetch` is not a prop, so a call site cannot opt back into the broken path.
 */
export function AppLink(props: AppLinkProps) {
  return <Link {...props} prefetch={prefetchFor(props.href)} />
}
