import { expect, test, type Page } from "@playwright/test"

/**
 * Field conditions (#327, P0-8 and P0-11). Runs with the design-system server (Marketplace V2 on),
 * not the pilot journeys: playwright.config.mjs ignores this file, design-system.config.mjs matches it.
 *
 * Floors from the 00 System field layer (#281): 16 px body, 48 px targets, 56 px primary actions,
 * 7:1 key-fact contrast, no horizontal scroll at 320 px, and largest contentful paint on throttled 4G.
 * The 4G paint check runs when the suite is on `next start` (CI). `next dev` compile time is not paint.
 */

const VIEWPORT = { height: 720, width: 320 } as const
const SLOW_4G = {
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  latency: 150,
  offline: false,
  uploadThroughput: Math.floor((750 * 1024) / 8)
}
/** Facts in 5 seconds on 4G (strategy comment on #235). */
const LCP_BUDGET_MS = 5_000

const ROUTES = ["/v2/work", "/v2/start"] as const

test.use({ viewport: VIEWPORT })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style")
      style.textContent = "nextjs-portal { display: none !important; }"
      document.head.append(style)
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hide, { once: true })
    else hide()
  })
})

async function openV2(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator(".ll-app #main")).toBeVisible()
  await expect(page.locator(".route-skeleton")).toHaveCount(0)
}

interface FieldReport {
  bodyPx: number
  buttonLg: string
  buttonSm: string
  facts: string[]
  scroll: { clientWidth: number; scrollWidth: number }
  shortTargets: string[]
  targetTouch: string
}

async function measure(page: Page): Promise<FieldReport> {
  return page.evaluate(() => {
    const theme = document.querySelector(".ll-theme")
    if (!theme) throw new Error("missing .ll-theme")
    const themeStyle = getComputedStyle(theme)
    const app = document.querySelector(".ll-app")
    if (!app) throw new Error("missing .ll-app")

    const parse = (value: string) => {
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value)
      if (!match) return null
      return { a: match[4] === undefined ? 1 : Number(match[4]), b: Number(match[3]), g: Number(match[2]), r: Number(match[1]) }
    }

    const opaqueBackground = (element: Element) => {
      const layers: Array<{ a: number; b: number; g: number; r: number }> = []
      let node: Element | null = element
      while (node) {
        const color = parse(getComputedStyle(node).backgroundColor)
        if (color && color.a > 0) layers.push(color)
        if (color && color.a === 1) break
        node = node.parentElement
      }
      let mixed = { a: 1, b: 255, g: 255, r: 255 }
      for (const layer of layers.reverse()) {
        const alpha = layer.a
        mixed = {
          a: 1,
          b: layer.b * alpha + mixed.b * (1 - alpha),
          g: layer.g * alpha + mixed.g * (1 - alpha),
          r: layer.r * alpha + mixed.r * (1 - alpha)
        }
      }
      return mixed
    }

    const linear = (channel: number) => {
      const s = channel / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luminance = (color: { b: number; g: number; r: number }) => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    const ratio = (foreground: { b: number; g: number; r: number }, background: { b: number; g: number; r: number }) => {
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      return ((light as number) + 0.05) / ((dark as number) + 0.05)
    }

    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }

    const labelOf = (element: Element) => {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)
      const name = element.getAttribute("aria-label") ?? text
      return `${element.tagName.toLowerCase()} ${name || element.getAttribute("data-part") || "(unnamed)"}`
    }

    const shortTargets: string[] = []
    const controls = document.querySelectorAll(
      ".ll-app button, .ll-app [role='button'], .ll-app [role='tab'], .ll-app select, .ll-app textarea, .ll-app input:not([type='hidden']):not([type='checkbox']):not([type='radio']), .ll-app > nav a"
    )
    for (const element of controls) {
      if (!visible(element)) continue
      const box = element.getBoundingClientRect()
      const size = element.getAttribute("data-size")
      const floor = size === "lg" ? 56 : 48
      const along = Math.min(box.width, box.height)
      if (along + 0.5 < floor) shortTargets.push(`${labelOf(element)} ${Math.round(box.width)}×${Math.round(box.height)} needs ${floor}`)
    }

    const facts: string[] = []
    for (const element of document.querySelectorAll("[data-part='amount'], [data-part='basis']")) {
      if (!visible(element)) continue
      const foreground = parse(getComputedStyle(element).color)
      if (!foreground) continue
      const measured = ratio(foreground, opaqueBackground(element))
      if (measured < 7) facts.push(`${labelOf(element)} ${measured.toFixed(2)}:1`)
    }

    return {
      bodyPx: parseFloat(getComputedStyle(app).fontSize),
      buttonLg: themeStyle.getPropertyValue("--ll-c-button-h-lg").trim(),
      buttonSm: themeStyle.getPropertyValue("--ll-c-button-h-sm").trim(),
      facts,
      scroll: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      shortTargets,
      targetTouch: themeStyle.getPropertyValue("--ll-target-touch").trim()
    }
  })
}

test.describe("field conditions (#327)", () => {
  for (const path of ROUTES) {
    test(`${path} meets the field floors at 320 px`, async ({ page }) => {
      await openV2(page, path)
      if (path === "/v2/work" && (await page.locator("[data-part='amount']").count()) === 0) {
        await openV2(page, "/v2/work?all=1")
      }

      const report = await measure(page)
      expect(report.bodyPx, "body text").toBeGreaterThanOrEqual(16)
      expect(report.targetTouch, "touch target token").toBe("48px")
      expect(report.buttonSm, "small and medium controls").toBe("48px")
      expect(report.buttonLg, "primary action").toBe("56px")
      expect(report.scroll.scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(report.scroll.clientWidth + 1)
      expect(report.shortTargets, "48 px targets, 56 px primary").toEqual([])
      if (path === "/v2/work") expect(await page.locator("[data-part='amount']").count(), "a key fact is on the board").toBeGreaterThan(0)
      expect(report.facts, "key facts at 7:1").toEqual([])

      await page.screenshot({ fullPage: true, path: `tests/test-results/field-conditions${path.replaceAll("/", "-")}-320.png` })
    })
  }

  test("find work largest contentful paint on throttled 4G stays under 5 s", async ({ page }) => {
    const onProductionServer = process.env.DS_E2E_SERVER === "start" || (process.env.DS_E2E_SERVER !== "dev" && Boolean(process.env.SUPABASE_URL))
    test.skip(!onProductionServer, "next dev compile time is not largest contentful paint; CI runs this on next start")

    await page.addInitScript(() => {
      (window as unknown as { __llLcp: number }).__llLcp = 0
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1)
        if (last) (window as unknown as { __llLcp: number }).__llLcp = last.startTime
      }).observe({ buffered: true, type: "largest-contentful-paint" })
    })

    const client = await page.context().newCDPSession(page)
    await client.send("Network.enable")
    await client.send("Network.emulateNetworkConditions", SLOW_4G)
    await openV2(page, "/v2/work")
    await page.waitForLoadState("load")
    const lcp = await page.evaluate(() => (window as unknown as { __llLcp: number }).__llLcp)
    expect(lcp, "largest contentful paint on throttled 4G").toBeGreaterThan(0)
    expect(lcp).toBeLessThanOrEqual(LCP_BUDGET_MS)
  })
})
