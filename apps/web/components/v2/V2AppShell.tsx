"use client"

import { AppShell, type BusinessSwitcherProps } from "@logloads/ui/layout"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { activeV2NavId, V2_NAVIGATION, v2WorkspaceFor } from "@/lib/marketplace-v2/navigation"

/**
 * The V2 layout's AppShell. The route layout persists across client navigations, so the active destination
 * is derived here from the current path; AppShell itself stays presentational.
 */
export function V2AppShell({
  banner,
  business,
  children
}: {
  banner: ReactNode
  business?: BusinessSwitcherProps
  children: ReactNode
}) {
  const pathname = usePathname()

  return (
    <AppShell
      activeNavId={activeV2NavId(pathname)}
      banner={banner}
      business={business}
      navigation={[...V2_NAVIGATION]}
      workspace={v2WorkspaceFor(pathname)}
    >
      {children}
    </AppShell>
  )
}
