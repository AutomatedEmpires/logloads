// Verify the real map renders in a browser: canvas present, tiles loaded, no console errors.
import { chromium } from "@playwright/test"

const BASE = "http://127.0.0.1:3002"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 160)) })
page.on("pageerror", (err) => errors.push(`PAGEERROR: ${String(err).slice(0, 160)}`))

await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
await page.fill('input[name="email"]', "hank@northpine.example")
await page.click('button[type="submit"]')
await page.waitForURL("**/driver/map", { timeout: 30000 }).catch(() => {})

await page.goto(`${BASE}/driver/map`, { waitUntil: "networkidle" })
await page.waitForTimeout(4000)

const canvasCount = await page.locator("canvas").count()
const canvasBox = canvasCount > 0 ? await page.locator("canvas").first().boundingBox() : null
const markerCount = await page.locator(".maplibregl-marker, .mapboxgl-marker").count()
const attribution = await page.locator("text=OpenStreetMap").count()

console.log(`canvas: ${canvasCount} (${canvasBox ? `${canvasBox.width}x${canvasBox.height}` : "no box"})`)
console.log(`markers: ${markerCount}`)
console.log(`attribution: ${attribution}`)
console.log(`console errors: ${errors.length}`)
for (const e of errors.slice(0, 6)) console.log(`  - ${e}`)

await page.screenshot({ path: "/tmp/map-verify.png", fullPage: false })

// also verify discovery map view sync
await page.goto(`${BASE}/driver/loads`, { waitUntil: "networkidle" })
await page.click('button:has-text("Map")')
await page.waitForTimeout(2500)
const discoveryCanvas = await page.locator("canvas").count()
console.log(`discovery map canvas: ${discoveryCanvas}`)
await page.screenshot({ path: "/tmp/map-discovery.png", fullPage: false })

await browser.close()
