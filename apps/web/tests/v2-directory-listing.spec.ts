import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * The directory listing notice (#423, LL-UI05; legal review §6.5): Figma 04 Settings, approved on #336 (comment
 * 6995131813). Not listed 361:4236 (390) / 361:4739 (1440), offline 361:6219 / 361:6682, not saved 361:6907 /
 * 361:7347, dark 361:7563, at 390 and 1440 px.
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs), on the pilot store. The pilot
 * store keeps no listing (`supportsHaulerProfile: false`), so a tap is answered "nothing changed" and nothing here
 * writes: every case can run again on the same state. Listed, removed and Undo need the normalized store; their
 * markup, the one-save write and Undo are proven in lib/marketplace-v2/hauler-pages.test.tsx.
 */

const GRANITE_CREEK = { email: "avery@granitecreek.example", name: "Granite Creek Hauling" }
/** A driver at North Pine Logging: a member of a hauling business who may not change its profile. */
const DRIVER = "hank@northpine.example"
const LISTING = "/v2/hauler/profile/listing"

/** apps/web/tests/test-results/directory-listing, wherever Playwright was started from (ignored by Git). */
const shotsDir = () => join(test.info().project.testDir, "test-results", "directory-listing")
const viewportFor = (width: number) => ({ height: width < 768 ? 844 : 900, width })

test.beforeAll(() => {
  mkdirSync(shotsDir(), { recursive: true })
})

test.beforeEach(async ({ page }) => {
  // `next dev` only: hide the framework's dev-tools button, as the design-system suite does.
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style")
      style.textContent = "nextjs-portal { display: none !important; }"
      document.head.append(style)
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hide, { once: true })
    else hide()
  })
})

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"))
}

