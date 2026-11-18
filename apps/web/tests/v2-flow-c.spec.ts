import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

/**
 * Flow C (#328, strategy P0-10 on #235): a landing answers an inquiry in 2 taps from the message, the approved
 * Figma 07 Flows frames C3 (`124:390`), C4 (`124:509`), C7 (`124:577`), C-offline (`124:609`), C-error (`124:641`)
 * and C-denied (`315:1506`), at 390 and 1440 px (C3 at 1440: `313:1254`).
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs), last in file order. Writes: New
 * River Hauling's inquiry with North Pine Logging (the design-system cases send it, or `newRiverInquiry` does when
 * this file runs alone) gets ready replies from North Pine. Nothing here declines or withdraws: the decline case
 * stops at Undo, so every case can run again on the same state.
 *
 * Tap counting follows the frames' notes: opening the inquiry link in the email (or the text, once texts are on) is
 * tap 1, and pressing an answer is tap 2. The one-minute hold for Undo is the page's own timer; the cases move the
 * page's clock past it instead of waiting.
 */

const NEW_RIVER = { email: "emptyfleet@logloads.example", name: "New River Hauling" }
const NORTH_PINE = { landing: "dispatch@northpine.example", name: "North Pine Logging" }
/** Summit Ridge Timber: a landing business of its own, so North Pine's inquiry is not its to open. */
const OTHER_LANDING = "cole@summit.example"

const READY_YES = "Yes, we can use you."
const HOLD = "01:01"
/** apps/web/tests/test-results/flow-c, wherever Playwright was started from (ignored by Git). */
const shotsDir = () => join(test.info().project.testDir, "test-results", "flow-c")
const NO_INQUIRY = "No North Pine Logging job accepts interest in this run's state, so New River Hauling has no inquiry to answer"

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

const jobRows = (page: Page) => page.locator("[data-ds-page] ul[aria-label='Jobs'] > li")
const inquiryRows = (page: Page) => page.locator("#main [data-ds-page] ul[aria-label$='inquiries'] > li")
const conversation = (page: Page) => page.locator("#conversation")
const readyBar = (page: Page) => page.getByRole("group", { name: "Reply in one tap" })
const composer = (page: Page) => page.locator("form:has(textarea[aria-label^='Reply to'])")
const messages = (page: Page) => page.getByRole("log").locator("li")

/**
 * The id of New River Hauling's inquiry with North Pine Logging, sending New River's interest in North Pine's first
 * open job when it has none. Null when no North Pine job accepts interest.
 */
async function newRiverInquiry(page: Page): Promise<string | null> {
  await signIn(page, NEW_RIVER.email)
  await openV2(page, "/v2/inquiries")
  let row = inquiryRows(page).filter({ hasText: NORTH_PINE.name }).first()

  if ((await row.count()) === 0) {
    await openV2(page, "/v2/work")
    const link = jobRows(page).filter({ hasText: NORTH_PINE.name }).first().locator("h3 a")
    if ((await link.count()) === 0) return null

    await openV2(page, (await link.getAttribute("href"))!)
    const form = page.locator("form:has(input[name='loadPostingId'])")
    await expect(form, "New River Hauling can express interest in an open job").toHaveCount(1)
    await form.getByLabel("Message").fill("Can run 3 loads a day. Have my own binders.")
    await form.getByRole("button", { name: "Send interest" }).click()
    await expect(page).toHaveURL(/[?&]sent=1/)
    await openV2(page, "/v2/inquiries")
    row = inquiryRows(page).filter({ hasText: NORTH_PINE.name }).first()
  }

  const href = await row.getByRole("link").first().getAttribute("href")
  return /[?&]inquiry=([0-9a-f-]{36})/i.exec(href ?? "")?.[1] ?? null
}

/** The link the inquiry email carries for a signed-in landing: the inbox with this inquiry open. */
const inquiryLink = (id: string) => `/v2/landing/inquiries?inquiry=${id}#conversation`

