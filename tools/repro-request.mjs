import { chromium, devices } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const browser = await chromium.launch()
const context = await browser.newContext({ ...devices["Pixel 7"] })
const page = await context.newPage()

await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
await page.fill('input[name="email"]', "hank@northpine.example")
await page.click('button[type="submit"]')
await page.waitForURL("**/driver/today", { timeout: 30000 }).catch(() => console.log("sign-in stuck at", page.url()))

await page.goto(`${BASE}/driver/loads`, { waitUntil: "networkidle" })
const count = await page.locator("a.load-card-v3").count()
console.log("cards:", count)

for (let index = 0; index < count; index += 1) {
  await page.goto(`${BASE}/driver/loads`, { waitUntil: "networkidle" })
  const card = page.locator("a.load-card-v3").nth(index)
  const title = (await card.locator("strong").first().textContent())?.trim()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await card.click()
    const navigated = await page.waitForURL(/\/driver\/loads\/[^/?]+/, { timeout: 2_500 }).then(() => true).catch(() => false)
    if (navigated) break
  }

  await page.waitForLoadState("networkidle")

  const requestable = await page.getByRole("button", { name: "Request 1 load" }).isVisible().catch(() => false)
  const committed = await page.getByText("Waiting for host approval").first().isVisible().catch(() => false)
  const filled = await page.getByText("Capacity filled").first().isVisible().catch(() => false)
  const panelInDom = await page.locator(".request-panel").count()

  console.log(`card ${index}: "${title}" url=${new URL(page.url()).pathname} panelInDom=${panelInDom} requestable=${requestable} committed=${committed} filled=${filled}`)

  if (requestable) {
    await page.getByRole("button", { name: "Request 1 load" }).click()
    await page.waitForTimeout(5000)
    const ok = await page.getByText(/Requested — /).first().isVisible().catch(() => false)
    const err = await page.locator(".action-error").first().textContent().catch(() => null)
    console.log(`  -> after click: ok=${ok} error=${err}`)
    if (ok) break
  }
}

await browser.close()
