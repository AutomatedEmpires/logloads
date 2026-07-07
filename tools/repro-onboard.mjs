import { chromium } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

page.on("console", (msg) => { if (msg.type() === "error") console.log("PAGE ERR:", msg.text().slice(0, 200)) })

await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" })
await page.click("text=I haul timber")
await page.waitForSelector('input[name="fullName"]')
await page.fill('input[name="fullName"]', "Repro Driver")
await page.fill('input[name="email"]', `repro-${Date.now()}@smoke.example`)
await page.fill('input[name="phone"]', "555-0142")
await page.fill('input[name="region"]', "Test Valley")
await page.click('button[type="submit"]')
await page.waitForTimeout(3000)
console.log("URL after submit:", page.url())
const alertText = await page.locator('[role="alert"]').first().textContent().catch(() => null)
console.log("Alert text:", alertText)
const h1 = await page.locator("h1").first().textContent().catch(() => null)
console.log("H1:", h1)
const bodyStart = (await page.locator("body").textContent().catch(() => "")).slice(0, 300)
console.log("Body start:", bodyStart.replace(/\s+/g, " "))
await browser.close()