/** Counts the person's taps. Opening the inquiry link from the message is the first. */
function tapCounter() {
  let taps = 0
  return {
    async open(page: Page, path: string) {
      taps += 1
      await openV2(page, path)
    },
    async tap(target: Locator) {
      taps += 1
      await target.click()
    },
    get count() {
      return taps
    }
  }
}

/**
 * The whole page, without the fixed bottom tabs (a stitched capture would draw them over the middle of the page),
 * and the screen as the phone shows it, scrolled to flow C's last part (the bar, the held answer or the panel).
 */
async function shoot(page: Page, name: string, width: number) {
  await page.screenshot({ fullPage: true, path: join(shotsDir(), `${name}-${width}.png`), style: ".ll-app > nav { display: none !important; }" })
  await page.locator("[data-flow-c]").last().evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }))
  await page.screenshot({ path: join(shotsDir(), `${name}-${width}-screen.png`) })
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include(".ll-app #main").analyze()
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([])
}

/** The field floors of field-conditions.spec.ts (#327) on this page: 16 px body, 48 and 56 px targets, no side scroll. */
async function expectFieldFloors(page: Page) {
  const report = await page.evaluate(() => {
    const app = document.querySelector(".ll-app")
    if (!app) throw new Error("missing .ll-app")
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }
    const shortTargets: string[] = []
    for (const element of document.querySelectorAll(
      ".ll-app button, .ll-app [role='button'], .ll-app select, .ll-app textarea, .ll-app input:not([type='hidden']):not([type='checkbox']):not([type='radio']), .ll-app > nav a"
    )) {
      if (!visible(element)) continue
      const box = element.getBoundingClientRect()
      const floor = element.getAttribute("data-size") === "lg" ? 56 : 48
      if (Math.min(box.width, box.height) + 0.5 < floor) {
        shortTargets.push(`${element.tagName.toLowerCase()} ${(element.textContent ?? "").trim().slice(0, 40)} ${Math.round(box.width)}x${Math.round(box.height)} needs ${floor}`)
      }
    }
    const small: string[] = []
    // Flow C's own parts (`data-flow-c`) and the offer's facts; the thread's date lines are the shared component's.
    for (const element of document.querySelectorAll("[data-flow-c] p, [data-flow-c] button, [data-flow-c] blockquote, #conversation dd")) {
      if (!visible(element) || !(element.textContent ?? "").trim()) continue
      const size = parseFloat(getComputedStyle(element).fontSize)
      if (size < 16) small.push(`${element.tagName.toLowerCase()} ${(element.textContent ?? "").trim().slice(0, 40)} ${size}px`)
    }
    // The card clips what overflows it, so the page never scrolls sideways; nothing may run past its edges either.
    const clipped: string[] = []
    const frame = document.querySelector("#conversation")?.getBoundingClientRect()
    if (frame) {
      for (const element of document.querySelectorAll("#conversation *")) {
        if (!visible(element)) continue
        const box = element.getBoundingClientRect()
        if (box.right > frame.right + 0.5 || box.left < frame.left - 0.5) {
          clipped.push(`${element.tagName.toLowerCase()} ${(element.textContent ?? "").trim().slice(0, 30)} ${Math.round(box.left)}-${Math.round(box.right)}`)
        }
      }
    }
    return {
      bodyPx: parseFloat(getComputedStyle(app).fontSize),
      clipped: clipped.slice(0, 5),
      scroll: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      shortTargets,
      small
    }
  })

  expect(report.clipped, "nothing runs past the conversation card").toEqual([])
  expect(report.bodyPx, "body text").toBeGreaterThanOrEqual(16)
  expect(report.shortTargets, "48 px targets, 56 px primary").toEqual([])
  expect(report.small, "16 px text in the conversation").toEqual([])
  expect(report.scroll.scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(report.scroll.clientWidth + 1)
}

