import { mkdirSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

/**
 * Flow C (#328, strategy P0-10 on #235): a landing answers an inquiry in 2 taps from the message, the approved
 * Figma 07 Flows frames C3 (`124:390`), C4 (`124:509`), C7 (`124:577`), C-offline (`124:609`), C-error (`124:641`)
 * and C-denied (`315:1506`), at 390 and 1440 px (C3 at 1440: `313:1254`).
 *
 * Held answers (#411, review of PR 401): until the server records an answer the page says it is waiting to send,
 * never that it was sent. The inbox sends the held answers of the inquiries that are not open and says what is
 * waiting. One whose minute ran out unseen is never sent the moment a page opens. A held answer belongs to the person
 * and business that held it, and sign-out clears them all.
 *
 * Runs with the design-system server (Marketplace V2 on, design-system.config.mjs), last in file order. Writes: New
 * River Hauling's inquiry with North Pine Logging (the design-system cases send it, or `newRiverInquiry` does when
 * this file runs alone) gets ready replies from North Pine, and the last case declines it for real, with a reason.
 * A decline is final, so that case runs last, and the file runs once per seeded state (CI and every local run start
 * from the seed: design-system.config.mjs). When the state has no open North Pine job the cases fail; they never skip.
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
/** Long enough for a held answer's rest-of-minute and, when its minute ran out unseen, the fresh one a page gives it. */
const TWO_HOLDS = "02:02"
const HELD_PREFIX = "logloads:flow-c:held:"
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
const heldInbox = (page: Page) => page.locator("[data-held-inbox]")
const accountMenu = (page: Page) => page.locator(".ll-app > header details")

/** The inbox without New River's inquiry open: its Closed tab. The inbox there sends held answers of other inquiries. */
const INBOX_ELSEWHERE = "/v2/landing/inquiries?tab=closed"

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
async function shoot(page: Page, name: string, width: number, focus = "[data-flow-c]") {
  await page.screenshot({ fullPage: true, path: join(shotsDir(), `${name}-${width}.png`), style: ".ll-app > nav { display: none !important; }" })
  await page.locator(focus).last().evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }))
  await page.screenshot({ path: join(shotsDir(), `${name}-${width}-screen.png`) })
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include(".ll-app #main").analyze()
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([])
}

/**
 * Every 44 px target the quality bar asks for (A3), on the controls inside flow C's own parts: buttons and links drawn
 * as buttons (`data-variant`). A link inside a sentence, such as the job card's title, is exempt (WCAG 2.5.8, inline).
 */
async function expectTouchTargets(page: Page) {
  const short = await page.evaluate(() =>
    [...document.querySelectorAll("[data-flow-c] button, [data-flow-c] a[data-variant]")]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => ({ box: element.getBoundingClientRect(), text: (element.textContent ?? "").trim().slice(0, 40) }))
      .filter(({ box }) => Math.min(box.width, box.height) + 0.5 < 44)
      .map(({ box, text }) => `${text} ${Math.round(box.width)}x${Math.round(box.height)}`)
  )
  expect(short, "44 px targets").toEqual([])
}

/** The held answers this phone keeps, by storage key. */
const heldKeys = (page: Page) => page.evaluate((prefix) => Object.keys(localStorage).filter((name) => name.startsWith(prefix)), HELD_PREFIX)

