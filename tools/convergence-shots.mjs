// Authenticated visual-convergence screenshots across mandated widths.
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"

const BASE = "http://127.0.0.1:3002"
const OUT = process.argv[2] ?? "/tmp/ll-convergence"

mkdirSync(OUT, { recursive: true })

const WIDTHS = [
  { name: "320", width: 320, height: 700 },
  { name: "360", width: 360, height: 780 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 }
]

const PLANS = [
  { email: null, routes: ["/", "/loads", "/pricing", "/sign-in"] },
  { email: "hank@northpine.example", routes: ["/driver/today", "/driver/loads", "/driver/trips", "/driver/equipment", "/driver/messages", "/driver/map"] },
  { email: "cole@summit.example", routes: ["/host/command", "/host/opportunities", "/host/live-board", "/host/billing", "/host/settings"] },
  { email: "dispatch@northpine.example", routes: ["/fleet/command", "/fleet/dispatch", "/fleet/trucks", "/fleet/drivers"] },
  { email: "admin@logloads.example", routes: ["/admin", "/admin/verification", "/admin/organizations"] }
]

// Full sweep on the anchor widths; spot-checks elsewhere.
const FULL_WIDTHS = new Set(["390", "1440"])
const SPOT_ROUTES = new Set(["/", "/driver/today", "/host/command", "/driver/loads"])

const browser = await chromium.launch()

for (const plan of PLANS) {
  for (const viewport of WIDTHS) {
    const routes = plan.routes.filter((route) => FULL_WIDTHS.has(viewport.name) || SPOT_ROUTES.has(route))

    if (routes.length === 0) {
      continue
    }

    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()

    if (plan.email) {
      await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
      await page.fill('input[name="email"]', plan.email)
      await page.click('button[type="submit"]')
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {})
    }

    for (const route of routes) {
      const slug = route === "/" ? "home" : route.replaceAll("/", "-").replace(/^-/, "")

      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 })
        await page.waitForTimeout(600)
        await page.screenshot({ fullPage: true, path: `${OUT}/${slug}--${viewport.name}.png` })
        console.log(`ok ${slug}--${viewport.name}`)
      } catch (error) {
        console.log(`FAIL ${slug}--${viewport.name}: ${String(error).slice(0, 100)}`)
      }
    }

    await context.close()
  }
}

await browser.close()
console.log("done")
