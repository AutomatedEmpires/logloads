import "server-only"

import type { MarketplaceCapability, Organization } from "@logloads/contracts"
import type { BusinessSwitcherProps } from "@logloads/ui/layout"
import { unstable_rethrow } from "next/navigation"

import { MEMBER_ROLE_LABELS } from "../plans"
import { getClerkUserId, getSessionActor, type SessionActor } from "../session"
import { V2_SWITCH_PATH, type V2ShellAccount } from "./account-menu"
import { v2SessionCapabilities } from "./home"

export { V2_SWITCH_PATH }

/** V2 wording for an organization's kind; hauling covers both carrier and fleet organizations. */
const BUSINESS_KIND_LABELS = {
  carrier: "Hauling business",
  destination: "Destination facility",
  fleet: "Hauling business",
  landing_source: "Landing business",
  platform: "LogLoads platform"
} satisfies Record<Organization["type"], string>

/** Up to two letters for the switcher avatar: the first letters of the first two words, or of a single word. */
export function businessInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]) : [...(words[0] ?? "")].slice(0, 2)

  return letters.join("").toLocaleUpperCase() || "?"
}

/**
 * The shell's business switcher, from the session only: the selected business and the account's real
 * memberships. It links to the V2 switch route, never to the legacy workspace chooser.
 */
export function v2BusinessSwitcher(actor: SessionActor | null): BusinessSwitcherProps | undefined {
  const organization = actor?.activeOrganization
  const membership = actor?.activeMembership

  if (!actor || !organization || !membership || actor.workspaceSelectionInvalid) {
    return undefined
  }

  return {
    current: {
      id: organization.id,
      initials: businessInitials(organization.displayName),
      kind: BUSINESS_KIND_LABELS[organization.type],
      name: organization.displayName,
      roleLabel: MEMBER_ROLE_LABELS[membership.role]
    },
    memberships: actor.memberships.map((entry) => ({
      id: entry.organization.id,
      kind: BUSINESS_KIND_LABELS[entry.organization.type],
      name: entry.organization.displayName,
      roleLabel: MEMBER_ROLE_LABELS[entry.membership.role]
    })),
    switchHref: V2_SWITCH_PATH
  }
}

export interface V2MembershipChoice {
  id: string
  name: string
  kind: string
  roleLabel: string
  current: boolean
}

/** The account's real memberships for the switch page, with the session's current selection marked. */
export function v2MembershipChoices(actor: SessionActor): V2MembershipChoice[] {
  const currentId = actor.workspaceSelectionInvalid ? null : actor.activeOrganization?.id ?? null

  return actor.memberships.map((entry) => ({
    current: entry.organization.id === currentId,
    id: entry.organization.id,
    kind: BUSINESS_KIND_LABELS[entry.organization.type],
    name: entry.organization.displayName,
    roleLabel: MEMBER_ROLE_LABELS[entry.membership.role]
  }))
}

/** The account menu's view of the session: the signed-in person, or a visitor. */
async function v2ShellAccount(actor: SessionActor | null): Promise<V2ShellAccount> {
  if (actor) {
    const { email, fullName } = actor.profile
    return { kind: "signed-in", person: email ? { email, name: fullName } : { name: fullName } }
  }

  // A Clerk sign-in without a LogLoads profile yet: no person to show, but it can still sign out.
  return (await getClerkUserId()) ? { kind: "signed-in", person: null } : { kind: "visitor" }
}

/**
 * Resolves the V2 layout's chrome from the session: the business switcher and the selected business's
 * capabilities, which decide the navigation (#124), and the account menu's person. A visitor without a
 * session (public pages) or without a usable business gets no switcher or capabilities. A failure to read
 * the session leaves the chrome at its public form; the page's own session and data reads still surface
 * that failure.
 */
export async function resolveV2Shell(): Promise<{
  account: V2ShellAccount
  business: BusinessSwitcherProps | undefined
  capabilities: MarketplaceCapability[] | null
}> {
  try {
    const actor = await getSessionActor()
    const business = v2BusinessSwitcher(actor)

    return {
      account: await v2ShellAccount(actor),
      business,
      capabilities: business ? await v2SessionCapabilities(actor) : null
    }
  } catch (error) {
    unstable_rethrow(error)
    return { account: { kind: "visitor" }, business: undefined, capabilities: null }
  }
}
