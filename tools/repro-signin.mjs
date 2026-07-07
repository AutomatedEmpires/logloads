import { chromium } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const email = process.argv[2]
const target = process.argv[3] ?? "/driver/today"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
await page.fill('input[name="email"]', email)
await page.click('button[type="submit"]')
await page.waitForTimeout(2500)
console.log("after sign-in URL:", page.url())
await page.goto(`${BASE}${target}`, { waitUntil: "networkidle" })
await page.waitForTimeout(1500)
console.log("target URL:", page.url())
console.log("H1:", await page.locator("h1").first().textContent().catch(() => null))
await browser.close()
