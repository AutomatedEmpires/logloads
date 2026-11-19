import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * The privacy request form (#424, LL-UI06) in the browser: Figma 04 Settings (#336) form `362:5445` / `362:5831`,
 * nothing chosen `362:5995` / `362:6352`, offline `362:7013` / `362:7371` and dark `362:7546`, at 390 and 1440 px.
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs). It writes nothing: until #415
 * builds the store, `privacyRequestStore()` is null, so every send answers that nothing was sent and gives the email
 * address. That unavailable answer is what these cases check, along with the error summary, the offline banner, a
 * signed-out send and the privacy promise: nothing the person types, and not their address, goes in any URL. The sent
 * screen needs a store; its words and dates are covered by app/v2/privacy-request/_lib/privacy-request-form.test.tsx.
 */

const HANK = { email: "hank@northpine.example" }
const WORDS = "Please delete the old phone number on my account."
const PATH = "/v2/privacy-request"
const WIDTHS = [390, 1440] as const

/** apps/web/tests/test-results/privacy-request, wherever Playwright was started from (ignored by Git). */
const shotsDir = () => join(test.info().project.testDir, "test-results", "privacy-request")
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

async function openV2(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator(".ll-app #main")).toBeVisible()
}

/** Every request the page makes, so a case can check that nothing typed or personal went in a URL. */
function recordUrls(page: Page): string[] {
  const urls: string[] = []
  page.on("request", (request) => urls.push(request.url()))
  return urls
}

function expectNothingPrivateIn(urls: readonly string[], email: string) {
  const words = [WORDS, encodeURIComponent(WORDS), WORDS.replace(/ /g, "+"), email, encodeURIComponent(email)]
  for (const url of urls) for (const word of words) expect(url, `a request URL carries ${word}`).not.toContain(word)
}

