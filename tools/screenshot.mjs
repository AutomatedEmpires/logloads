// Screenshot helper: node tools/screenshot.mjs [outDir] [routes...] — defaults to key routes at mobile+desktop.
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"

const BASE = process.env.SHOT_BASE ?? "http://127.0.0.1:3002"
const outDir = process.argv[2] ?? "/tmp/logloads-shots"
const routes = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["/", "/pricing", "/how-it-works", "/loads", "/driver", "/driver/loads", "/driver/equipment", "/driver/map", "/fleet", "/host", "/host/opportunities", "/host/live-board", "/admin", "/onboarding", "/sign-in"]

const viewports = (process.env.SHOT_VIEWPORTS ?? "390x844,1440x900").split(",").map((v) => {
  const [w, h] = v.split("x").map(Number)
  return { width: w, height: h }
})

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  for (const route of routes) {
    const slug = route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "-")
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${outDir}/${slug}-${viewport.width}.png`, fullPage: true })
      console.log(`ok ${slug}-${viewport.width}`)
    } catch (error) {
      console.log(`FAIL ${slug}-${viewport.width}: ${String(error).slice(0, 120)}`)
    }
  }
  await page.close()
}

await browser.close()
