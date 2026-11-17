import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { COLOR_TOKENS, CONTRAST_PAIRS, KEY_FACT_PAIRS, NON_TEXT_PAIRS } from "./index"

const here = dirname(fileURLToPath(import.meta.url))
const uiSource = join(here, "..")
const css = readFileSync(join(here, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

/** The declarations of the base `:where(.ll-theme) { … }` block; overrides (density, motion, forced colours) are excluded. */
function baseDeclarations(): Map<string, string> {
  const open = css.indexOf("{", css.indexOf(":where(.ll-theme) {"))
  const block = css.slice(open + 1, css.indexOf("}", open))
  const declarations = new Map<string, string>()

  for (const match of block.matchAll(/(--ll-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1] as string, (match[2] as string).trim())
  }

  return declarations
}

const declarations = baseDeclarations()

function resolve(token: string, seen: string[] = []): string {
  const value = declarations.get(token)

  if (value === undefined) throw new Error(`${token} is not defined in tokens.css`)
  if (seen.includes(token)) throw new Error(`token cycle: ${[...seen, token].join(" → ")}`)

  const reference = /^var\((--ll-[a-z0-9-]+)\)$/.exec(value)
  return reference ? resolve(reference[1] as string, [...seen, token]) : value
}

function channels(token: string): [number, number, number] {
  const value = resolve(token)
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)

  if (!hex) throw new Error(`${token} must resolve to an opaque #rrggbb colour to be contrast-checked, got ${value}`)
  return [parseInt(hex[1] as string, 16), parseInt(hex[2] as string, 16), parseInt(hex[3] as string, 16)]
}

/** WCAG 2.2 relative luminance and contrast ratio. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(channels(foreground)), luminance(channels(background))].sort((a, b) => b - a)
  return ((light as number) + 0.05) / ((dark as number) + 0.05)
}

/** Declarations of one rule. Nested braces are not used in these theme blocks. */
function blockDeclarations(selector: string): Map<string, string> {
  const marker = `${selector} {`
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`missing ${selector}`)
  const open = css.indexOf("{", start)
  const body = css.slice(open + 1, css.indexOf("}", open))
  const found = new Map<string, string>()

  for (const match of body.matchAll(/(--ll-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] as string, (match[2] as string).trim())
  }

  return found
}

const darkDeclarations = blockDeclarations(':where(.ll-theme)[data-theme="dark"]')
const systemDeclarations = blockDeclarations(':where(.ll-theme)[data-theme="system"]')

function channelsIn(map: Map<string, string>, token: string, seen: string[] = []): [number, number, number] {
  const value = map.get(token) ?? declarations.get(token)
  if (value === undefined) throw new Error(`${token} is not defined for this theme`)
  if (seen.includes(token)) throw new Error(`token cycle: ${[...seen, token].join(" → ")}`)
  const reference = /^var\((--ll-[a-z0-9-]+)\)$/.exec(value)
  const resolved = reference ? channelsIn(map, reference[1] as string, [...seen, token]) : null
  if (resolved) return resolved
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!hex) throw new Error(`${token} must resolve to an opaque #rrggbb colour to be contrast-checked, got ${value}`)
  return [parseInt(hex[1] as string, 16), parseInt(hex[2] as string, 16), parseInt(hex[3] as string, 16)]
}

function contrastIn(map: Map<string, string>, foreground: string, background: string): number {
  const [light, dark] = [luminance(channelsIn(map, foreground)), luminance(channelsIn(map, background))].sort((a, b) => b - a)
  return ((light as number) + 0.05) / ((dark as number) + 0.05)
}

function moduleStylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : moduleStylesheets(path)
    return entry.name.endsWith(".module.css") ? [path] : []
  })
}

describe("design tokens (DS-01, #144)", () => {
  it("defines every named semantic colour token on .ll-theme", () => {
    for (const token of COLOR_TOKENS) {
      expect(declarations.has(token), token).toBe(true)
    }
  })

  it("defines nothing on :root, so pages outside .ll-theme are unaffected", () => {
    expect(css).not.toMatch(/:root\b/)
  })

  it.each(CONTRAST_PAIRS.map(([text, background]) => [text, background] as const))(
    "%s on %s meets 4.5:1 (WCAG 1.4.3)",
    (text, background) => {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it.each(NON_TEXT_PAIRS.map(([indicator, background]) => [indicator, background] as const))(
    "%s on %s meets 3:1 (WCAG 1.4.11)",
    (indicator, background) => {
      expect(contrast(indicator, background)).toBeGreaterThanOrEqual(3)
    }
  )

  it("raises the field floors (#327): 16 px body, 48 px targets, 56 px primary", () => {
    expect(declarations.get("--ll-text-base")).toBe("1rem")
    expect(declarations.get("--ll-target-touch")).toBe("48px")
    expect(declarations.get("--ll-c-button-h-sm")).toBe("48px")
    expect(declarations.get("--ll-c-button-h-md")).toBe("48px")
    expect(declarations.get("--ll-c-button-h-lg")).toBe("56px")
    expect(declarations.get("--ll-c-field-h")).toBe("48px")
    expect(declarations.get("--ll-color-action-pressed")).toBe("var(--ll-p-forest-900)")
    expect(css).toContain('[data-density="touch"]')
  })

  it.each(KEY_FACT_PAIRS.map(([text, background]) => [text, background] as const))(
    "%s on %s meets 7:1 in the light theme (field bar)",
    (text, background) => {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(7)
    }
  )

  it("ships the recorded dark theme and repeats it for data-theme=system (#281)", () => {
    expect(darkDeclarations.get("--ll-color-page")).toBe("var(--ll-p-neutral-950)")
    expect(darkDeclarations.get("--ll-color-text")).toBe("var(--ll-p-neutral-100)")
    expect(darkDeclarations.get("--ll-color-action")).toBe("var(--ll-p-forest-300)")
    expect(darkDeclarations.get("--ll-color-action-pressed")).toBe("var(--ll-p-forest-100)")
    expect(darkDeclarations.get("--ll-color-on-action")).toBe("var(--ll-p-neutral-950)")
    expect(darkDeclarations.get("--ll-focus-color")).toBe("var(--ll-p-timber-300)")
    expect([...systemDeclarations.entries()]).toEqual([...darkDeclarations.entries()])
    expect(css.indexOf("@media (forced-colors: active)")).toBeGreaterThan(css.indexOf('[data-theme="system"]'))
  })

  it.each([...CONTRAST_PAIRS, ...KEY_FACT_PAIRS, ...NON_TEXT_PAIRS].map(([text, background]) => [text, background] as const))(
    "%s on %s meets its floor in the dark theme",
    (text, background) => {
      const floor = KEY_FACT_PAIRS.some(([foreground, surface]) => foreground === text && surface === background) ? 7 : NON_TEXT_PAIRS.some(([indicator, surface]) => indicator === text && surface === background) ? 3 : 4.5
      expect(contrastIn(darkDeclarations, text, background)).toBeGreaterThanOrEqual(floor)
    }
  )

  it("keeps component stylesheets on semantic tokens: no primitives and no hex literals", () => {
    for (const path of moduleStylesheets(uiSource)) {
      const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      expect(source, path).not.toMatch(/--ll-p-/)
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })
})
