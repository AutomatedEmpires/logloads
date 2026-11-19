import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * The V2 job editor against the approved page 03 Create and edit frames (#431, follow-up to #422): three steps, as
 * CE-03 "The job" (390 `58:2523`, 768 `156:1626`, 1440 `58:2377`; CE-03b Other `359:5109`), CE-04 "Pay and trucks"
 * (`58:2836`, `156:1751`, `58:2715`), CE-05 field errors (`58:3230`, `156:1901`, `58:3043`) and CE-06 "Review and publish"
 * (`58:3714`, `156:1999`, `58:3495`), at 390, 768 and 1440 px. Every screen is checked with axe (no serious or critical
 * issue). It also walks back from the review to edit the draft (edit versus new), and checks the Other-only
 * description without JavaScript.
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs). It signs in as Summit Ridge
 * Timber's owner, a landing that can post jobs, and only reads: it never presses Publish, and the pilot store cannot
 * publish anyway. Screenshots go to apps/web/tests/test-results/job-editor-frames (ignored by Git).
 */

const LANDING = "cole@summit.example"
const NEW_JOB = "/v2/landing/jobs/new"
const PREVIEW = "/v2/landing/jobs/preview"
const TITLE = "Oak saw-log morning run"

const shotsDir = () => join(test.info().project.testDir, "test-results", "job-editor-frames")
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

/** The step line the frames draw: "Step N of 3 · Label", as the step's heading. */
const stepHeading = (page: Page) => page.locator("[data-ds-page='job-editor'] h2").first()
const describeField = (page: Page) => page.locator("input#productOther")
const next = (page: Page) => page.getByRole("button", { exact: true, name: "Next" })

