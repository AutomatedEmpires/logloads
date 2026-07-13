// Authenticated screenshot sweep across cockpits at multiple widths.
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"

const BASE = process.env.SHOT_BASE ?? "http://127.0.0.1:3002"
const outDir = process.argv[2] ?? "/tmp/logloads-shots"
mkdirSync(outDir, { recursive: true })

const WIDTHS = [
  { w: 390, h: 844, tag: "m" },   // mobile
  { w: 1440, h: 900, tag: "d" }   // desktop
]

const PUBLIC_ROUTES = ["/", "/loads", "/how-it-works", "/pricing", "/trust", "/for-landings", "/sign-in", "/onboarding"]

const SESSIONS = [
  { email: "hank@northpine.example", role: "driver", routes: ["/driver/map", "/driver/loads", "/driver/schedule", "/driver/equipment", "/driver/messages", "/driver/profile"] },
  { email: "dispatch@northpine.example", role: "fleet", routes: ["/fleet/command", "/fleet/dispatch", "/fleet/trucks", "/fleet/drivers", "/fleet/availability", "/fleet/billing", "/fleet/settings"] },
  { email: "cole@summit.example", role: "host", routes: ["/host/command", "/host/opportunities", "/host/live-board", "/host/landings", "/host/carriers", "/host/billing", "/host/settings"] },
  { email: "admin@logloads.example", role: "admin", routes: ["/admin", "/admin/verification", "/admin/organizations", "/admin/notices", "/admin/audit", "/admin/billing"] }
]

const browser = await chromium.launch()

async function shoot(page, route, tag) {
  const slug = (route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "-"))
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${outDir}/${slug}-${tag}.png`, fullPage: true })
    const url = page.url().replace(BASE, "")
    console.log(`ok ${slug}-${tag}${url !== route ? ` (->${url})` : ""}`)
  } catch (error) {
    console.log(`FAIL ${slug}-${tag}: ${String(error).slice(0, 90)}`)
  }
}

for (const { w, h, tag } of WIDTHS) {
  // public
  const pub = await browser.newContext({ viewport: { width: w, height: h } })
  const pubPage = await pub.newPage()
  for (const route of PUBLIC_ROUTES) await shoot(pubPage, route, tag)
  await pub.close()

  // authenticated per role
  for (const session of SESSIONS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
    await page.fill('input[name="email"]', session.email)
    await page.click('button[type="submit"]')
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {})
    for (const route of session.routes) await shoot(page, route, tag)
    await ctx.close()
  }
}

await browser.close()
console.log("done")
