import "server-only"

import type { Organization } from "@logloads/contracts"
import type { BusinessSwitcherProps } from "@logloads/ui/layout"
import { unstable_rethrow } from "next/navigation"

import { MEMBER_ROLE_LABELS } from "../plans"
import { getSessionActor, type SessionActor } from "../session"
import { BUSINESS_SWITCH_UNAVAILABLE } from "./viewer"

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
 * memberships. There is no V2 switch route yet (#124), so `switchHref` is omitted and the switcher renders
 * as text with the standard note; it never links to the legacy workspace chooser.
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
    unavailableNote: BUSINESS_SWITCH_UNAVAILABLE
  }
}

/**
 * Resolves the switcher for the V2 layout. A visitor without a session (public pages) or without a usable
 * business gets none. A failure to read the session leaves the chrome without a switcher; the page's own
 * session and data reads still surface that failure.
 */
export async function resolveV2BusinessSwitcher(): Promise<BusinessSwitcherProps | undefined> {
  try {
    return v2BusinessSwitcher(await getSessionActor())
  } catch (error) {
    unstable_rethrow(error)
    return undefined
  }
}