async function capture(page: Page, name: string, width: number) {
  // The full page without the bottom tabs and with the bottom bar in the flow at the end of the form, as the frames
  // draw a whole page (a sticky bar would otherwise cover what sits under it); then the screen as the browser shows it.
  await page.screenshot({
    fullPage: true,
    path: join(shotsDir(), `${name}-${width}.png`),
    style: ".ll-app > nav { display: none !important; } form > div:last-child { position: static !important; }"
  })
  await page.screenshot({ path: join(shotsDir(), `${name}-${width}-screen.png`) })
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

/** The step's progress bar fill, as a share of its track. */
async function progressShare(page: Page): Promise<number> {
  return page.locator("[data-job-progress]").evaluate((track) => {
    const fill = track.firstElementChild as HTMLElement
    return Math.round((fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100)
  })
}

for (const width of [390, 768, 1440]) {
  test(`the three steps, the field errors and going back to edit, as the page 03 frames draw them, at ${width} px`, async ({ page }) => {
    await page.setViewportSize(viewportFor(width))
    await signIn(page, LANDING)

    // CE-03, a new job: step 1 of 3, the frame's product hint, and no description until Other is chosen.
    await openV2(page, NEW_JOB)
    await expect(stepHeading(page)).toHaveText("Step 1 of 3 · The job")
    expect(await progressShare(page)).toBe(30)
    await expect(page.locator("#product-hint")).toHaveText("Haulers filter jobs by product.")
    await expect(describeField(page)).toBeHidden()
    const required = page.getByRole("list", { name: "What's required" }).getByRole("listitem")
    await expect(required).toHaveText([/^The job/, /^Pay and trucks/, /^Review and publish/])
    // The one primary action: a 56 px Next in the bottom bar.
    expect(Math.round((await next(page).boundingBox())!.height)).toBe(56)
    await capture(page, "ce03-new", width)
    await expectNoSeriousAxeViolations(page)

    await page.locator("input#title").fill(TITLE)
    await page.locator("select#product").selectOption("Other")
    await expect(describeField(page)).toBeVisible()
    await describeField(page).fill("Treated fence posts")
    await capture(page, "ce03b-other", width)
    await page.locator("select#product").selectOption("Saw logs")
    await expect(describeField(page)).toBeHidden()
    await page.locator("select#landingId").selectOption({ index: 1 })
    await page.locator("input#destinationLabel").fill("Cascade Mill · Springfield, OR")
    await page.locator("input#estOneWayMiles").fill("38")
    await capture(page, "ce03-filled", width)
    await next(page).click()

    // CE-04: pay and trucks, with the truck and trailer on the same step.
    await page.waitForURL((url) => url.searchParams.get("step") === "pay")
    await expect(stepHeading(page)).toHaveText("Step 2 of 3 · Pay and trucks")
    expect(await progressShare(page)).toBe(70)
    await expect(page.getByRole("group", { name: "Truck and trailer" })).toBeVisible()
    await capture(page, "ce04", width)
    await expectNoSeriousAxeViolations(page)

    // CE-05: Next with no pay and no truck type keeps the step, says what to fix and keeps the draft.
    await next(page).click()
    await page.waitForURL((url) => url.searchParams.get("from") === "pay" && url.searchParams.get("step") === "review")
    await expect(stepHeading(page)).toHaveText("Step 2 of 3 · Pay and trucks")
    await expect(page.getByRole("alert").first()).toContainText("highlighted fields to continue. Your draft is kept.")
    await expect(page.locator("#payUnit-error")).toBeVisible()
    await expect(page.locator("#equipment-error")).toBeVisible()
    await capture(page, "ce05-errors", width)
    await expectNoSeriousAxeViolations(page)

    await page.locator("select#payUnit").selectOption("per_load")
    await page.locator("input#payAmount").fill("525")
    await page.locator("input#trucksRequested").fill("6")
    await page.locator("input#trucksPerDay").fill("3")
    await page.locator("input#startsOn").fill("2026-12-01")
    await page.locator("input#durationDays").fill("10")
    await page.getByRole("checkbox", { exact: true, name: "Log truck" }).check()
    await next(page).click()

    // CE-06: the review, step 3 of 3, with the "Before you publish" legend in 16 px regular.
    await page.waitForURL((url) => url.pathname === PREVIEW)
    await expect(stepHeading(page)).toHaveText("Step 3 of 3 · Review and publish")
    expect(await progressShare(page)).toBe(91)
    const legend = page.getByRole("group", { name: "Before you publish" }).locator("legend")
    expect(await legend.evaluate((element) => [getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight])).toEqual(["16px", "400"])
    await expect(page.getByRole("group", { name: "Before you publish" })).toContainText("Publishing is subject to the LogLoads Posting Rules.")
    // The bar holds one 56 px Publish job, and the <noscript> fallback stays hidden text while scripts run.
    const publishForm = page.locator("form#job-publish-form")
    expect(await publishForm.innerText()).not.toContain("<button")
    expect(Math.round((await page.getByRole("button", { name: "Publish job" }).boundingBox())!.height)).toBe(56)
    await capture(page, "ce06", width)
    await legend.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shotsDir(), `ce06-publish-${width}-screen.png`) })
    await expectNoSeriousAxeViolations(page)

    // Edit versus new: Back from the review reopens step 2 with the draft, and "The job" reopens step 1 with it.
    await page.getByRole("link", { exact: true, name: "Back" }).click()
    await page.waitForURL((url) => url.pathname === NEW_JOB && url.searchParams.get("step") === "pay")
    await expect(page.locator("input#payAmount")).toHaveValue("525")
    await expect(page.getByRole("checkbox", { exact: true, name: "Log truck" })).toBeChecked()
    await page.getByRole("list", { name: "What's required" }).getByRole("link", { name: "The job" }).click()
    await page.waitForURL((url) => url.searchParams.get("step") === "basics")
    await expect(page.locator("input#title")).toHaveValue(TITLE)
    await expect(page.getByRole("list", { name: "What's required" }).getByRole("listitem").first()).toContainText("(done)")
    await capture(page, "ce03-edit", width)
    await expectNoSeriousAxeViolations(page)
  })
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("Describe the product shows for a saved Other and follows the select through CSS", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, LANDING)

    await openV2(page, `${NEW_JOB}?${new URLSearchParams({ product: "Other", productOther: "Treated fence posts", step: "basics", title: TITLE })}`)
    await expect(describeField(page)).toBeVisible()
    await expect(describeField(page)).toHaveValue("Treated fence posts")
    await page.locator("select#product").selectOption("Chips")
    await expect(describeField(page)).toBeHidden()
    await page.locator("select#product").selectOption("Other")
    await expect(describeField(page)).toBeVisible()
    await capture(page, "ce03b-other-no-js", 390)

    // The review without scripts: the <noscript> Publish job fills the bar at 56 px (unavailable on the pilot store).
    const landingId = await page.locator("select#landingId option").nth(1).getAttribute("value")
    const draft = { durationDays: "10", equipment: "log_truck", landingId: landingId!, payAmount: "525", payUnit: "per_load", product: "Saw logs", startsOn: "2026-12-01", title: TITLE, trucksRequested: "6" }
    await openV2(page, `${PREVIEW}?${new URLSearchParams(draft)}`)
    await expect(stepHeading(page)).toHaveText("Step 3 of 3 · Review and publish")
    const publish = page.getByRole("button", { name: "Publish job" })
    await expect(publish).toBeVisible()
    expect(Math.round((await publish.boundingBox())!.height)).toBe(56)
    await capture(page, "ce06-no-js", 390)
  })
})
