// Quick auth-flow verification against the dev server.
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE ?? "http://127.0.0.1:3002"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

const results = []

// 1. Cockpit routes redirect unauthenticated visitors to sign-in
await page.goto(`${BASE}/driver/today`, { waitUntil: "domcontentloaded", timeout: 60000 })
results.push(`unauth /driver/today -> ${page.url().includes("/sign-in") ? "OK redirected" : `FAIL ${page.url()}`}`)

// 2. Dev sign-in as seeded driver
await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" })
await page.fill('input[name="email"]', "hank@northpine.example")
await page.click('button[type="submit"]')
await page.waitForURL("**/driver/today", { timeout: 30000 }).catch(() => {})
results.push(`dev sign-in -> ${page.url().includes("/driver/today") ? "OK /driver/today" : `FAIL ${page.url()}`}`)

// 3. Driver page renders with real org
const orgVisible = await page.locator("text=North Pine Logging").first().isVisible().catch(() => false)
results.push(`driver cockpit org -> ${orgVisible ? "OK North Pine visible" : "WARN org not visible"}`)

// 4. Cross-cockpit guard: driver visiting /admin gets bounced (redirect may stream client-side)
await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" })
await page.waitForURL((url) => !url.pathname.startsWith("/admin"), { timeout: 10000 }).catch(() => {})
results.push(`driver -> /admin -> ${page.url().includes("/admin") ? `FAIL stayed ${page.url()}` : `OK bounced to ${new URL(page.url()).pathname}`}`)

// 5. Sign out via fresh context, then onboarding provisions a new host account
console.log(results.join("\n"))

const context2 = await browser.newContext()
const page2 = await context2.newPage()
await page2.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" })
await page2.waitForTimeout(1500)
await page2.click("text=I have timber to move")
await page2.waitForSelector('input[name="fullName"]', { timeout: 15000 })
await page2.fill('input[name="fullName"]', "Test Host Owner")
await page2.fill('input[name="email"]', `host-${Date.now()}@smoke.example`)
await page2.fill('input[name="phone"]', "555-0199")
await page2.fill('input[name="organizationName"]', "Smoke Test Timber")
await page2.fill('input[name="region"]', "Test Valley")
await page2.click('button[type="submit"]')
await page2.waitForURL("**/host/command", { timeout: 30000 }).catch(() => {})
results.push(`onboarding host -> ${page2.url().includes("/host/command") ? "OK /host/command" : `FAIL ${page2.url()}`}`)

const orgVisible2 = await page2.locator("text=Smoke Test Timber").first().isVisible().catch(() => false)
console.log(`onboarding host -> ${page2.url().includes("/host/command") ? "OK /host/command" : `FAIL ${page2.url()}`}`)
console.log(`new host org visible -> ${orgVisible2 ? "OK" : "WARN"}`)
await browser.close()
