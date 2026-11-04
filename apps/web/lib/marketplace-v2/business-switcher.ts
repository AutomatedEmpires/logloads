import "server-only"

import type { MarketplaceCapability } from "@logloads/contracts"
import type { BusinessSwitcherProps } from "@logloads/ui/layout"
import { unstable_rethrow } from "next/navigation"

import { V2_SWITCH_PATH, type V2ShellAccount } from "./account-menu"
import { v2SessionCapabilities } from "./home"
import { getV2SessionActor, v2SignedInWithoutPerson, type V2SessionActor } from "./v2-session"

export { V2_SWITCH_PATH }

/** Up to two letters for the switcher avatar: the first letters of the first two words, or of a single word. */
export function businessInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]) : [...(words[0] ?? "")].slice(0, 2)

  return letters.join("").toLocaleUpperCase() || "?"
}

/**
 * The shell's business switcher, from the V2 session only (`v2-session.ts`): the selected business and the
 * account's real memberships in the selected store. It links to the V2 switch route, never to the legacy
 * workspace chooser.
 */
export function v2BusinessSwitcher(actor: V2SessionActor | null): BusinessSwitcherProps | undefined {
  const organization = actor?.activeOrganization
  const membership = actor?.activeMembership

  if (!actor || !organization || !membership || actor.workspaceSelectionInvalid) {
    return undefined
  }

  return {
    current: {
      id: organization.id,
      initials: businessInitials(organization.displayName),
      kind: membership.kindLabel,
      name: organization.displayName,
      roleLabel: membership.roleLabel
    },
    memberships: actor.memberships.map((entry) => ({
      id: entry.organization.id,
      kind: entry.kindLabel,
      name: entry.organization.displayName,
      roleLabel: entry.roleLabel
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
export function v2MembershipChoices(actor: V2SessionActor): V2MembershipChoice[] {
  const currentId = actor.workspaceSelectionInvalid ? null : actor.activeOrganization?.id ?? null

  return actor.memberships.map((entry) => ({
    current: entry.organization.id === currentId,
    id: entry.organization.id,
    kind: entry.kindLabel,
    name: entry.organization.displayName,
    roleLabel: entry.roleLabel
  }))
}

/** The account menu's view of the session: the signed-in person, or a visitor. */
async function v2ShellAccount(actor: V2SessionActor | null): Promise<V2ShellAccount> {
  if (actor) {
    const { email, fullName } = actor.profile
    return { kind: "signed-in", person: email ? { email, name: fullName } : { name: fullName } }
  }

  // A sign-in without a person in the selected store yet: no person to show, but it can still sign out.
  return (await v2SignedInWithoutPerson()) ? { kind: "signed-in", person: null } : { kind: "visitor" }
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
    const actor = await getV2SessionActor()
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