/** Every POST to the inbox fails, as with no signal or a server that is down, until `unroute`. */
async function failInboxPosts(page: Page) {
  await page.route("**/v2/landing/inquiries**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ body: "unavailable", status: 503 })
      return
    }
    await route.fallback()
  })
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
    // Fail, never skip (#411): a run with nothing to answer has tested nothing.
    expect(inquiryId, NO_INQUIRY).toBeTruthy()
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

      // Undo within the minute: nothing was sent, and the bar is back. While held it is waiting, never "sent" (#411).
      await readyBar(page).getByRole("button", { name: READY_YES }).click()
      const held = conversation(page).getByRole("status").filter({ hasText: "Reply waiting to send" })
      await expect(held).toContainText(`${NEW_RIVER.name} gets it in 1 minute. You can undo it until then.`)
      await expect(held).toContainText(READY_YES)
      await expect(conversation(page)).not.toContainText("Reply sent")
      await expect(readyBar(page)).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)
      await expectTouchTargets(page)
      await shoot(page, "c4-reply-held", width)
      await held.getByRole("button", { name: "Undo reply" }).click()
      await expect(readyBar(page).getByRole("button", { name: READY_YES })).toBeVisible()
      await page.clock.fastForward(HOLD)
      await expect(page).not.toHaveURL(/[?&]updated=/)
      await openV2(page, inquiryLink(inquiryId!))
      await expect(messages(page)).toHaveCount(before)

      // Tap 2: the ready reply. When the minute is up it goes, once, and only then does the page say it was sent.
      await taps.tap(readyBar(page).getByRole("button", { name: READY_YES }))
      await expect(conversation(page).getByRole("status").filter({ hasText: "Reply waiting to send" })).toBeVisible()
      await expect(conversation(page)).not.toContainText("Reply sent")
      await page.clock.fastForward(HOLD)
      await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
      await expect(messages(page)).toHaveCount(before + 1)
      await expect(messages(page).last()).toContainText(READY_YES)
      await expect(conversation(page).getByRole("status").filter({ hasText: `Reply sent to ${NEW_RIVER.name}.` })).toBeVisible()
      expect(taps.count, "flow C target: 2 taps from the message").toBe(2)
      await shoot(page, "c4-reply-sent", width)

      // Opening the page again sends nothing more, and nothing is left on the phone.
      await openV2(page, inquiryLink(inquiryId!))
      await expect(messages(page)).toHaveCount(before + 1)
      expect(await heldKeys(page)).toEqual([])
    })
  }

  test("a decline is held a minute with a reason to pick, shown in words, and Undo keeps the inquiry open (C7)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    const taps = tapCounter()

    await taps.open(page, inquiryLink(inquiryId!))
    await taps.tap(conversation(page).getByRole("link", { exact: true, name: "Decline" }))
    const dialog = page.getByRole("dialog", { name: "Decline this inquiry?" })
    await taps.tap(dialog.getByRole("button", { name: "Decline inquiry" }))

    const held = conversation(page).getByRole("status").filter({ hasText: "Decline waiting to send" })
    await expect(held).toContainText(`${NEW_RIVER.name} is told in 1 minute. Undo before then.`)
    await expect(conversation(page)).not.toContainText("Declined.")
    const reason = held.getByRole("button", { name: "We have enough trucks" })
    await reason.click()
    await expect(reason).toHaveAttribute("aria-pressed", "true")
    // Not by colour alone (#411, quality bar V4): a check mark on the chip and the reason in words.
    await expect(reason.locator("svg")).toHaveCount(1)
    await expect(held.getByRole("button", { name: "Wrong truck or trailer" }).locator("svg")).toHaveCount(0)
    await expect(held.getByText("Reason: We have enough trucks", { exact: true })).toBeVisible()
    await expectNoSeriousAxeViolations(page)
    await expectTouchTargets(page)
    await shoot(page, "c7-declined-held", 390)

    // A second press takes the reason back, and the words go with it.
    await reason.click()
    await expect(reason).toHaveAttribute("aria-pressed", "false")
    await expect(held).not.toContainText("Reason:")

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
    await expect(waiting).toContainText("Waiting to send")
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
    await failInboxPosts(page)

    await readyBar(page).getByRole("button", { name: READY_YES }).click()
    await page.clock.fastForward(HOLD)
    await conversation(page).getByRole("alert").getByRole("button", { name: "Change my reply" }).click()
    await expect(composer(page).locator("textarea")).toHaveValue(READY_YES)
    await page.unroute("**/v2/landing/inquiries**")

    // The words survive a reload: the composer keeps its draft on the phone (#288).
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page).locator("textarea")).toHaveValue(READY_YES)
  })

  test("a held reply that did not go is not sent unseen: the inbox says it is waiting, and opening it gives Undo first (#411)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    const before = await messages(page).count()

    // The send fails, as with poor signal before the tab is closed: the answer stays on the phone.
    await failInboxPosts(page)
    await readyBar(page).getByRole("button", { name: READY_YES }).click()
    await page.clock.fastForward(HOLD)
    await expect(conversation(page).getByRole("alert").filter({ hasText: "Your reply did not send" })).toBeVisible()
    await page.unroute("**/v2/landing/inquiries**")

    // Back on the inbox, elsewhere: it says what is waiting, with a way to stop it, and has not sent it.
    for (const width of [390, 1440]) {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, INBOX_ELSEWHERE)
      const waiting = heldInbox(page).getByRole("region", { name: "1 reply waiting to send" })
      await expect(waiting).toContainText(`Your reply to ${NEW_RIVER.name}`)
      await expect(waiting).toContainText(READY_YES)
      await expect(waiting).toContainText("It has not gone yet. It goes in 1 minute unless you stop it.")
      await expect(waiting.getByRole("button", { name: "Don’t send" })).toBeVisible()
      await expect(waiting.getByRole("link", { name: "Open inquiry" })).toHaveAttribute("href", new RegExp(`inquiry=${inquiryId}`))
      await expectNoSeriousAxeViolations(page)
      await expectTouchTargets(page)
      await shoot(page, "c-inbox-waiting", width, "[data-held-inbox]")
    }

    // Opening the thread does not send it either (the review's Monday-to-Thursday decline): the bar holds it, with Undo.
    await page.setViewportSize(viewportFor(390))
    await openV2(page, inquiryLink(inquiryId!))
    const held = conversation(page).getByRole("status").filter({ hasText: "Reply waiting to send" })
    await expect(held).toContainText(`It has not gone yet. ${NEW_RIVER.name} gets it in 1 minute.`)
    await expect(held.getByRole("button", { name: "Undo reply" })).toBeVisible()
    await expect(messages(page)).toHaveCount(before)
    await expect(heldInbox(page).getByRole("region")).toHaveCount(0)
    await shoot(page, "c4-reply-reopened", 390)

    // Then it goes, once.
    await page.clock.fastForward(TWO_HOLDS)
    await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
    await expect(messages(page)).toHaveCount(before + 1)
    expect(await heldKeys(page)).toEqual([])
  })

  test("the inbox sends a held reply from another inquiry once its minute is up, without leaving the page (#411)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    const before = await messages(page).count()
    const second = readyBar(page).getByRole("button").nth(1)
    const words = (await second.innerText()).trim()

    await failInboxPosts(page)
    await second.click()
    await page.clock.fastForward(HOLD)
    await expect(conversation(page).getByRole("alert")).toBeVisible()
    await page.unroute("**/v2/landing/inquiries**")

    await openV2(page, INBOX_ELSEWHERE)
    await expect(heldInbox(page).getByRole("region", { name: "1 reply waiting to send" })).toContainText(words)
    await page.clock.fastForward(TWO_HOLDS)

    // Sent in place: announced, gone from the list, and the page did not move.
    await expect(heldInbox(page).getByRole("status")).toHaveText(`Reply sent to ${NEW_RIVER.name}.`)
    await expect(heldInbox(page).getByRole("region")).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]tab=closed/)
    await expect(page).not.toHaveURL(/[?&](updated|inquiry)=/)
    await expectNoSeriousAxeViolations(page)
    await shoot(page, "c-inbox-sent", 390, "[data-held-inbox]")
    expect(await heldKeys(page)).toEqual([])

    await openV2(page, inquiryLink(inquiryId!))
    await expect(messages(page)).toHaveCount(before + 1)
    await expect(messages(page).last()).toContainText(words)
    await openV2(page, INBOX_ELSEWHERE)
    await page.clock.fastForward(TWO_HOLDS)
    await openV2(page, inquiryLink(inquiryId!))
    await expect(messages(page), "sent once").toHaveCount(before + 1)
  })

  test("a colleague's held decline on this computer is never sent under this person's name, and sign-out clears it (#411)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    await conversation(page).getByRole("link", { exact: true, name: "Decline" }).click()
    await page.getByRole("dialog", { name: "Decline this inquiry?" }).getByRole("button", { name: "Decline inquiry" }).click()
    const held = conversation(page).getByRole("status").filter({ hasText: "Decline waiting to send" })
    await expect(held).toBeVisible()
    const [record] = await page.evaluate(
      (prefix) => Object.keys(localStorage).filter((name) => name.startsWith(prefix)).map((name) => ({ name, value: localStorage.getItem(name)! })),
      HELD_PREFIX
    )
    expect(record, "the held decline is on the phone").toBeDefined()
    await held.getByRole("button", { exact: true, name: "Undo" }).click()
    await expect(composer(page)).toHaveCount(1)

    // Another person of North Pine held that decline on this computer and closed the tab: the same record, their name.
    const colleague = "99999999-9999-4999-8999-999999999999"
    await page.evaluate(
      ({ prefix, other, saved }) => {
        const [, organization, interest] = saved.name.slice(prefix.length).split(":")
        const theirs = { ...(JSON.parse(saved.value) as Record<string, unknown>), heldBy: other }
        localStorage.setItem(`${prefix}${other}:${organization}:${interest}`, JSON.stringify(theirs))
      },
      { other: colleague, prefix: HELD_PREFIX, saved: record! }
    )

    // This person opens the inquiry: nothing of the colleague's shows, and nothing goes.
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page)).toHaveCount(1)
    await expect(heldInbox(page).getByRole("region")).toHaveCount(0)
    await page.clock.fastForward(TWO_HOLDS)
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page), "the colleague's decline was not sent").toHaveCount(1)
    await expect(page.getByRole("log")).not.toContainText("You declined this inquiry.")

    // Sign-out leaves no held answer on the phone; the server refused to send the colleague's.
    expect(await heldKeys(page)).toHaveLength(1)
    await accountMenu(page).locator("summary").click()
    await accountMenu(page).getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/")
    expect(await heldKeys(page)).toEqual([])

    await signIn(page, NORTH_PINE.landing)
    await openV2(page, inquiryLink(inquiryId!))
    await expect(composer(page), "still open after sign-out").toHaveCount(1)
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

  // Last: a decline is final, so nothing after this needs the inquiry open.
  test("a held decline goes when its minute is up, with the picked reason, and the hauler sees that reason once (C7, #411)", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, NORTH_PINE.landing)
    await page.clock.install()
    await openV2(page, inquiryLink(inquiryId!))
    const reasonText = "Wrong truck or trailer"

    await conversation(page).getByRole("link", { exact: true, name: "Decline" }).click()
    await page.getByRole("dialog", { name: "Decline this inquiry?" }).getByRole("button", { name: "Decline inquiry" }).click()
    const held = conversation(page).getByRole("status").filter({ hasText: "Decline waiting to send" })
    await held.getByRole("button", { name: reasonText }).click()
    await expect(held.getByText(`Reason: ${reasonText}`, { exact: true })).toBeVisible()
    await expectNoSeriousAxeViolations(page)
    await shoot(page, "c7-declined-held", 1440)

    // The minute ends; the decline and its reason go once, and only now does the page say it was declined.
    await page.clock.fastForward(HOLD)
    await page.waitForURL((url) => url.searchParams.get("updated") === "declined" && url.searchParams.get("inquiry") === inquiryId)
    await expect(conversation(page).getByRole("status").filter({ hasText: `Declined. ${NEW_RIVER.name} can see it.` })).toBeVisible()
    await expect(page.getByRole("log")).toContainText("You declined this inquiry.")
    await expect(messages(page).filter({ hasText: reasonText })).toHaveCount(1)
    await expect(composer(page)).toHaveCount(0)
    // Delivered: the closed inquiry has no reply bar, so the inbox settles it rather than offering it again.
    await expect(heldInbox(page).getByRole("region")).toHaveCount(0)
    await expect.poll(() => heldKeys(page)).toEqual([])
    await expectNoSeriousAxeViolations(page)
    await shoot(page, "c7-declined-sent", 1440)

    // Opening it again sends nothing more.
    await openV2(page, inquiryLink(inquiryId!))
    await expect(messages(page).filter({ hasText: reasonText })).toHaveCount(1)

    // The hauler sees the landing's reason, once, and that the landing closed the inquiry.
    await signIn(page, NEW_RIVER.email)
    await openV2(page, `/v2/inquiries?inquiry=${inquiryId}#conversation`)
    await expect(page.getByRole("log")).toContainText("The landing declined this inquiry.")
    await expect(messages(page).filter({ hasText: reasonText })).toHaveCount(1)
  })
})
