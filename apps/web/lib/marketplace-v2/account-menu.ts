import type { AccountMenuProps } from "@logloads/ui/layout"

/** The V2 business switch route (#124): it lists the account's real memberships and revalidates on the server. */
export const V2_SWITCH_PATH = "/v2/switch"

/** Who the V2 shell shows the account menu to, resolved from the session on the server. */
export type V2ShellAccount =
  | { kind: "visitor" }
  /** `person` is null for a sign-in that has no LogLoads profile yet: it can still sign out. */
  | { kind: "signed-in"; person: { name: string; email?: string } | null }

/**
 * The development-preview notice (#124 criterion 7). It used to be a banner on every V2 page; it now lives in the
 * account menu, which is on every V2 page, and the menu's trigger carries V2_PREVIEW_TAG so it stays discoverable.
 */
export const V2_PREVIEW_NOTE = {
  body: "Listings come from the current LogLoads data store; nothing here dispatches trucks, records loads or charges a fee.",
  title: "Marketplace V2 development preview"
} as const

export const V2_PREVIEW_TAG = "Preview"

/** A V2 path to come back to after signing in; anything else (or nothing) signs in to the account's V2 home. */
function signInHref(pathname: string | null): string {
  return pathname && (pathname === "/v2" || pathname.startsWith("/v2/")) ? `/sign-in?next=${encodeURIComponent(pathname)}` : "/sign-in"
}

/**
 * The account menu for the V2 shell, without the app-supplied action (the sign-out control). A member gets
 * "Switch business", which works even when the selected business is no longer available and the business name
 * is not shown; a visitor gets "Sign in" back to the current page. Everyone gets the preview notice.
 */
export function v2AccountMenuFor(account: V2ShellAccount, pathname: string | null): Omit<AccountMenuProps, "action"> {
  const preview = { note: { body: V2_PREVIEW_NOTE.body, title: V2_PREVIEW_NOTE.title }, tag: V2_PREVIEW_TAG }

  if (account.kind === "visitor") {
    return { ...preview, links: [{ href: signInHref(pathname), id: "sign-in", label: "Sign in" }] }
  }

  if (!account.person) {
    return preview
  }

  return {
    ...preview,
    links: [{ href: V2_SWITCH_PATH, id: "switch", label: "Switch business" }],
    person: account.person.email ? { email: account.person.email, name: account.person.name } : { name: account.person.name }
  }
}