test.describe("flow C: a landing answers an inquiry (#328)", () => {
  let inquiryId: string | null = null

  test.beforeEach(async ({ page }) => {
    if (!inquiryId) inquiryId = await newRiverInquiry(page)
    test.skip(!inquiryId, NO_INQUIRY)
  })

  for (const width of [390, 1440]) {
    test(`a ready reply is 2 taps from the message, held a minute for Undo, then sent once, at ${width} px`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await signIn(page, NORTH_PINE.landing)
      await page.clock.install()
      const taps = tapCounter()

      // Tap 1: the inquiry link. The thread, what they can bring and the reply bar are there (C3).
      await taps.open(page, inquiryLink(inquiryId!))
      await expect(conversation(page).getByRole("heading", { level: 2, name: NEW_RIVER.name })).toBeVisible()
      await expect(conversation(page).getByRole("heading", { name: "They can bring" })).toBeVisible()
      await expect(readyBar(page).getByRole("button")).toHaveCount(2)
      await expect(composer(page)).toHaveCount(1)
      await expectNoSeriousAxeViolations(page)
      await shoot(page, "c3-thread", width)
      const before = await messages(page).count()

      // Undo within the minute: nothing was sent, and the bar is back.
      await readyBar(page).getByRole("button", { name: READY_YES }).click()
      const held = conversation(page).getByRole("status").filter({ hasText: "Reply sent" })
      await expect(held).toContainText("You can undo it for the next minute.")
      await expect(held).toContainText(READY_YES)
      await expect(readyBar(page)).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)
      await shoot(page, "c4-reply-held", width)
      await held.getByRole("button", { name: "Undo reply" }).click()
      await expect(readyBar(page).getByRole("button", { name: READY_YES })).toBeVisible()
      await page.clock.fastForward(HOLD)
      await expect(page).not.toHaveURL(/[?&]updated=/)
      await openV2(page, inquiryLink(inquiryId!))
      await expect(messages(page)).toHaveCount(before)

      // Tap 2: the ready reply. When the minute is up it goes, once, and the thread shows it.
      await taps.tap(readyBar(page).getByRole("button", { name: READY_YES }))
      await expect(conversation(page).getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible()
      await page.clock.fastForward(HOLD)
      await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
      await expect(messages(page)).toHaveCount(before + 1)
      await expect(messages(page).last()).toContainText(READY_YES)
      await expect(conversation(page).getByRole("status").filter({ hasText: `Reply sent to ${NEW_RIVER.name}.` })).toBeVisible()
      expect(taps.count, "flow C target: 2 taps from the message").toBe(2)
      await shoot(page, "c4-reply-sent", width)

      // Opening the page again sends nothing more.
      await openV2(page, inquiryLink(inquiryId!))
      await expect(messages(page)).toHaveCount(before + 1)
    })
  }

  test("a decline is held a minute with a reason to pick, and Undo keeps the inquiry open (C7)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    const taps = tapCounter()

    await taps.open(page, inquiryLink(inquiryId!))
    await taps.tap(conversation(page).getByRole("link", { exact: true, name: "Decline" }))
    const dialog = page.getByRole("dialog", { name: "Decline this inquiry?" })
    await taps.tap(dialog.getByRole("button", { name: "Decline inquiry" }))

    const held = conversation(page).getByRole("status").filter({ hasText: "Declined" })
    await expect(held).toContainText(`${NEW_RIVER.name} is told in 1 minute. Undo before then.`)
    const reason = held.getByRole("button", { name: "We have enough trucks" })
    await reason.click()
    await expect(reason).toHaveAttribute("aria-pressed", "true")
    await expectNoSeriousAxeViolations(page)
    await shoot(page, "c7-declined-held", 390)

    // The frame counts 2 taps; the Decline Dialog the design-system suite pins (#287) adds the confirm, so 3.
    expect(taps.count).toBe(3)

    await held.getByRole("button", { exact: true, name: "Undo" }).click()
    await expect(composer(page)).toHaveCount(1)
    await page.clock.fastForward(HOLD)
    await expect(page).not.toHaveURL(/[?&]updated=/)
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page), "Undo kept the inquiry open").toHaveCount(1)
    await expect(page.getByRole("log")).not.toContainText("You declined this inquiry.")
  })

  test("offline: the reply waits on the phone and goes once when the signal is back (C-offline)", async ({ page, context }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    const before = await messages(page).count()
    const second = readyBar(page).getByRole("button").nth(1)
    const words = (await second.innerText()).trim()

    await context.setOffline(true)
    await second.click()
    await page.clock.fastForward(HOLD)
    const waiting = conversation(page).getByRole("status").filter({ hasText: "Your reply is saved." })
    await expect(waiting).toContainText("We send it once when you are back in range.")
    await expect(waiting).toContainText(words)
    await expect(waiting.getByRole("button", { name: "Retry" })).toBeVisible()
    await shoot(page, "c-offline", 390)

    await context.setOffline(false)
    await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
    await expect(messages(page)).toHaveCount(before + 1)
    await expect(messages(page).last()).toContainText(words)
  })

  test("error: a reply that did not send is still there, and Send again sends it once (C-error)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    const before = await messages(page).count()

    // The server action's POST fails once.
    let failed = 0
    await page.route("**/v2/landing/inquiries**", async (route) => {
      if (route.request().method() === "POST" && failed === 0) {
        failed += 1
        await route.fulfill({ body: "unavailable", status: 503 })
        return
      }
      await route.fallback()
    })

    await readyBar(page).getByRole("button", { name: READY_YES }).click()
    await page.clock.fastForward(HOLD)
    const problem = conversation(page).getByRole("alert").filter({ hasText: "Your reply did not send" })
    await expect(problem).toContainText("It is still here. Try again.")
    await expect(problem).toContainText(READY_YES)
    await expectNoSeriousAxeViolations(page)
    await shoot(page, "c-error", 390)

    await problem.getByRole("button", { name: "Send again" }).click()
    await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
    await expect(messages(page)).toHaveCount(before + 1)
    expect(failed).toBe(1)
  })

  test("Change my reply puts the failed words in the composer, kept on the phone (C-error)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    await page.route("**/v2/landing/inquiries**", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ body: "unavailable", status: 503 })
        return
      }
      await route.fallback()
    })

    await readyBar(page).getByRole("button", { name: READY_YES }).click()
    await page.clock.fastForward(HOLD)
    await conversation(page).getByRole("alert").getByRole("button", { name: "Change my reply" }).click()
    await expect(composer(page).locator("textarea")).toHaveValue(READY_YES)
    await page.unroute("**/v2/landing/inquiries**")

    // The words survive a reload: the composer keeps its draft on the phone (#288).
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page).locator("textarea")).toHaveValue(READY_YES)
  })

  test("another business's inquiry link shows permission denied and nothing of the inquiry (C-denied)", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize(viewportFor(width))
      await signIn(page, OTHER_LANDING)
      await openV2(page, inquiryLink(inquiryId!))

      const denied = page.getByRole("region", { name: "You can’t open this inquiry" })
      await expect(denied).toBeVisible()
      await expect(denied).toContainText("Only that business’s owner, managers and staff can read it and reply.")
      await expect(denied.getByRole("link", { name: "Go to my home page" })).toHaveAttribute("href", "/v2/landing")
      await expect(page.locator("#main")).not.toContainText(NEW_RIVER.name)
      await expect(composer(page)).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)
      await shoot(page, "c-denied", width)
    }
  })

  test("without JavaScript a ready reply posts at once and the page comes back with it", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "reduce", viewport: viewportFor(390) })
    const page = await context.newPage()

    try {
      await signIn(page, NORTH_PINE.landing)
      await openV2(page, inquiryLink(inquiryId!))
      const before = await messages(page).count()

      await readyBar(page).getByRole("button", { name: READY_YES }).click()
      await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
      await expect(messages(page)).toHaveCount(before + 1)
    } finally {
      await context.close()
    }
  })

  test("the thread meets the field floors at 320 px", async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 320 })
    await signIn(page, NORTH_PINE.landing)
    await openV2(page, inquiryLink(inquiryId!))
    await expect(readyBar(page)).toBeVisible()
    await expectFieldFloors(page)
    await shoot(page, "c3-thread", 320)
  })
})
