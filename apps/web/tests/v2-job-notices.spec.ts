import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * The advertising-only notice and the Posting Rules line in the V2 job editor (#422; legal review P0 items 5 and 15),
 * against the approved Figma frames on page 03 Create and edit: CE-03b (`359:4602`; poles at 390 `359:4634`, 1440
 * `359:4605`, Other at 390 `359:5109`) and the "Before you publish" line of CE-06 (`238:3596` at 390, `238:3576` at
 * 1440, Dark `319:4349`), at 390 and 1440 px. Each screen is checked with axe (no serious or critical issue).
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs). It signs in as Summit Ridge
 * Timber's owner, a landing that can post jobs, and only reads: it never presses Publish, and the pilot store cannot
 * publish anyway. Screenshots go to apps/web/tests/test-results/job-notices (ignored by Git).
 */

const LANDING = "cole@summit.example"
const NEW_JOB = "/v2/landing/jobs/new"
const PREVIEW = "/v2/landing/jobs/preview"

const TITLE = "LogLoads only advertises this job"
const POLES_BODY =
  "You and the hauler are responsible for any operating authority this haul of poles and pilings needs. LogLoads does not arrange the haul or check authority."
const OTHER_BODY = "You and the hauler are responsible for any operating authority this haul needs. LogLoads does not arrange the haul or check authority."

const shotsDir = () => join(test.info().project.testDir, "test-results", "job-notices")
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

async function openV2(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator(".ll-app #main")).toBeVisible()
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"))
}

/** The notice that shows: the page carries one hidden variant per notice product, and CSS shows the chosen one. */
const shownNotice = (page: Page) => page.locator("[data-advertising-notice]:visible")
const productSelect = (page: Page) => page.locator("select#product")

/** The landing's first landing id, from step 1's own select, so the review URL uses the signed-in business's landing. */
async function ownLandingId(page: Page): Promise<string> {
  await openV2(page, NEW_JOB)
  const value = await page.locator("select#landingId option").nth(1).getAttribute("value")
  expect(value, "the landing has an active landing to post from").toBeTruthy()
  return value!
}

/** A draft that passes steps 1 to 3, as the review step's URL. */
function reviewPath(landingId: string, product: Record<string, string>) {
  const query = new URLSearchParams({
    durationDays: "10",
    equipment: "log_truck",
    landingId,
    payAmount: "68",
    payUnit: "per_load",
    startsOn: "2026-12-01",
    trucksRequested: "2",
    ...product
  })
  return `${PREVIEW}?${query.toString()}`
}

async function capture(page: Page, name: string, width: number) {
  await page.screenshot({ fullPage: true, path: join(shotsDir(), `${name}-${width}.png`), style: ".ll-app > nav { display: none !important; }" })
}

