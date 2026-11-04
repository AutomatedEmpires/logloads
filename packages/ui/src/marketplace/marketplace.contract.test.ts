import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { BREAKPOINTS } from "../tokens"

/**
 * Static checks on the marketplace components (DS-04, #147): one CSS Module per component, no inline styles,
 * "use client" only where a component owns handlers, container queries on the list or the app container at
 * token breakpoints, the "./marketplace" subpath, and no fictional design-reference data in shipped sources.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, "..", "..")
const entries = readdirSync(here)
const components = entries.filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
const modules = entries.filter((name) => name.endsWith(".module.css"))
const shipped = entries.filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "test-fixtures.ts")
const read = (name: string) => readFileSync(join(here, name), "utf8")
const css = (name: string) => read(name).replace(/\/\*[\s\S]*?\*\//g, "")

const COMPONENTS = [
  "AvailabilityStatus",
  "CompanyProfileHeader",
  "ConversationThread",
  "EquipmentCapacity",
  "EquipmentRequirement",
  "InquiryRow",
  "JobDetail",
  "JobResultList",
  "JobResultRow",
  "JobSummary",
  "LocalTime",
  "MessageComposer",
  "OperatingRegion",
  "PayFigure",
  "SponsoredIndicator",
  "VerificationIndicator"
]

describe("marketplace contract (DS-04, #147)", () => {
  it("has one component and one CSS Module per marketplace component", () => {
    expect(components.map((name) => name.replace(/\.tsx$/, "")).sort()).toEqual(COMPONENTS)
    expect(modules.map((name) => name.replace(/\.module\.css$/, "")).sort()).toEqual(COMPONENTS)
  })

  it("uses no inline styles and accepts no style prop", () => {
    for (const name of components) {
      expect(read(name), name).not.toMatch(/\bstyle=\{/)
    }
  })

  it('marks only handler-owning components "use client"', () => {
    const client = components.filter((name) => read(name).startsWith('"use client"')).sort()

    // LocalTime (UX-09, #132) owns no handler but an effect: only the browser knows the reader's time zone.
    expect(client).toEqual(["LocalTime.tsx", "MessageComposer.tsx"])
  })

  it("never renders markup from strings", () => {
    for (const name of shipped) {
      expect(read(name), name).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    }
  })

  it("measures only the ll-list or ll-app container, at token breakpoints or the row's own 620/720/740 px steps", () => {
    const allowed = { "ll-app": new Set<number>(Object.values(BREAKPOINTS)), "ll-list": new Set([620, 720, 740]) }

    for (const name of modules) {
      for (const match of css(name).matchAll(/@container\s+([^{]*?)\s*{/g)) {
        const [, container, feature, px] = /^(\S+)\s+\((min|max)-width:\s*(\d+)px\)$/.exec(match[1] as string) ?? []
        const width = feature === "max" ? Number(px) + 1 : Number(px)

        expect(Object.keys(allowed), `${name}: ${match[1]}`).toContain(container)
        expect(allowed[container as keyof typeof allowed].has(width), `${name}: ${match[1]}`).toBe(true)
      }
    }
  })

  it("makes the list the ll-list container and switches compact density at 720 px", () => {
    expect(css("JobResultList.module.css")).toMatch(/\.results\s*{[^}]*container:\s*ll-list\s*\/\s*inline-size/)
    expect(css("JobResultRow.module.css")).toMatch(/@container ll-list \(min-width: 720px\)\s*{\s*\[data-density="compact"\] \.row\s*{/)
    expect(css("JobResultList.module.css")).toMatch(/@container ll-list \(min-width: 720px\)\s*{\s*\[data-density="compact"\] \.head\s*{/)
  })

  it("keeps the row's single link stretched under independent actions", () => {
    const row = css("JobResultRow.module.css")

    expect(row).toMatch(/\.link::after\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0;/)
    expect(row).toMatch(/\.save\s*{[^}]*position:\s*relative;[^}]*z-index:\s*1;/)
    expect(read("JobResultRow.tsx")).not.toMatch(/role="(listbox|option)"/)
  })

  it('is exported only from the "./marketplace" subpath', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, string> }
    const index = read("index.ts")

    expect(manifest.exports["./marketplace"]).toBe("./src/marketplace/index.ts")
    expect(readFileSync(join(packageRoot, "src", "index.ts"), "utf8")).not.toContain("marketplace")
    for (const component of COMPONENTS) {
      expect(index).toMatch(new RegExp(`export \\{[^}]*\\b${component}\\b[^}]*\\} from "\\./${component}"`))
    }
  })

  it("ships none of the design reference's fictional businesses or verification strings (Gate 5)", () => {
    for (const name of [...shipped, "test-fixtures.ts"]) {
      expect(read(name), name).not.toMatch(/Ridgeline Hauling|Cedar Fork Logging|Business identity verified · Oct 2026/)
    }
  })
})