async function openListing(page: Page) {
  await page.goto(LISTING)
  await expect(page.locator(".ll-app #main")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Directory listing" })).toBeVisible()
  // Hydrated: the taps are handled in the page from here on.
  await page.waitForLoadState("networkidle")
}

/**
 * The whole page without the fixed bottom tabs (a stitched capture would draw them, and the sticky bar, over the
 * middle of the page), and the screen as the phone shows it scrolled to the end, with the bar docked above the tabs.
 */
async function shoot(page: Page, name: string, width: number) {
  await page.screenshot({
    fullPage: true,
    path: join(shotsDir(), `${name}-${width}.png`),
    style: ".ll-app > nav { display: none !important; } [data-bar] { position: static !important; }"
  })
  await page.evaluate(() => window.scrollTo({ behavior: "instant", top: document.documentElement.scrollHeight }))
  await page.screenshot({ path: join(shotsDir(), `${name}-${width}-screen.png`) })
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include(".ll-app #main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([])
}

/** Quality bar A3 and R1: every control at least 44 px each way (the system's are 48 and 56), no sideways scroll. */
async function expectTargetsAndReflow(page: Page) {
  const report = await page.evaluate(() => {
    const short: string[] = []
    for (const element of document.querySelectorAll("[data-listing-view] button, [data-listing-view] a")) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (Math.min(box.width, box.height) + 0.5 < 44) short.push(`${(element.textContent ?? "").trim()} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, short }
  })

  expect(report.short).toEqual([])
  expect(report.scroll).toBeLessThanOrEqual(0)
}

const listingPosts = (page: Page) => {
  const posts: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === LISTING) posts.push(request.url())
  })
  return posts
}

for (const width of [390, 1440]) {
  test.describe(`at ${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
    })

    test(`not listed (${width === 390 ? "361:4236" : "361:4739"}): says exactly what landings would see, before any tap`, async ({ page }) => {
      await signIn(page, GRANITE_CREEK.email)
      await openListing(page)

      const notice = page.locator("[data-listing-view='notListed']")
      await expect(notice.getByText(`${GRANITE_CREEK.name} is not in the directory`)).toBeVisible()
      await expect(notice.getByText("You can still send interest in any job.", { exact: false })).toBeVisible()
      await expect(page.getByRole("heading", { level: 2, name: "If you list it, landings will see" })).toBeVisible()
      for (const label of ["Business name", "Service area", "Trucks and trailers", "Availability", "Identity review", "Who sees it", "Never shown"]) {
        await expect(notice.locator("dt", { hasText: label })).toBeVisible()
      }
      await expect(notice.locator("dd").filter({ hasText: GRANITE_CREEK.name })).toBeVisible()
      await expect(notice.getByText("Landing businesses signed in to LogLoads. Not people who are signed out, and not search engines.")).toBeVisible()
      await expect(notice.getByText("Your phone number, your email and your exact location.")).toBeVisible()
      await expect(notice.getByText("LogLoads cannot take that copy back.", { exact: false })).toBeVisible()
      await expect(page.getByRole("button", { name: "List my profile" })).toBeVisible()
      await expect(page.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/v2/hauler/profile")
      await expect(page.getByRole("button", { name: "Remove my listing" })).toHaveCount(0)

      if (width === 390) {
        // The bottom bar (BottomActionBar 213:1239): sticky, full width, above the bottom tabs.
        const bar = page.locator("[data-listing-view] [data-bar]")
        await expect(bar).toHaveCSS("position", "sticky")
        const primary = await page.getByRole("button", { name: "List my profile" }).boundingBox()
        expect(primary?.width ?? 0).toBeGreaterThan(width - 48)

        // Scrolled to the end, the docked bar covers none of the notice: the last note ends above it.
        await page.evaluate(() => window.scrollTo({ behavior: "instant", top: document.documentElement.scrollHeight }))
        const note = await notice.getByText("LogLoads cannot take that copy back.", { exact: false }).boundingBox()
        const docked = await bar.boundingBox()
        expect((note?.y ?? 0) + (note?.height ?? 0)).toBeLessThanOrEqual((docked?.y ?? 0) + 0.5)
      }

      await expectTargetsAndReflow(page)
      await expectNoSeriousAxeViolations(page)
      await shoot(page, "not-listed", width)
    })

    test(`not saved (${width === 390 ? "361:6907" : "361:7347"}): a tap the store cannot carry out changes nothing and says so`, async ({ page }) => {
      await signIn(page, GRANITE_CREEK.email)
      await openListing(page)
      const posts = listingPosts(page)

      await page.getByRole("button", { name: "List my profile" }).click()

      const alert = page.getByRole("alert").filter({ hasText: "Your profile was not listed" })
      await expect(alert).toBeVisible()
      await expect(alert).toContainText("nothing changed")
      await expect(alert).toBeFocused()
      expect(posts).toHaveLength(1)
      // Still not listed, and the screen still offers the same choice.
      await expect(page.getByRole("button", { name: "List my profile" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Remove my listing" })).toHaveCount(0)

      await expectNoSeriousAxeViolations(page)
      await shoot(page, "not-saved", width)

      await page.reload()
      await expect(page.locator("[data-listing-view='notListed']").getByText(`${GRANITE_CREEK.name} is not in the directory`)).toBeVisible()
    })

    test("unreachable: a request that never arrives changes nothing, and Try again repeats the same tap", async ({ page }) => {
      await signIn(page, GRANITE_CREEK.email)
      await openListing(page)
      await page.route(`**${LISTING}`, (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()))

      await page.getByRole("button", { name: "List my profile" }).click()

      const alert = page.getByRole("alert").filter({ hasText: "We couldn't reach LogLoads, so nothing changed." })
      await expect(alert).toBeVisible()
      await expect(alert).toBeFocused()
      await page.unroute(`**${LISTING}`)

      const posts = listingPosts(page)
      await alert.getByRole("button", { name: "Try again" }).click()
      await expect(page.getByRole("alert").filter({ hasText: "Your profile was not listed" })).toContainText("isn't available in this preview yet")
      expect(posts).toHaveLength(1)
    })

    test(`offline (${width === 390 ? "361:6219" : "361:6682"}): the last saved setting stays and nothing is sent`, async ({ page, context }) => {
      await signIn(page, GRANITE_CREEK.email)
      await openListing(page)
      const posts = listingPosts(page)

      await context.setOffline(true)
      const banner = page.getByRole("status").filter({ hasText: "You're offline" })
      await expect(banner).toContainText("Your listing stays as last saved.")
      await expect(page.locator("[data-listing-view='notListed']").getByText(`${GRANITE_CREEK.name} is not in the directory`)).toBeVisible()

      await expectNoSeriousAxeViolations(page)
      await shoot(page, "offline", width)

      await page.getByRole("button", { name: "List my profile" }).click()
      await expect(banner).toContainText("You're offline, so nothing can change.")
      await expect(banner).toBeFocused()
      expect(posts).toHaveLength(0)

      await context.setOffline(false)
      await expect(banner).toHaveCount(0)
    })

    test("a member without edit rights reads the notice with no listing or removal control", async ({ page }) => {
      await signIn(page, DRIVER)
      await openListing(page)

      await expect(page.getByText("Only an owner or manager of this business can list it or remove it.", { exact: false })).toBeVisible()
      for (const name of ["List my profile", "Remove my listing", "Undo", "Try again"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0)
      }
      await expect(page.locator("[data-listing-view] form")).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)
      await shoot(page, "read-only", width)
    })
  })
}

test("dark (361:7563): the same notice in the dark theme, at 390 px", async ({ page }) => {
  await page.setViewportSize(viewportFor(390))
  await signIn(page, GRANITE_CREEK.email)
  await openListing(page)
  await page.locator(".ll-theme").first().evaluate((element) => element.setAttribute("data-theme", "dark"))

  await expectNoSeriousAxeViolations(page)
  await shoot(page, "dark", 390)
})

test("the business profile shows the listing's state and the way to it, with no bare checkbox", async ({ page }) => {
  await page.setViewportSize(viewportFor(1440))
  await signIn(page, GRANITE_CREEK.email)
  await page.goto("/v2/hauler/profile")
  await expect(page.locator(".ll-app #main")).toBeVisible()

  await expect(page.getByRole("checkbox", { name: "Show my profile to every landing operator" })).toHaveCount(0)
  await expect(page.getByText("Not listed", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Review and list" }).click()
  await expect(page).toHaveURL(new RegExp(`${LISTING}$`))
  await expect(page.getByRole("heading", { level: 1, name: "Directory listing" })).toBeVisible()
})

test("keyboard: every control is reachable in order, with a visible focus ring", async ({ page }) => {
  await page.setViewportSize(viewportFor(1440))
  await signIn(page, GRANITE_CREEK.email)
  await openListing(page)

  // From the breadcrumb back to the profile, Tab reaches List my profile and then Not now, in reading order.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Business profile" }).focus()
  const primary = page.getByRole("button", { name: "List my profile" })
  for (let step = 0; step < 20 && !(await primary.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab")
  }
  await expect(primary).toBeFocused()
  expect(await primary.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "Not now" })).toBeFocused()
  expect(await page.getByRole("link", { name: "Not now" }).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
})
