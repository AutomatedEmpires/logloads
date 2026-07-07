import { chromium } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" })
await page.click("text=I haul timber")
await page.waitForSelector('input[name="fullName"]')
await page.fill('input[name="fullName"]', "Cookie Driver")
await page.fill('input[name="email"]', `cookie-${Date.now()}@smoke.example`)
await page.fill('input[name="phone"]', "555-0142")
await page.fill('input[name="region"]', "Test Valley")

// capture the redirect chain of the action POST
page.on("response", (r) => {
  const u = r.url()
  if (u.includes("/onboarding") || u.includes("/driver") || u.includes("/sign-in")) {
    console.log(`RESP ${r.status()} ${u.replace(BASE, "")}`)
  }
})

await page.click('button[type="submit"]')
await page.waitForTimeout(3000)
console.log("Final URL:", page.url().replace(BASE, ""))

const cookies = await context.cookies()
const sess = cookies.find((c) => c.name === "ll_session")
console.log("ll_session present:", Boolean(sess), sess ? `len=${sess.value.length} parts=${sess.value.split(".").length} secure=${sess.secure} path=${sess.path}` : "")

await browser.close()
