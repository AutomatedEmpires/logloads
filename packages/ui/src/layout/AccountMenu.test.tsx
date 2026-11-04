import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AccountMenu } from "./AccountMenu"
import { GlobalNavigation } from "./GlobalNavigation"
import type { AccountMenuProps, BusinessSwitcherProps } from "./types"

/**
 * Markup only: the package's tests run in Node without a DOM. Opening, Escape with focus return, closing on an
 * outside press or focus move, and the axe audit of the open panel are checked in the browser by the DS-05 suite
 * (apps/web/tests/design-system.spec.ts, "account menu").
 */

const PREVIEW: AccountMenuProps["note"] = { body: <p>Nothing here dispatches trucks.</p>, title: "Development preview" }

const MEMBER: AccountMenuProps = {
  action: <button type="button">Sign out</button>,
  links: [{ href: "/v2/switch", id: "switch", label: "Switch business" }],
  note: PREVIEW,
  person: { email: "jamie@example.test", name: "Jamie Pine" },
  tag: "Preview"
}

const render = (props: AccountMenuProps) => renderToStaticMarkup(<AccountMenu {...props} />)

/** The text a screen reader announces for the trigger: its content with tags removed (Phosphor glyphs are aria-hidden). */
function triggerName(html: string): string {
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? ""
  return summary.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "")
}

describe("AccountMenu", () => {
  it("is a closed native disclosure, not an ARIA menu", () => {
    const html = render(MEMBER)

    expect(html).toMatch(/^<details class="[^"]*">/)
    expect(html).not.toMatch(/<details[^>]* open/)
    expect(html).toMatch(/<summary [^>]*>/)
    expect(html).not.toMatch(/role="menu(item)?"|aria-haspopup/)
  })

  it("names its trigger with the visible word and tag (WCAG 2.5.3 Label in Name)", () => {
    expect(triggerName(render(MEMBER))).toBe("Account, Preview")
    expect(triggerName(render({ ...MEMBER, tag: undefined }))).toBe("Account")
    expect(render(MEMBER)).not.toMatch(/<summary[^>]*aria-label/)
  })

  it("shows the person, the links in order, the note under its title and the app's action", () => {
    const html = render({ ...MEMBER, links: [...MEMBER.links!, { href: "/help", id: "help", label: "Help" }] })
    const order = ["Jamie Pine", "jamie@example.test", 'href="/v2/switch"', 'href="/help"', "Development preview", "Nothing here dispatches trucks.", "Sign out"]

    expect(order.map((text) => html.indexOf(text)).every((index, position, all) => index > -1 && (position === 0 || index > all[position - 1]!))).toBe(true)
    expect(html).toMatch(/<a [^>]*href="\/v2\/switch"[^>]*>Switch business<\/a>/)
  })

  it("labels the note by its visible title", () => {
    const html = render(MEMBER)
    const note = /<div aria-labelledby="([^"]+)"[^>]*role="note"/.exec(html)
    const titleId = /<p [^>]*id="([^"]+)"[^>]*>Development preview<\/p>/.exec(html)

    expect(note?.[1]).toBeTruthy()
    expect(note?.[1]).toBe(titleId?.[1])
  })

  it("renders a visitor's menu without a person or an action", () => {
    const html = render({ links: [{ href: "/sign-in", id: "sign-in", label: "Sign in" }], note: PREVIEW, tag: "Preview" })

    expect(html).toMatch(/<a [^>]*href="\/sign-in"[^>]*>Sign in<\/a>/)
    expect(html).toContain("Development preview")
    expect(html).not.toContain("<button")
  })

  it("puts no inline styles on its own elements", () => {
    const tags = [...render(MEMBER).matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/g)].filter((match) => !["svg", "path"].includes(match[1] as string))

    expect(tags.filter((match) => /\sstyle=/.test(match[0]))).toEqual([])
  })
})

describe("GlobalNavigation with an account menu", () => {
  const business: BusinessSwitcherProps = {
    current: { id: "org-1", initials: "KT", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
    memberships: [{ id: "org-1", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" }],
    switchHref: "/v2/switch"
  }

  it("places the account menu after the business switcher, at the end of the bar", () => {
    const html = renderToStaticMarkup(<GlobalNavigation account={MEMBER} activeId="" business={business} items={[]} />)

    expect(html.indexOf("Acting as")).toBeGreaterThan(-1)
    expect(html.indexOf("<details")).toBeGreaterThan(html.indexOf("Acting as"))
  })

  it("renders the account menu without a business, and neither when both are absent", () => {
    expect(renderToStaticMarkup(<GlobalNavigation account={MEMBER} activeId="" items={[]} />)).toContain("<details")
    expect(renderToStaticMarkup(<GlobalNavigation activeId="" items={[]} />)).not.toContain("<details")
  })
})
