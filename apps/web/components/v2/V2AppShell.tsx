"use client"

import type { MarketplaceCapability } from "@logloads/contracts"
import { AppShell, type BusinessSwitcherProps } from "@logloads/ui/layout"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { activeV2NavId, v2NavigationFor, v2WorkspaceForContext } from "@/lib/marketplace-v2/navigation"

/**
 * The V2 layout's AppShell. Capabilities are resolved on the server from the session's selected business
 * and decide which destinations appear (#124). The route layout persists across client navigations, so the
 * active destination is derived here from the current path; AppShell itself stays presentational.
 */
export function V2AppShell({
  banner,
  business,
  capabilities,
  children
}: {
  banner: ReactNode
  business?: BusinessSwitcherProps
  capabilities: readonly MarketplaceCapability[] | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const navigation = v2NavigationFor(capabilities)

  return (
    <AppShell
      activeNavId={activeV2NavId(pathname, navigation)}
      banner={banner}
      business={business}
      navigation={navigation}
      workspace={v2WorkspaceForContext(capabilities, pathname)}
    >
      {children}
    </AppShell>
  )
}
