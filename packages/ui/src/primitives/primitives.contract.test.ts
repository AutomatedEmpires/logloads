import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, "..", "..")
const read = (path: string) => readFileSync(join(here, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

function files(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return entry.name.endsWith(suffix) ? [path] : []
  })
}

const components = files(here, ".tsx").filter((path) => !path.endsWith(".test.tsx"))
const tokens = readFileSync(join(here, "..", "tokens", "tokens.css"), "utf8")

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no rule ${selector}`)
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
}

describe("primitives contract (DS-03, #146)", () => {
  it("sizes buttons at 36, 44 and 48 px through the component tokens", () => {
    const css = read("Button.module.css")

    expect(rule(css, ".button")).toContain("height: var(--ll-c-button-h-md)")
    expect(rule(css, '.button[data-size="sm"]')).toContain("height: var(--ll-c-button-h-sm)")
    expect(rule(css, '.button[data-size="lg"]')).toContain("height: var(--ll-c-button-h-lg)")
    expect(tokens).toMatch(/--ll-c-button-h-sm:\s*36px;/)
    expect(tokens).toMatch(/--ll-c-button-h-md:\s*44px;/)
    expect(tokens).toMatch(/--ll-c-button-h-lg:\s*48px;/)
    expect(tokens).toMatch(/--ll-c-field-h:\s*44px;/)
  })

  it.each([
    ["Button.module.css", '.button[data-variant="secondary"]'],
    ["FormField.module.css", ".control"],
    ["NumberStepper.module.css", ".stepper"],
    ["SegmentedControl.module.css", ".group"],
    ["Tabs.module.css", '.tabs[data-variant="segmented"]'],
    ["ChoiceCard.module.css", ".choice"]
  ])("outlines the %s control with --ll-color-control-border (3.3:1)", (file, selector) => {
    expect(rule(read(file), selector)).toMatch(/border(-color)?:[^;]*var\(--ll-color-control-border\)/)
  })

  it("takes target sizes from --ll-target-*", () => {
    expect(rule(read("Button.module.css"), ".button")).toContain("min-width: var(--ll-target-min)")
    expect(rule(read("Tabs.module.css"), ".tab")).toContain("min-height: var(--ll-target-min)")
    expect(rule(read("Checkbox.module.css"), ".check")).toContain("min-height: var(--ll-target-touch)")
  })

  it("uses no inline styles and accepts no style prop", () => {
    for (const path of components) {
      expect(readFileSync(path, "utf8"), relative(here, path)).not.toMatch(/\bstyle=\{/)
    }
  })

  it('marks only stateful or handler-owning components "use client"', () => {
    const client = components
      .filter((path) => readFileSync(path, "utf8").startsWith('"use client"'))
      .map((path) => relative(here, path).replace(/\\/g, "/"))
      .sort()

    expect(client).toEqual(["Checkbox.tsx", "ChoiceCard.tsx", "Dialog.tsx", "NumberStepper.tsx", "SegmentedControl.tsx", "TabList.tsx"])
  })

  it('is exported only from the "./primitives" subpath', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, string> }

    expect(manifest.exports["./primitives"]).toBe("./src/primitives/index.ts")
    expect(readFileSync(join(packageRoot, "src", "index.ts"), "utf8")).not.toContain("primitives")
  })
})