/** Serious and critical axe findings, at WCAG 2.2 AA, with the viewport grown so no sticky bar covers a control. */
async function expectNoSeriousAxeViolations(page: Page) {
  const viewport = page.viewportSize()
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  if (viewport && pageHeight > viewport.height) await page.setViewportSize({ height: pageHeight, width: viewport.width })

  const results = await new AxeBuilder({ page }).include(".ll-app").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()

  if (viewport) await page.setViewportSize(viewport)
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 5).map((node) => node.target.join(" ")).join(" | ")}`)

  expect(blocking, "serious or critical axe violations").toEqual([])
}

async function expectNoHorizontalOverflow(page: Page) {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

/** Every control a finger presses is at least 44 by 44 px (quality bar A3). */
async function expectTouchTargets(page: Page) {
  const form = page.locator("[data-ds-page='privacy-request']")
  const targets = [...(await form.locator("label:has(input[type='radio'])").all()), ...(await form.getByRole("button").all()), ...(await form.locator("a[data-variant]").all())]

  expect(targets.length).toBeGreaterThan(0)
  for (const target of targets) {
    const box = await target.boundingBox()
    expect(box, "a visible target").not.toBeNull()
    expect(box!.height, `${await target.textContent()} is 44 px tall or more`).toBeGreaterThanOrEqual(44)
    expect(box!.width, `${await target.textContent()} is 44 px wide or more`).toBeGreaterThanOrEqual(44)
  }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ fullPage: true, path: join(shotsDir(), `${name}.png`) })
}

const form = (page: Page) => page.locator("[data-ds-page='privacy-request'] form")
const choice = (page: Page, title: string) => form(page).getByRole("radio", { name: title })
const details = (page: Page) => form(page).getByLabel("Details (optional)")
const send = (page: Page) => form(page).getByRole("button", { name: "Send request" })

test.describe("privacy request (#424)", () => {
  for (const width of WIDTHS) {
    test(`at ${width} px: the account menu leads here; nothing chosen, unavailable and a signed-out send keep the choice and words`, async ({ page }) => {
      const urls = recordUrls(page)
      await page.setViewportSize(viewportFor(width))
      await signIn(page, HANK.email)
      await openV2(page, "/v2/work")

      // The entry: the account menu, because V2 has no Account screen yet (the frames draw it there, 362:7717).
      await page.locator(".ll-app > header details summary").click()
      await page.locator(".ll-app > header details").getByRole("link", { name: "Make a privacy request" }).click()
      await page.waitForURL((url) => url.pathname === PATH)
      expect(new URL(page.url()).search).toBe("")
      await expect(page.getByRole("heading", { level: 1, name: "Privacy request" })).toBeVisible()
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)

      // Idle (362:5445 / 362:5831), with the honest notice while no store keeps requests.
      await expect(form(page).getByRole("radio")).toHaveCount(4)
      await expect(form(page).getByRole("note")).toContainText("Requests in the app aren't connected yet, so this form can't send one.")
      await expect(form(page)).toContainText("You're signed in as hank@northpine.example, so we know this request is yours. We answer within 45 days.")
      await expect(form(page).getByRole("link", { name: "support@logloads.com" }).first()).toHaveAttribute("href", "mailto:support@logloads.com")
      await expectNoHorizontalOverflow(page)
      await expectTouchTargets(page)
      await expectNoSeriousAxeViolations(page)
      await shot(page, `idle-${width}`)

      // Nothing chosen (362:5995 / 362:6352): the summary takes focus, the words stay, nothing is sent.
      await details(page).fill(WORDS)
      await send(page).click()
      const summary = form(page).getByRole("alert")
      await expect(summary).toHaveText("Choose one request so we know what to do. What you typed is kept.")
      await expect(summary).toBeFocused()
      await expect(details(page)).toHaveValue(WORDS)
      await expectNoSeriousAxeViolations(page)
      await shot(page, `nothing-chosen-${width}`)

      // Keyboard: the next stop after the summary is the first choice.
      await page.keyboard.press("Tab")
      await expect(choice(page, "See what LogLoads holds about me")).toBeFocused()

      // Unavailable: the send answers that nothing was sent, with the email address, and keeps both.
      await choice(page, "Delete my information").check()
      await send(page).click()
      const answer = form(page).getByRole("status").filter({ hasText: "nothing was sent" })
      await expect(answer).toContainText("Requests in the app aren't connected yet, so nothing was sent.")
      await expect(answer.getByRole("link", { name: "support@logloads.com" })).toHaveAttribute("href", "mailto:support@logloads.com")
      await expect(answer).toBeFocused()
      await expect(choice(page, "Delete my information")).toBeChecked()
      await expect(details(page)).toHaveValue(WORDS)
      await expect(page.getByText("Request sent")).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)
      await shot(page, `unavailable-${width}`)

      // Error: the sign-in ended before the send. The action's words, and the choice and words stay.
      await page.context().clearCookies()
      await send(page).click()
      const error = form(page).getByRole("alert")
      await expect(error).toContainText("Sign in to make a privacy request, or email support@logloads.com")
      await expect(error).toBeFocused()
      await expect(choice(page, "Delete my information")).toBeChecked()
      await expect(details(page)).toHaveValue(WORDS)
      await expectNoSeriousAxeViolations(page)
      await shot(page, `error-${width}`)

      expect(new URL(page.url()).search).toBe("")
      expectNothingPrivateIn(urls, HANK.email)
    })

    test(`at ${width} px: offline, the banner shows, the request waits with the choice and words, and goes once the signal is back`, async ({ context, page }) => {
      const urls = recordUrls(page)
      await page.setViewportSize(viewportFor(width))
      await signIn(page, HANK.email)
      await openV2(page, PATH)

      await choice(page, "Delete my information").check()
      await details(page).fill(WORDS)
      await context.setOffline(true)
      const banner = form(page).getByRole("status").filter({ hasText: "You're offline" })
      await expect(banner).toContainText("You're offline, so nothing can be sent yet. Your choice and details stay here.")

      await send(page).click()
      await expect(banner).toContainText("You're offline. Your request goes once the signal is back, and your choice and details stay here.")
      await expect(banner.getByRole("button", { name: "Retry" })).toBeVisible()
      await expect(choice(page, "Delete my information")).toBeChecked()
      await expect(details(page)).toHaveValue(WORDS)
      await expectTouchTargets(page)
      await expectNoSeriousAxeViolations(page)
      await shot(page, `offline-${width}`)

      // Back in range: the waiting request goes once; with no store yet it answers that nothing was sent.
      await context.setOffline(false)
      await expect(form(page).getByRole("status").filter({ hasText: "nothing was sent" })).toBeVisible()
      await expect(banner).toHaveCount(0)
      await expect(details(page)).toHaveValue(WORDS)
      expectNothingPrivateIn(urls, HANK.email)
    })
  }

  test("a visitor is asked to sign in and come back, or to email", async ({ page }) => {
    await page.context().clearCookies()
    await page.setViewportSize(viewportFor(390))
    await openV2(page, PATH)

    await expect(page.getByRole("heading", { name: "Sign in to make a privacy request" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute("href", "/sign-in?next=%2Fv2%2Fprivacy-request")
    await expect(page.locator("[data-ds-page='privacy-request'] form")).toHaveCount(0)
    await expectNoSeriousAxeViolations(page)
  })

  test("dark tokens at 390 px (362:7546): the form keeps its contrast", async ({ page }) => {
    // The app has no theme setting yet (FG04 Account draws one); this sets the tokens' dark theme on the shell.
    await page.setViewportSize(viewportFor(390))
    await signIn(page, HANK.email)
    await openV2(page, PATH)
    await page.locator(".ll-theme").first().evaluate((shell) => shell.setAttribute("data-theme", "dark"))

    await expectNoSeriousAxeViolations(page)
    await shot(page, "dark-390")
  })
})
