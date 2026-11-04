"use client"

import type { MarketplaceCapability } from "@logloads/contracts"
import { AppShell, type BusinessSwitcherProps } from "@logloads/ui/layout"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { SignOutButton } from "@/components/v2/SignOutButton"
import { v2AccountMenuFor, type V2ShellAccount } from "@/lib/marketplace-v2/account-menu"
import { activeV2NavId, v2NavigationFor, v2WorkspaceForContext } from "@/lib/marketplace-v2/navigation"

/**
 * The V2 layout's AppShell. Capabilities are resolved on the server from the session's selected business
 * and decide which destinations appear (#124). The route layout persists across client navigations, so the
 * active destination is derived here from the current path; AppShell itself stays presentational. The account
 * menu carries the development-preview notice on every page (#124 criterion 7).
 */
export function V2AppShell({
  account,
  business,
  capabilities,
  children,
  counts
}: {
  account: V2ShellAccount
  business?: BusinessSwitcherProps
  capabilities: readonly MarketplaceCapability[] | null
  children: ReactNode
  /** Unread inquiries per navigation destination (UX-09, #132). */
  counts?: Readonly<Partial<Record<string, number>>>
}) {
  const pathname = usePathname()
  const navigation = v2NavigationFor(capabilities, counts)
  const menu = v2AccountMenuFor(account, pathname)

  return (
    <AppShell
      account={account.kind === "signed-in" ? { ...menu, action: <SignOutButton /> } : menu}
      activeNavId={activeV2NavId(pathname, navigation)}
      business={business}
      navigation={navigation}
      workspace={v2WorkspaceForContext(capabilities, pathname)}
    >
      {children}
    </AppShell>
  )
}
