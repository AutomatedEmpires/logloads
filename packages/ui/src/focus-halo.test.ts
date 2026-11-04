import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The app's legacy global `:focus-visible` rule (apps/web/app/globals.css) adds a 5 px box-shadow halo to every
 * focused element. Inside the design system the ring is the outline alone (06_DESIGN_SYSTEM.md §7), so every
 * focusable control's own focus rule resets the shadow, whatever the stylesheet order. DS-05 (#148) checks the
 * rendered rings on the migrated pages; this keeps the reset in the source for controls no page shows yet.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = (path: string) => readFileSync(join(here, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

/** The declarations of every rule whose selector list includes `selector` exactly. */
function declarationsFor(path: string, selector: string): string[] {
  const found: string[] = []

  for (const match of source(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] as string).split(",").map((part) => part.trim())
    if (selectors.includes(selector)) found.push(match[2] as string)
  }
  return found
}

const RESETS: ReadonlyArray<readonly [string, string]> = [
  ["layout/AccountMenu.module.css", ".trigger:focus-visible"],
  ["layout/AccountMenu.module.css", ".link:focus-visible"],
  ["layout/AppShell.module.css", ".root :focus-visible"],
  ["layout/BusinessSwitcher.module.css", ".switcher:focus-visible"],
  ["layout/DetailPanel.module.css", ".close:focus-visible"],
  ["layout/FilterBar.module.css", ".filter:focus-visible"],
  ["layout/FilterBar.module.css", ".clear:focus-visible"],
  ["layout/GlobalNavigation.module.css", ".brand:focus-visible"],
  ["layout/GlobalNavigation.module.css", ".link:focus-visible"],
  ["layout/PageHeader.module.css", ".crumbs a:focus-visible"],
  ["layout/ResponsiveNavigation.module.css", ".tab:focus-visible"],
  ["layout/SearchToolbar.module.css", ".input:focus-visible"],
  ["layout/SearchToolbar.module.css", ".submit:focus-visible"],
  ["layout/SearchToolbar.module.css", ".summary:focus-visible"],
  ["marketplace/InquiryRow.module.css", ".link:focus-visible"],
  ["marketplace/JobDetail.module.css", ".more > .summary:focus-visible"],
  ["marketplace/JobResultRow.module.css", ".link:focus-visible"],
  ["marketplace/MessageComposer.module.css", ".chip:focus-visible"],
  ["marketplace/MessageComposer.module.css", ".input:focus-visible"],
  ["primitives/Button.module.css", ".button:focus-visible"],
  ["primitives/Checkbox.module.css", ".input:focus-visible"],
  ["primitives/ChoiceCard.module.css", ".input:focus-visible"],
  ["primitives/Dialog.module.css", ".dialog :focus-visible"],
  ["primitives/FormField.module.css", ".control:focus-visible"],
  ["primitives/NumberStepper.module.css", ".step:focus-visible"],
  ["primitives/SegmentedControl.module.css", ".option:focus-visible"],
  ["primitives/Tabs.module.css", ".tab:focus-visible"]
]

describe("focus rings without the legacy halo", () => {
  it.each(RESETS)("%s %s resets box-shadow", (path, selector) => {
    const rules = declarationsFor(path, selector)

    expect(rules.length, `${path}: no rule for ${selector}`).toBeGreaterThan(0)
    expect(rules.some((declarations) => /box-shadow:\s*none\s*(;|$)/.test(declarations.trim())), `${path} ${selector}`).toBe(true)
  })

  it("keeps the DetailPanel's elevation when the panel itself is focused", () => {
    expect(declarationsFor("layout/DetailPanel.module.css", '[data-layout="list-detail"] > .panel:focus-visible').join("")).toMatch(
      /box-shadow:\s*var\(--ll-shadow-md\)/
    )
  })
})
