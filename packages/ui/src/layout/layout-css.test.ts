import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { BREAKPOINTS } from "../tokens"

/**
 * Static checks on the layout CSS Modules (DS-02, #145): container-query breakpoints come from tokens
 * BREAKPOINTS (plus the spec's 1024 px split), every query measures the AppShell's "ll-app" container,
 * the navigation and header surfaces are white, and the bottom tabs respect the safe area.
 */

const here = dirname(fileURLToPath(import.meta.url))
const modules = readdirSync(here).filter((name) => name.endsWith(".module.css"))
const source = (name: string) => readFileSync(join(here, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

/** Every `@container ll-app (<feature>: <px>px) { … }` block in a module, joined. */
function containerBlock(name: string, feature: "min-width" | "max-width", px: number): string {
  const css = source(name)
  const query = `@container ll-app (${feature}: ${px}px)`
  const blocks: string[] = []

  for (let start = css.indexOf(query); start !== -1; start = css.indexOf(query, start + query.length)) {
    let depth = 0
    for (let index = css.indexOf("{", start); index < css.length; index += 1) {
      if (css[index] === "{") depth += 1
      if (css[index] === "}" && --depth === 0) {
        blocks.push(css.slice(start, index + 1))
        break
      }
    }
  }
  return blocks.join("\n")
}

/** Declarations of a top-level rule whose selector is exactly `selector`. */
function rule(name: string, selector: string): string {
  const match = new RegExp(`(?:^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*{([^}]*)}`).exec(source(name))
  return match?.[1] ?? ""
}

describe("layout CSS Modules", () => {
  it("has one module per layout component", () => {
    expect(modules.sort()).toEqual([
      "AccountMenu.module.css",
      "AppShell.module.css",
      "BusinessSwitcher.module.css",
      "ContentGrid.module.css",
      "DetailPanel.module.css",
      "FilterBar.module.css",
      "GlobalNavigation.module.css",
      "PageActions.module.css",
      "PageContainer.module.css",
      "PageHeader.module.css",
      "ResponsiveNavigation.module.css",
      "SearchToolbar.module.css",
      "Section.module.css"
    ])
  })

  it("measures only the ll-app container, at token breakpoints or the 1024 px split", () => {
    const allowed = new Set<number>([...Object.values(BREAKPOINTS), 1024])

    for (const name of modules) {
      for (const match of source(name).matchAll(/@container\s+([^{]*?)\s*{/g)) {
        const query = match[1] as string
        const [, container, feature, px] = /^(\S+)\s+\((min|max)-width:\s*(\d+)px\)$/.exec(query) ?? []

        expect(container, `${name}: ${query}`).toBe("ll-app")
        expect(allowed.has(feature === "max" ? Number(px) + 1 : Number(px)), `${name}: ${query}`).toBe(true)
      }
    }
  })

  it("declares the ll-app inline-size container on the AppShell root", () => {
    expect(rule("AppShell.module.css", ".root")).toMatch(/container:\s*ll-app\s*\/\s*inline-size/)
  })

  it("switches top navigation and bottom tabs at bp-lg (960)", () => {
    expect(BREAKPOINTS.lg).toBe(960)
    expect(rule("GlobalNavigation.module.css", ".links")).toMatch(/display:\s*none/)
    expect(containerBlock("GlobalNavigation.module.css", "min-width", 960)).toMatch(/\.links\s*{\s*display:\s*flex/)
    expect(containerBlock("ResponsiveNavigation.module.css", "min-width", 960)).toMatch(/\.tabs\s*{\s*display:\s*none/)
  })

  it("opens the DetailPanel at bp-xl (400 px) and widens it at bp-2xl (432 px)", () => {
    expect([BREAKPOINTS.xl, BREAKPOINTS.xxl]).toEqual([1200, 1400])
    expect(rule("DetailPanel.module.css", ".panel")).toMatch(/display:\s*none/)
    expect(containerBlock("DetailPanel.module.css", "min-width", 1200)).toMatch(/\[data-layout="list-detail"\]\[data-detail="open"\] > \.panel\s*{\s*display:\s*block/)
    expect(containerBlock("ContentGrid.module.css", "min-width", 1200)).toMatch(/\[data-layout="list-detail"\]\[data-detail="open"\]\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\) var\(--ll-panel-width\)/)
    expect(containerBlock("ContentGrid.module.css", "min-width", 1400)).toMatch(/var\(--ll-panel-width-wide\)/)
  })

  it("splits list and conversation at 1024 px", () => {
    expect(containerBlock("ContentGrid.module.css", "min-width", 1024)).toMatch(/\[data-layout="split"\]\s*{\s*grid-template-columns:\s*var\(--ll-list-width\) minmax\(0, 1fr\)/)
  })

  it("keeps navigation and page-header surfaces white: no dark bands", () => {
    for (const [name, selector] of [
      ["GlobalNavigation.module.css", ".nav"],
      ["ResponsiveNavigation.module.css", ".tabs"],
      ["PageHeader.module.css", ".header"],
      ["FilterBar.module.css", ".bar"]
    ] as const) {
      expect(rule(name, selector), `${name} ${selector}`).toMatch(/background:\s*var\(--ll-color-surface\)/)
    }
  })

  it("pads the bottom tabs for the device safe area", () => {
    expect(rule("ResponsiveNavigation.module.css", ".tabs")).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/)
  })
})
