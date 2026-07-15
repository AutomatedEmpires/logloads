import { chromium } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) console.log("NAV:", new URL(frame.url()).pathname) })
page.on("console", (msg) => { if (msg.type() === "error") console.log("ERR:", msg.text().slice(0, 140)) })
page.on("pageerror", (err) => console.log("PAGEERR:", String(err).slice(0, 200)))

await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
await page.fill('input[name="email"]', "hank@northpine.example")
await page.click('button[type="submit"]')
await page.waitForURL("**/driver/map", { timeout: 30000 })

await page.goto(`${BASE}/driver/loads`, { waitUntil: "networkidle" })
const card = page.locator("a.load-card-v3").first()
const href = await card.getAttribute("href")
const box = await card.boundingBox()
console.log("card href:", href, "box:", JSON.stringify(box))

const atPoint = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y)
  return el ? `${el.tagName}.${el.className}`.slice(0, 120) : "none"
}, { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: Math.min((box?.y ?? 0) + (box?.height ?? 0) / 2, 800) })
console.log("element at card center:", atPoint)

await card.click()
await page.waitForTimeout(3000)
console.log("after click:", new URL(page.url()).pathname)

// try direct DOM click
await page.evaluate(() => (document.querySelector("a.load-card-v3"))?.click())
await page.waitForTimeout(3000)
console.log("after js click:", new URL(page.url()).pathname)

await browser.close()