async function expectNoSeriousAxeViolations(page: Page) {
  // As design-system.spec.ts does: grow the viewport to the page height so nothing sits under a sticky bar.
  const viewport = page.viewportSize()
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  if (viewport && pageHeight > viewport.height) await page.setViewportSize({ height: pageHeight, width: viewport.width })

  const results = await new AxeBuilder({ page })
    .include(".ll-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()

  if (viewport) await page.setViewportSize(viewport)
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  expect(blocking.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([])
}

for (const width of [390, 1440]) {
  test(`step 1 shows the notice for poles and pilings and Other, and follows the product select, at ${width} px`, async ({ page }) => {
    await page.setViewportSize(viewportFor(width))
    await signIn(page, LANDING)
    await openV2(page, NEW_JOB)
    await page.locator("input#title").fill("Douglas-fir poles, Hills Creek")

    // Nothing chosen yet, then a product that needs no notice.
    await expect(shownNotice(page)).toHaveCount(0)
    await productSelect(page).selectOption("Saw logs")
    await expect(shownNotice(page)).toHaveCount(0)

    // CE-03b poles: under the product, with the product named.
    await productSelect(page).selectOption("Poles and pilings")
    await expect(shownNotice(page)).toHaveCount(1)
    await expect(shownNotice(page)).toHaveAttribute("role", "note")
    await expect(shownNotice(page)).toContainText(TITLE)
    await expect(shownNotice(page)).toContainText(POLES_BODY)
    await capture(page, "ce03b-poles", width)
    await shownNotice(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), `ce03b-poles-${width}-screen.png`) })
    await expectNoSeriousAxeViolations(page)

    // CE-03b Other: the poster's description, and the notice without a product name.
    await productSelect(page).selectOption("Other")
    await page.locator("input#productOther").fill("Treated fence posts")
    await expect(shownNotice(page)).toHaveCount(1)
    await expect(shownNotice(page)).toContainText(OTHER_BODY)
    await expect(shownNotice(page)).not.toContainText("poles and pilings")
    await capture(page, "ce03b-other", width)
    await shownNotice(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), `ce03b-other-${width}-screen.png`) })
    await expectNoSeriousAxeViolations(page)

    // Back to a product that needs no notice: it goes away again.
    await productSelect(page).selectOption("Pulpwood")
    await expect(shownNotice(page)).toHaveCount(0)
  })

  test(`the review step shows the notice and the Posting Rules line under the statements, at ${width} px`, async ({ page }) => {
    await page.setViewportSize(viewportFor(width))
    await signIn(page, LANDING)
    const landingId = await ownLandingId(page)

    await openV2(page, reviewPath(landingId, { product: "Poles and pilings", title: "Douglas-fir poles, Hills Creek" }))
    await expect(page).toHaveURL((url) => url.pathname === PREVIEW)
    await expect(shownNotice(page)).toHaveCount(1)
    await expect(shownNotice(page)).toContainText(POLES_BODY)

    const statements = page.getByRole("group", { name: "Before you publish" })
    const rules = statements.getByRole("link", { name: "LogLoads Posting Rules" })
    await expect(statements.getByRole("checkbox")).toHaveCount(3)
    await expect(statements).toContainText("Publishing is subject to the LogLoads Posting Rules.")
    await expect(rules).toHaveAttribute("href", "/posting-rules")

    // The notice is read before the statements, and the line after the last one.
    const [noticeBox, lastBox, rulesBox] = await Promise.all([
      shownNotice(page).boundingBox(),
      statements.getByRole("checkbox").last().boundingBox(),
      rules.boundingBox()
    ])
    expect(noticeBox!.y).toBeLessThan(lastBox!.y)
    expect(rulesBox!.y).toBeGreaterThan(lastBox!.y)

    // A 44 px target: each line of the link is at least 44 px tall, though it reads as plain inline text.
    const lineHeights = await rules.evaluate((link) => Array.from(link.getClientRects(), (rect) => rect.height))
    expect(lineHeights.length).toBeGreaterThan(0)
    for (const height of lineHeights) expect(height).toBeGreaterThanOrEqual(44)

    // Keyboard: Tab from the last statement reaches the link, whose ring hugs the words (no target padding while
    // focused, so the ring never crosses the line above when the link wraps).
    await statements.getByRole("checkbox").last().focus()
    await page.keyboard.press("Tab")
    await expect(rules).toBeFocused()
    const ring = await rules.evaluate((link) => {
      const style = getComputedStyle(link)
      return { outline: style.outlineStyle, padding: style.paddingTop }
    })
    expect(ring.outline).not.toBe("none")
    expect(ring.padding).toBe("0px")
    await rules.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), `ce06-rules-focus-${width}-screen.png`) })
    await rules.blur()

    await capture(page, "ce06-poles", width)
    await shownNotice(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), `ce06-poles-${width}-screen.png`) })
    await expectNoSeriousAxeViolations(page)

    // A saw-log job has the line and no notice (CE-06 as drawn).
    await openV2(page, reviewPath(landingId, { product: "Saw logs", title: "Oak saw-log morning run" }))
    await expect(shownNotice(page)).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Before you publish" })).toContainText("Publishing is subject to the LogLoads Posting Rules.")
    await capture(page, "ce06-saw-logs", width)
    await expectNoSeriousAxeViolations(page)
  })
}

// CE-06 Dark (`319:4349` in `319:4333`). No theme switch ships yet, so the case sets data-theme="dark" on the shell
// root, the attribute the tokens' dark theme keys on (packages/ui tokens.css), and checks contrast with axe.
test("the dark theme: the notice and the Posting Rules line keep their contrast, at 390 px", async ({ page }) => {
  await page.setViewportSize(viewportFor(390))
  await signIn(page, LANDING)
  const landingId = await ownLandingId(page)
  const darken = () => page.evaluate(() => document.querySelectorAll(".ll-theme").forEach((element) => element.setAttribute("data-theme", "dark")))

  await openV2(page, reviewPath(landingId, { product: "Poles and pilings", title: "Douglas-fir poles, Hills Creek" }))
  await darken()
  await expect(page.locator(".ll-app")).toHaveAttribute("data-theme", "dark")
  await expect(shownNotice(page)).toContainText(POLES_BODY)
  await capture(page, "ce06-poles-dark", 390)
  await shownNotice(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shotsDir(), "ce06-poles-dark-390-screen.png") })
  await expectNoSeriousAxeViolations(page)
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the notice renders for the saved product and still follows the select", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, LANDING)
    const landingId = await ownLandingId(page)

    // Back on step 1 with a saved poles draft: the server shows its notice.
    await openV2(page, `${NEW_JOB}?${new URLSearchParams({ landingId, product: "Poles and pilings", step: "basics", title: "Douglas-fir poles, Hills Creek" })}`)
    await expect(shownNotice(page)).toHaveCount(1)
    await expect(shownNotice(page)).toContainText(POLES_BODY)

    // With no script running, CSS follows the select.
    await productSelect(page).selectOption("Other")
    await expect(shownNotice(page)).toContainText(OTHER_BODY)
    await productSelect(page).selectOption("Chips")
    await expect(shownNotice(page)).toHaveCount(0)
    await capture(page, "ce03b-no-js-chips", 390)

    // The review step is server-rendered too.
    await openV2(page, reviewPath(landingId, { product: "Other", productOther: "Treated fence posts", title: "Treated fence posts, Hills Creek" }))
    await expect(shownNotice(page)).toContainText(OTHER_BODY)
    await expect(page.getByRole("link", { name: "LogLoads Posting Rules" })).toHaveAttribute("href", "/posting-rules")
    await capture(page, "ce06-other-no-js", 390)
  })
})
