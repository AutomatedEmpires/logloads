import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test"

/**
 * DS-05 (#148): responsive, keyboard and style-isolation regressions for the V2 design system, run against the
 * real app with Marketplace V2 enabled (design-system.config.mjs). Pages count as migrated when their root
 * carries `data-ds-page`; since DS-04 (#147) that is every V2 page and v2.css is gone. Cases that need a page or
 * data nobody has built yet are `test.fixme` with what they wait for, never faked.
 *
 * Writes: the conversation cases need an inquiry, and the seed has none. New River Hauling (a hauling business
 * with no trucks listed) expresses interest in the one public job, North Pine Logging's, and replies on it. Nothing
 * declines or withdraws; the no-JavaScript interest case posts once with a date range the server refuses, which
 * writes nothing. The equipment case signs in as Granite Creek Hauling (equipment listed) and submits one offer
 * above its listing, which the server refuses without writing. When no job accepts interest in the shared CI state
 * those cases are skipped with that reason, not passed.
 *
 * The business-switching case (#124 criterion 8, last in the file) needs a dual-membership account, which the seed
 * does not have. Through the app's own pages it makes Maya Mills (North Pine Logging driver) a Summit Ridge Timber
 * dispatcher, the same invitation the pilot journey invitations.spec.ts records, unless she already is one; Summit's
 * owner then removes that membership, and the case ends by inviting her back so she holds it again. Every step is
 * idempotent, so a retry or a state where the pilot journeys already seated her starts from the same place. Nothing
 * else in the suite writes, and those writes touch only Maya's Summit membership and Summit's invitations.
 */

const MATRIX = [1440, 1280, 1024, 768, 390] as const
const BP_LG = 960 // tokens BREAKPOINTS.lg: top navigation at and above, bottom tabs below
const BP_XL = 1200 // tokens BREAKPOINTS.xl: DetailPanel beside the list at and above

const viewportFor = (width: number) => ({ width, height: width < 768 ? 844 : 900 })

/** Fonts of the legacy app (globals.css --font-ui / --font-display); DS text must never resolve to them. */
const LEGACY_FONT = /\b(Archivo|Inter)\b/

test.beforeEach(async ({ page }) => {
  // `next dev` only (the local mode of this suite): hide the framework's dev-tools button so the tab order is the
  // production one. A production build has no such element, so this is a no-op in CI.
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

/**
 * Opens a V2 page and waits for the shell. No loading boundary sits above V2 (#174), so the server sends the page
 * itself and the legacy route skeleton never appears, with or without JavaScript.
 */
async function openV2(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator(".ll-app #main")).toBeVisible()
  await expect(page.locator(".route-skeleton")).toHaveCount(0)
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"))
}

/**
 * Gives the browser up to 15 s to finish the redirects that sign-in and accepting an invitation end with, so the
 * caller's next navigation does not race them. While a loading boundary sat above every route (before #174), those
 * redirects landed in the browser and a navigation started meanwhile was aborted (net::ERR_ABORTED, seen in CI).
 * It never fails: every caller opens the page it checks next with a full navigation.
 */
async function settleOnV2(page: Page) {
  await page
    .waitForURL((url) => url.pathname.startsWith("/v2/") && url.pathname !== "/v2/landing", { timeout: 15_000 })
    .catch(() => undefined)
}

async function signInToV2(page: Page, email: string) {
  await signIn(page, email)
  await settleOnV2(page)
}

const topNavigation = (page: Page) => page.locator(".ll-app > header nav[aria-label='Main']")
const bottomTabs = (page: Page) => page.locator(".ll-app > nav[aria-label='Main']")
/** The account menu at the end of the top bar (#124): a <details> disclosure whose <summary> is the trigger. */
const accountMenu = (page: Page) => page.locator(".ll-app > header details")
const accountTrigger = (page: Page) => accountMenu(page).locator("summary")
/** The trigger's tab-order key (its first text line; the "Preview" tag follows on its own line). */
const ACCOUNT_KEY = "Account"
const PREVIEW_NOTICE = "nothing here dispatches trucks, records loads or charges a fee"
const jobRows = (page: Page) => page.locator("[data-ds-page] ul[aria-label='Jobs'] > li")
/** Find work's summary bar (#129): its text states the search, and it opens the filter sheet. */
const findWorkSummary = (page: Page) => page.locator("#work-filters-summary")
const detailPanel = (page: Page) => page.locator("[data-ds-page='find-work'] aside[aria-label='Job details']")
const jobSheet = (page: Page) => page.getByRole("dialog", { name: "Job details" })

/** Seeded accounts for the conversation cases (packages/db seed). */
const NEW_RIVER = { email: "emptyfleet@logloads.example", name: "New River Hauling" } // hauling business, no trucks listed
const NORTH_PINE = { landing: "dispatch@northpine.example", name: "North Pine Logging" } // posts the seeded public job; a founder demo account
const NORTH_PINE_LANDING = NORTH_PINE.landing // North Pine Logging acting on its landing side
// Summit Ridge Timber: the suite never expresses interest in its jobs, so its inbox stays empty even when the pilot
// journeys have published one of them in the shared CI state.
const LANDING_WITHOUT_INQUIRIES = "cole@summit.example"
/**
 * Granite Creek Hauling (#178): a hauling business whose profile lists equipment, in the interest form's order
 * (most units first). The suite only reads its form and one refused offer; it never sends its interest.
 */
const GRANITE_CREEK = {
  email: "avery@granitecreek.example",
  setups: [
    { label: "Log truck + Bunk / short-log", units: 2 },
    { label: "Log truck + Pole trailer", units: 1 }
  ]
} as const
const NO_OPEN_JOB = "No North Pine Logging job accepts interest in this run's state (the shared CI state can have them filled or closed)"

/** Markup a hauler might type. It must reach every page as text: no element, no script. */
const MARKUP_NOTE = `<img src=x onerror="window.__llInjected=1"><b>bold</b> & "two trucks"`
const MARKUP_REPLY = `<script>window.__llInjected=2</script> Tuesday at 5 & Thursday`
/** The reply the no-JavaScript case sends. */
const PLAIN_FORM_REPLY = "Sent from a page without JavaScript: Wednesday at 6"

/**
 * /v2/work freshly loaded with at least one job row. In CI the state is shared with the pilot journeys, which can
 * fill or close the seeded jobs, so this falls back to every listing (`all=1`) when none is accepting interest.
 */
async function openFindWorkWithRows(page: Page) {
  await openV2(page, "/v2/work")
  if ((await jobRows(page).count()) > 0) return

  await openV2(page, "/v2/work?all=1")
  expect(await jobRows(page).count(), "the board lists at least one job").toBeGreaterThan(0)
}

/** The path of the first job on the board (any status), for the job page cases. */
async function firstJobPath(page: Page): Promise<string> {
  await openFindWorkWithRows(page)
  const href = await jobRows(page).first().locator("h3 a").getAttribute("href")
  expect(href).toMatch(/^\/v2\/work\/[^/]+$/)
  return href!
}

const inquiryRows = (page: Page) => page.locator("#main [data-ds-page] ul[aria-label$='inquiries'] > li")

/**
 * The title link of North Pine Logging's first job on the board. Every case that expresses interest uses it: in CI
 * the pilot journeys publish other businesses' jobs ahead of North Pine's, and New River's inquiry must reach North
 * Pine's inbox, never LANDING_WITHOUT_INQUIRIES'.
 */
const northPineJobLink = (page: Page) => jobRows(page).filter({ hasText: NORTH_PINE.name }).first().locator("h3 a")

/**
 * Signs in as New River Hauling and makes sure it has an inquiry with North Pine Logging, expressing interest in
 * North Pine's first job that accepts it (the note is MARKUP_NOTE) when it has none yet. Only North Pine's: in CI
 * the pilot journeys publish other businesses' jobs ahead of it on the board, and an inquiry there would leave
 * North Pine's inbox empty and fill LANDING_WITHOUT_INQUIRIES'. False when no North Pine job accepts interest.
 */
async function ensureNewRiverInquiry(page: Page): Promise<boolean> {
  await signIn(page, NEW_RIVER.email)
  await openV2(page, "/v2/inquiries")
  if ((await inquiryRows(page).filter({ hasText: NORTH_PINE.name }).count()) > 0) return true

  await openV2(page, "/v2/work")
  const link = northPineJobLink(page)
  if ((await link.count()) === 0) return false

  await openV2(page, (await link.getAttribute("href"))!)
  // With no inquiry yet and a job that accepts interest, the form must be there; anything else is a defect.
  const form = page.locator("form:has(input[name='loadPostingId'])")
  await expect(form, "New River Hauling can express interest in an open job").toHaveCount(1)

  await form.getByLabel("Message").fill(MARKUP_NOTE)
  await form.getByRole("button", { name: "Send interest" }).click()
  await expect(page).toHaveURL(/[?&]sent=1/)
  return true
}

/** At 1024 px and up the conversation sits beside the list; below, under it (06_DESIGN_SYSTEM.md §5). */
async function expectSplitLayout(page: Page, width: number) {
  const list = await page.locator("[data-layout='split'] > :nth-child(1)").boundingBox()
  const conversation = await page.locator("[data-layout='split'] > :nth-child(2)").boundingBox()

  expect(list && conversation, "the split layout has a list and a conversation").toBeTruthy()
  if (width >= 1024) {
    expect(conversation!.x, `${width} px: the conversation is beside the list`).toBeGreaterThanOrEqual(list!.x + list!.width - 1)
    expect(Math.abs(conversation!.y - list!.y), `${width} px: list and conversation start level`).toBeLessThan(2)
  } else {
    expect(conversation!.y, `${width} px: the conversation is under the list`).toBeGreaterThanOrEqual(list!.y + list!.height - 1)
  }
}

/** No horizontal page scroll, with the widest offenders named when it fails. */
async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement
    const limit = root.clientWidth
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > limit + 0.5)
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/).join(".")}`)

    return { clientWidth: limit, innerWidth: window.innerWidth, offenders, scrollWidth: root.scrollWidth }
  })
  const detail = `scrollWidth ${metrics.scrollWidth}, clientWidth ${metrics.clientWidth}, innerWidth ${metrics.innerWidth}; ${metrics.offenders.join(", ")}`

  expect(metrics.scrollWidth, detail).toBeLessThanOrEqual(metrics.innerWidth)
  expect(metrics.scrollWidth, detail).toBeLessThanOrEqual(metrics.clientWidth)
}

/** The displayed navigation for the width: top bar at bp-lg and up, bottom tabs below. Returns its item labels. */
async function expectNavigationForWidth(page: Page, width: number): Promise<string[]> {
  const shown = width >= BP_LG ? topNavigation(page) : bottomTabs(page)
  const hidden = width >= BP_LG ? bottomTabs(page) : topNavigation(page)

  await expect(shown).toBeVisible()
  await expect(hidden).toBeHidden()
  // Only one "Main" navigation landmark is exposed at a time.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1)

  return (await shown.getByRole("link").allInnerTexts()).map((label) => label.trim())
}

async function expectCurrent(page: Page, width: number, label: string | null) {
  const shown = width >= BP_LG ? topNavigation(page) : bottomTabs(page)
  const current = shown.locator("a[aria-current='page']")

  if (label === null) {
    await expect(current).toHaveCount(0)
    return
  }

  await expect(current).toHaveCount(1)
  await expect(current).toHaveText(label)
}

interface FocusStop {
  key: string
  where: "chrome" | "main" | "tabs" | "outside"
  /** Outline drawn on the element, or on its job row when the row draws the ring for its link. */
  ring: { style: string; width: number; color: string } | null
  dsRingColor: string | null
  /** Box-shadow layers that form a solid ring (no offset, no blur, positive spread): the legacy global halo. */
  haloShadows: string[]
}

/** The focused element: a stable key, where it sits in the shell, and how its focus ring is drawn. */
async function focusStop(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null

    if (!element || element === document.body) return null

    const theme = element.closest(".ll-theme")
    let dsRingColor: string | null = null

    if (theme) {
      const probe = document.createElement("span")
      probe.style.color = "var(--ll-focus-color)"
      theme.append(probe)
      dsRingColor = getComputedStyle(probe).color
      probe.remove()
    }

    const hosts = [element, element.closest("li")].filter((node): node is HTMLElement => node instanceof HTMLElement)
    const ringHost = hosts.find((node) => {
      const style = getComputedStyle(node)
      return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
    })
    const ringStyle = ringHost ? getComputedStyle(ringHost) : null
    const haloShadows = hosts.flatMap((node) =>
      getComputedStyle(node).boxShadow
        .split(/,(?![^(]*\))/)
        .map((layer) => layer.trim())
        .filter((layer) => !layer.includes("inset") && /\b0px 0px 0px [1-9]\d*(\.\d+)?px\b/.test(layer))
    )
    const label = element.getAttribute("aria-label") ?? element.innerText?.trim() ?? ""
    const shell = element.closest(".ll-app")
    const where = !shell
      ? "outside"
      : element.closest("main")
        ? "main"
        : element.closest(".ll-app > nav")
          ? "tabs"
          : "chrome"

    return {
      dsRingColor,
      haloShadows,
      key: element.id ? `#${element.id}` : label.split("\n")[0]!.trim(),
      ring: ringStyle ? { color: ringStyle.outlineColor, style: ringStyle.outlineStyle, width: parseFloat(ringStyle.outlineWidth) } : null,
      where
    }
  })
}

/** Tabs from the top of a freshly loaded page and records every stop, until focus leaves the document. */
async function tabThrough(page: Page, limit = 200): Promise<FocusStop[]> {
  const stops: FocusStop[] = []

  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab")
    const stop = await focusStop(page)

    if (!stop || (stops.length > 0 && stop.key === stops[0]!.key)) break
    stops.push(stop)
  }

  return stops
}

/** The design-system focus ring: a solid outline in --ll-focus-color, and no legacy halo. */
function expectDesignSystemRing(stop: FocusStop) {
  expect(stop.ring, `${stop.key}: no visible focus outline`).not.toBeNull()
  expect(stop.ring!.width, `${stop.key}: outline width`).toBeGreaterThan(0)
  expect(stop.ring!.style, `${stop.key}: outline style`).toBe("solid")
  expect(stop.ring!.color, `${stop.key}: outline colour is the --ll-focus-color token`).toBe(stop.dsRingColor)
  expect(stop.haloShadows, `${stop.key}: the global :focus-visible halo reaches a design-system control`).toEqual([])
}

test.describe("responsive matrix: /v2/work (visitor)", () => {
  for (const width of MATRIX) {
    test.describe(`${width} px`, () => {
      test.use({ viewport: viewportFor(width) })

      test("no horizontal overflow; the width's navigation only; Find work is current", async ({ page }) => {
        await openV2(page, "/v2/work")
        await expect(page.locator("[data-ds-page='find-work']")).toBeVisible()

        await expectNoHorizontalOverflow(page)
        // A visitor sees the public board only.
        expect(await expectNavigationForWidth(page, width)).toEqual(["Find work"])
        await expectCurrent(page, width, "Find work")
      })

      test("the skip link is the first stop and moves focus to #main", async ({ page }) => {
        await openV2(page, "/v2/work")

        await page.keyboard.press("Tab")
        const skip = page.getByRole("link", { name: "Skip to main content" })
        await expect(skip).toBeFocused()
        await expect(skip).toBeInViewport()

        await page.keyboard.press("Enter")
        await expect(page.locator("#main")).toBeFocused()
        await expect(page).toHaveURL(/#main$/)

        // The landmark takes focus without drawing a ring of its own, and the next stop is inside it.
        const main = await focusStop(page)
        expect(main?.ring, "#main draws no focus outline").toBeNull()
        expect(main?.haloShadows, "#main draws no focus halo").toEqual([])

        await page.keyboard.press("Tab")
        await expect(page.locator("#work-filters-summary")).toBeFocused()
      })

      test("no horizontal overflow with web fonts blocked (fallback stack)", async ({ page }) => {
        await page.route(/\.(woff2?|ttf|otf)(\?.*)?$/, (route) => route.abort())
        await openV2(page, "/v2/work")

        await expectNoHorizontalOverflow(page)
        await expect(page.getByRole("heading", { level: 1, name: "Find hauling work" })).toBeVisible()
        await expect(findWorkSummary(page)).toBeEnabled()
      })
    })
  }
})

test.describe("responsive matrix: /v2/switch (signed in)", () => {
  test("hauler: no overflow, the width's navigation, nothing marked current", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, "hank@northpine.example")

    for (const width of MATRIX) {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, "/v2/switch")
      await expect(page.getByRole("heading", { level: 1, name: "Switch business" })).toBeVisible()

      await expectNoHorizontalOverflow(page)
      expect(await expectNavigationForWidth(page, width)).toEqual(["Find work", "My inquiries"])
      // /v2/switch is not a navigation destination, so no item claims to be the current page.
      await expectCurrent(page, width, null)
    }
  })
})

// Before the case that sends (below), because it needs the form, which goes once New River Hauling has an inquiry.
// It submits once, with a date range the server refuses, so it writes nothing and the run's one interest is still
// sent by the scripted case.
test.describe("the express-interest form without JavaScript (New River Hauling, #174)", () => {
  test.use({ javaScriptEnabled: false })

  test("the server's form has a native truck count and posts to the action, which answers on the page", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, NEW_RIVER.email)
    await openV2(page, "/v2/work")
    const link = northPineJobLink(page)
    test.skip((await link.count()) === 0, NO_OPEN_JOB)

    const jobPath = (await link.getAttribute("href"))!
    await openV2(page, jobPath)
    const form = page.locator("form:has(input[name='loadPostingId'])")
    test.skip((await form.count()) === 0, "New River Hauling already sent interest on this job in this run's state")

    // "I'm interested" is an in-page link to the form.
    await expect(page.locator("[data-ds-page='job-detail'] article").getByRole("link", { name: "I'm interested" })).toHaveAttribute("href", "#interest")

    // Unhydrated, the count is a native number field in [1, 500]; the NumberStepper only replaces it once scripts run.
    const count = form.getByRole("spinbutton", { name: "Trucks you can offer" })
    await expect(count).toHaveValue("1")
    await expect(count).toHaveAttribute("min", "1")
    await expect(count).toHaveAttribute("max", "500")
    await expect(form.getByRole("group", { name: "Trucks you can offer" })).toHaveCount(0)
    await expect(form.locator("[name='trucksOffered']")).toHaveCount(1)

    // The browser posts the form itself; the action refuses the inverted range and the page comes back with why.
    await form.getByText("Dates and contact preference (optional)").click()
    await form.getByLabel("Available from").fill("2026-12-10")
    await form.getByLabel("Available until").fill("2026-12-01")
    await form.getByRole("button", { name: "Send interest" }).click()

    await page.waitForURL((url) => url.pathname === jobPath && url.searchParams.has("error"))
    await expect(page.getByRole("alert").filter({ hasText: "Available until must not be before available from" })).toBeVisible()
    await expect(page.locator("form:has(input[name='loadPostingId'])"), "nothing was sent: the form is still offered").toHaveCount(1)
  })
})

// First of the cases that send: it needs New River Hauling to have no inquiry yet, so it runs before any test that
// calls ensureNewRiverInquiry (workers: 1, file order).
test.describe("the express-interest form (New River Hauling)", () => {
  test("the truck count stays in range, the form has no serious axe violations, and sending opens an inquiry", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, NEW_RIVER.email)
    await openV2(page, "/v2/work")
    const link = northPineJobLink(page)
    test.skip((await link.count()) === 0, NO_OPEN_JOB)

    await openV2(page, (await link.getAttribute("href"))!)
    const form = page.locator("form:has(input[name='loadPostingId'])")
    test.skip((await form.count()) === 0, "New River Hauling already sent interest on this job in this run's state")

    // Hydrated, the count is a NumberStepper that only emits values in [1, 500] (no equipment listed, so a plain count).
    const stepper = form.getByRole("group", { name: "Trucks you can offer" })
    const fewer = stepper.getByRole("button", { name: "One fewer" })
    const more = stepper.getByRole("button", { name: "One more" })
    const value = form.locator("input[type='hidden'][name='trucksOffered']")

    await expect(stepper).toBeVisible()
    await expect(value).toHaveValue("1")
    await expect(fewer).toHaveAttribute("aria-disabled", "true")
    await fewer.click({ force: true })
    await expect(value).toHaveValue("1")
    await more.click()
    await expect(stepper.locator("output")).toHaveText("2")
    await expect(value).toHaveValue("2")
    await fewer.click()
    await expect(value).toHaveValue("1")
    await expect(form.locator("[name='trucksOffered']")).toHaveCount(1)

    // JobDetail's "I'm interested" leads to this form on the same page.
    await expect(page.locator("[data-ds-page='job-detail'] article").getByRole("link", { name: "I'm interested" })).toHaveAttribute("href", "#interest")

    await expectNoSeriousAxeViolations(page)
    await page.setViewportSize(viewportFor(390))
    await expectNoSeriousAxeViolations(page)

    await form.getByLabel("Message").fill(MARKUP_NOTE)
    await form.getByRole("button", { name: "Send interest" }).click()
    await expect(page).toHaveURL(/[?&]sent=1/)
    await expect(page.getByRole("status").filter({ hasText: "Your interest was sent." })).toBeVisible()
    await expect(page.locator("form:has(input[name='loadPostingId'])")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Open my inquiries" })).toHaveAttribute("href", /^\/v2\/inquiries\?inquiry=/)
  })
})

test.describe("responsive matrix: pages migrated in DS-04 (#147)", () => {
  test("visitor: the job page, /v2/start and the V2 not-found page", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    const jobPath = await firstJobPath(page)
    const pages = [
      { current: "Find work", heading: "Job details", path: jobPath, root: "job-detail" },
      { current: null, heading: "Set up your business", path: "/v2/start", root: "start" },
      // A missing job is still under Find work, so that destination stays current.
      { current: "Find work", heading: "This page is not available", path: "/v2/work/00000000-0000-4000-8000-000000000000", root: "not-found" }
    ] as const

    for (const { current, heading, path, root } of pages) {
      for (const width of MATRIX) {
        await page.setViewportSize(viewportFor(width))
        await openV2(page, path)
        await expect(page.locator(`[data-ds-page='${root}']`)).toBeVisible()
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()

        await expectNoHorizontalOverflow(page)
        expect(await expectNavigationForWidth(page, width)).toEqual(["Find work"])
        await expectCurrent(page, width, current)
      }
    }
  })

  test("hauler: /v2/inquiries puts the conversation beside the list from 1024 px and under it below", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)

    for (const width of MATRIX) {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, "/v2/inquiries")
      await expect(page.locator("[data-ds-page='my-inquiries'] #conversation")).toBeVisible()

      await expectNoHorizontalOverflow(page)
      await expectSplitLayout(page, width)
      expect(await expectNavigationForWidth(page, width)).toEqual(["Find work", "My inquiries"])
      await expectCurrent(page, width, "My inquiries")
    }
  })

  test("landing: /v2/landing/inquiries, with a conversation and with none", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    const withInquiry = await ensureNewRiverInquiry(page)

    if (!withInquiry) test.info().annotations.push({ description: `With a conversation: not checked. ${NO_OPEN_JOB}`, type: "skip" })
    if (withInquiry) {
      await page.context().clearCookies()
      await signIn(page, NORTH_PINE_LANDING)

      for (const width of MATRIX) {
        await page.setViewportSize(viewportFor(width))
        await openV2(page, "/v2/landing/inquiries")
        await expect(page.locator("[data-ds-page='landing-inbox'] #conversation")).toBeVisible()

        await expectNoHorizontalOverflow(page)
        await expectSplitLayout(page, width)
        await expectCurrent(page, width, "Landing inbox")
      }
    }

    await page.context().clearCookies()
    await signIn(page, LANDING_WITHOUT_INQUIRIES)
    for (const width of MATRIX) {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, "/v2/landing/inquiries")
      await expect(page.getByRole("heading", { level: 2, name: "New" })).toBeVisible()
      await expect(page.locator("#conversation")).toHaveCount(0)

      await expectNoHorizontalOverflow(page)
      expect(await expectNavigationForWidth(page, width)).toEqual(["Overview", "Landing inbox", "Post jobs", "Landings"])
      await expectCurrent(page, width, "Landing inbox")
    }
  })
})

test.describe("capability navigation (#124)", () => {
  const cases = [
    { email: "hank@northpine.example", home: "/v2/work", items: ["Find work", "My inquiries"], visit: "/v2/inquiries", current: "My inquiries" },
    { email: "cole@summit.example", home: "/v2/landing", items: ["Overview", "Landing inbox", "Post jobs", "Landings"], visit: "/v2/landing/inquiries", current: "Landing inbox" },
    {
      email: "dispatch@northpine.example",
      home: "/v2/work",
      items: ["Find work", "My inquiries", "Overview", "Landing inbox", "Post jobs"],
      visit: "/v2/inquiries",
      current: "My inquiries"
    }
  ] as const

  for (const { email, home, items, visit, current } of cases) {
    test(`${email} sees ${items.join(", ")}`, async ({ page }) => {
      await page.setViewportSize(viewportFor(1280))
      await signIn(page, email)
      // Sign-in lands on the business's V2 home (#124): /v2/landing is the landing overview (#133).
      await expect(page).toHaveURL(new RegExp(`${home}(/|$|\\?)`))

      await openV2(page, visit)
      for (const width of [1280, 390]) {
        await page.setViewportSize(viewportFor(width))
        expect(await expectNavigationForWidth(page, width)).toEqual(items)
        await expectCurrent(page, width, current)
        await expectNoHorizontalOverflow(page)
      }

      // The acting business is shown and links to the V2 switch route, never to the legacy chooser.
      await page.setViewportSize(viewportFor(1280))
      await expect(page.getByRole("link", { name: /^Acting as .+ Switch business$/ })).toHaveAttribute("href", "/v2/switch")
      // Rows are a semantic list on every V2 list page: no listbox or option roles.
      await expect(page.locator("[role='listbox'], [role='option']")).toHaveCount(0)
    })
  }
})

/** The shell's chrome above the content: the top of #main, which nothing but the top bar precedes (#124 criterion 6). */
async function chromeHeight(page: Page): Promise<number> {
  return page.locator(".ll-app #main").evaluate((main) => main.getBoundingClientRect().top + window.scrollY)
}

test.describe("account menu (#124 criterion 7)", () => {
  for (const width of [1280, 390]) {
    test(`visitor at ${width} px: no preview banner; the notice is in the account menu, which opens and closes from the keyboard`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, "/v2/work")

      // No banner: the top bar follows the skip link directly, and the notice is not shown until the menu opens.
      expect(await page.locator(".ll-app > header").evaluate((header) => header.previousElementSibling?.tagName)).toBe("A")
      await expect(page.getByText(PREVIEW_NOTICE)).toBeHidden()
      await expect(accountTrigger(page)).toBeVisible()
      await expect(accountTrigger(page)).toContainText("Preview")
      if (width < BP_LG) expect(await chromeHeight(page), "chrome above the content at 390 px").toBeLessThanOrEqual(120)

      // Reached by Tab; Enter opens it. The trigger and the panel's link draw the design-system ring.
      for (let index = 0; index < 10 && !(await accountTrigger(page).evaluate((trigger) => trigger === document.activeElement)); index += 1) {
        await page.keyboard.press("Tab")
      }
      await expect(accountTrigger(page)).toBeFocused()
      expectDesignSystemRing((await focusStop(page))!)
      await page.keyboard.press("Enter")
      await expect(accountMenu(page)).toHaveAttribute("open", "")
      const notice = accountMenu(page).getByRole("note", { name: "Marketplace V2 development preview" })
      await expect(notice).toBeVisible()
      await expect(notice).toContainText(PREVIEW_NOTICE)
      await expect(accountMenu(page).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Fv2%2Fwork")
      await expectNoHorizontalOverflow(page)
      await expectNoSeriousAxeViolations(page)

      // Escape closes it and returns focus to the trigger.
      await page.keyboard.press("Escape")
      await expect(accountMenu(page)).not.toHaveAttribute("open", "")
      await expect(accountTrigger(page)).toBeFocused()

      // Tab walks into the panel's link, and tabbing past the panel closes it.
      await page.keyboard.press("Enter")
      await page.keyboard.press("Tab")
      await expect(accountMenu(page).getByRole("link", { name: "Sign in" })).toBeFocused()
      expectDesignSystemRing((await focusStop(page))!)
      await page.keyboard.press("Tab")
      await expect(accountMenu(page)).not.toHaveAttribute("open", "")

      // A pointer press outside closes it too (here in the page's left gutter, which the panel never covers).
      await accountTrigger(page).click()
      await expect(notice).toBeVisible()
      await page.mouse.click(6, 400)
      await expect(accountMenu(page)).not.toHaveAttribute("open", "")
    })
  }

  test("signed in: the person, Switch business and Sign out, with no serious axe violations at 1280 and 390 px", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signInToV2(page, "hank@northpine.example")
    await openV2(page, "/v2/work")

    for (const width of [1280, 390]) {
      await page.setViewportSize(viewportFor(width))
      if (width < BP_LG) expect(await chromeHeight(page), "chrome above the content at 390 px").toBeLessThanOrEqual(120)
      await accountTrigger(page).click()
      await expect(accountMenu(page)).toContainText("Hank Hauler")
      await expect(accountMenu(page)).toContainText("hank@northpine.example")
      await expect(accountMenu(page).getByRole("note")).toContainText(PREVIEW_NOTICE)
      await expect(accountMenu(page).getByRole("link", { name: "Switch business" })).toHaveAttribute("href", "/v2/switch")
      await expect(accountMenu(page).getByRole("button", { name: "Sign out" })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expectNoSeriousAxeViolations(page)
      await page.keyboard.press("Escape")
    }

    // Sign out ends the session: the public home, then a V2 page offers Sign in and no business.
    await accountTrigger(page).click()
    await accountMenu(page).getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/")
    await openV2(page, "/v2/work")
    await expect(page.getByRole("link", { name: /^Acting as/ })).toHaveCount(0)
    await accountTrigger(page).click()
    await expect(accountMenu(page).getByRole("link", { name: "Sign in" })).toBeVisible()
  })
})

test.describe("keyboard: /v2/work", () => {
  for (const width of [1280, 390]) {
    test(`tab order and the design-system focus ring at ${width} px`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await openFindWorkWithRows(page)

      const rowTitles = (await jobRows(page).locator("h3 a").allInnerTexts()).map((title) => title.trim())

      const stops = await tabThrough(page)
      const keys = stops.map((stop) => stop.key)
      const navigation = width >= BP_LG ? ["Find work"] : []
      const tabs = width >= BP_LG ? [] : ["Find work"]

      expect(keys).toEqual([
        "Skip to main content",
        "LogLoads home",
        ...navigation,
        // The account menu's trigger ends the top bar (#124); its panel is closed, so nothing inside it is a stop.
        ACCOUNT_KEY,
        // The summary bar opens the filter sheet (#129); the fields themselves are inside it.
        "#work-filters-summary",
        // The order applies on change; it is offered once there is more than one job to order.
        ...(rowTitles.length > 1 ? ["#work-sort"] : []),
        "Show map",
        // Density is a desktop view control (bp-lg and up).
        ...(width >= BP_LG ? ["Comfortable", "Compact"] : []),
        // One stop per job row (its title link), in list order; there is no Save button on this page yet.
        ...rowTitles,
        ...tabs
      ])
      expect(stops.find((stop) => stop.key === "Find work")?.where).toBe(width >= BP_LG ? "chrome" : "tabs")

      for (const stop of stops) expectDesignSystemRing(stop)
    })
  }

  test("a signed-in hauler's chrome: navigation, business switcher and account menu keep the design-system ring", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, "hank@northpine.example")
    await openV2(page, "/v2/work")

    const stops = await tabThrough(page, 7)
    const chrome = stops.filter((stop) => stop.where === "chrome")

    expect(chrome.map((stop) => stop.key)).toEqual([
      "Skip to main content",
      "LogLoads home",
      "Find work",
      "My inquiries",
      // The switcher's first text line; its full accessible name (visible text plus hidden words) is asserted in the
      // capability-navigation tests.
      "Acting as",
      ACCOUNT_KEY
    ])
    for (const stop of chrome) expectDesignSystemRing(stop)
  })

  test("Enter on a job row's link opens the job: in a sheet below 1200 px, and the link still leads to its page", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await openFindWorkWithRows(page)

    const link = jobRows(page).first().locator("h3 a")
    const href = await link.getAttribute("href")
    const title = (await link.innerText()).trim()
    expect(href).toMatch(/^\/v2\/work\/[^/]+$/)

    await link.focus()
    await page.keyboard.press("Enter")
    await expect(jobSheet(page).getByRole("heading", { level: 2, name: title })).toBeVisible()
    await expect(page).toHaveURL(/\/v2\/work\?(.*&)?job=/)
  })
})

/**
 * Every stop on the pages migrated in DS-04 (#147) draws the design-system ring and none of the legacy halo: the
 * PageHeader breadcrumb, Tabs, NumberStepper, FormField controls, the composer, the confirm triggers and the page's
 * own text links.
 */
test.describe("keyboard: the design-system ring on the migrated pages", () => {
  test("visitor: the job page, /v2/start and the not-found page", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    const jobPath = await firstJobPath(page)

    for (const path of [jobPath, "/v2/start", "/v2/work/00000000-0000-4000-8000-000000000000"]) {
      await openV2(page, path)
      const stops = await tabThrough(page)

      expect(stops.filter((stop) => stop.where === "main").length, `${path}: focus reaches the page content`).toBeGreaterThan(0)
      for (const stop of stops) expectDesignSystemRing(stop)
    }
    // The job page's breadcrumb leads back to the board.
    await openV2(page, jobPath)
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Find work" })).toHaveAttribute("href", "/v2/work")
  })

  test("landing: the job postings tabs and an empty inbox", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, LANDING_WITHOUT_INQUIRIES)

    // The job postings page: tabs, "Post a job" and the empty state's action.
    await openV2(page, "/v2/landing/jobs")
    const stops = await tabThrough(page)
    expect(stops.filter((stop) => stop.where === "main").map((stop) => stop.key)).toEqual(
      expect.arrayContaining(["Draft", expect.stringMatching(/^Published/), "Post a job"])
    )
    for (const stop of stops) expectDesignSystemRing(stop)

    // An empty inbox has nothing to focus in the page: the chrome keeps the ring.
    await openV2(page, "/v2/landing/inquiries")
    const inbox = await tabThrough(page)
    expect(inbox.filter((stop) => stop.where === "main")).toEqual([])
    for (const stop of inbox) expectDesignSystemRing(stop)
  })

  test("hauler: /v2/inquiries, row link → conversation → composer → Withdraw", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)
    await openV2(page, "/v2/inquiries")

    const stops = await tabThrough(page)
    const main = stops.filter((stop) => stop.where === "main").map((stop) => stop.key)

    // The row's single link, then the conversation's job link, the reply field, Send and Withdraw: no other stops.
    expect(main[0]).toBe(await inquiryRows(page).first().getByRole("link").innerText())
    expect(main.slice(-3)).toEqual([expect.stringMatching(/^Reply to /), "Send", "Withdraw interest"])
    for (const stop of stops) expectDesignSystemRing(stop)
  })
})

test.describe("job rows: semantic structure (/v2/work)", () => {
  test("a ul > li list, one link per row, no nested interactives, no listbox roles", async ({ page }) => {
    await openFindWorkWithRows(page)

    const rows = jobRows(page)
    await expect(page.locator("[role='listbox'], [role='option']")).toHaveCount(0)

    const nested = await page.locator("#main").evaluate((main) =>
      Array.from(main.querySelectorAll("a, button"))
        .filter((element) => element.parentElement?.closest("a, button"))
        .map((element) => element.outerHTML.slice(0, 120))
    )
    expect(nested, "no a or button inside another a or button").toEqual([])

    for (const row of await rows.all()) {
      const links = row.locator("a")
      await expect(links).toHaveCount(1)
      await expect(links).toHaveAttribute("href", /^\/v2\/work\/[^/]+$/)
    }
  })

  // #174: a loading boundary above a page streams it hidden behind the skeleton until a script reveals it, so V2
  // has none. These fail if one comes back.
  test.describe("without JavaScript (#174)", () => {
    test.use({ javaScriptEnabled: false })

    test("the row's title link still lists and opens the job", async ({ page }) => {
      await openFindWorkWithRows(page)
      const link = jobRows(page).first().locator("h3 a")
      const href = await link.getAttribute("href")

      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.getByRole("heading", { level: 1, name: "Job details" })).toBeVisible()
    })

    test("the filter form is a GET form the server answers", async ({ page }) => {
      await openV2(page, "/v2/work?all=1")
      const title = (await jobRows(page).first().locator("h3 a").innerText()).trim()
      // Unhydrated, the summary bar (#129) is a native <details> whose body is the same GET form as the sheet's.
      const summary = findWorkSummary(page)
      const filters = page.locator("form[role='search']:has(#work-q)")
      const search = filters.getByRole("searchbox", { name: "Keywords (optional)" })

      // The page rendered the box from the query, so the next search still includes every listing.
      await summary.click()
      await expect(filters.getByRole("checkbox", { name: "Include filled, paused and closed jobs" })).toBeChecked()

      await search.fill(title)
      await filters.getByRole("button", { name: "Apply" }).click()
      await page.waitForURL((url) => url.searchParams.get("q") === title && url.searchParams.get("all") === "1")
      // The new page's <details> starts closed, and getByRole skips what a closed <details> hides.
      await summary.click()
      await expect(search).toHaveValue(title)
      await expect(jobRows(page).filter({ hasText: title }).first()).toBeVisible()

      await search.fill("no listing matches this zqxv")
      await filters.getByRole("button", { name: "Apply" }).click()
      await page.waitForURL((url) => url.searchParams.get("q") === "no listing matches this zqxv")
      await expect(jobRows(page)).toHaveCount(0)
      await expect(page.getByText("No jobs match your search")).toBeVisible()
      await expect(page.getByRole("link", { name: "Clear keywords" })).toHaveAttribute("href", "/v2/work?all=1")
    })

    test.fixme("a missing job's not-found page shows its message", async ({ page }) => {
      // Needs a decision (#174 follow-up). The response is now an honest 404 instead of a 200 skeleton, but Next.js 15
      // answers a `notFound()` thrown outside a Suspense boundary with an empty document and draws the V2 not-found
      // page in the browser from the RSC payload, so without JavaScript the page is blank. Server-rendering it means
      // the job page shows its not-available state itself, which gives up the 404 status.
      await page.goto("/v2/work/00000000-0000-4000-8000-000000000000")
      await expect(page.getByRole("heading", { level: 1, name: "This page is not available" })).toBeVisible()
    })
  })
})

/** The shell carries the theme, and no text or control inside it resolves to the legacy Archivo/Inter stacks. */
async function expectNoLegacyFonts(page: Page) {
  await expect(page.locator(".ll-app")).toHaveClass(/\bll-theme\b/)
  expect(await page.locator(".ll-app").evaluate((root) => getComputedStyle(root).getPropertyValue("--ll-color-action").trim())).not.toBe("")

  // Legacy globals.css styles bare h1–h3 and :focus-visible; on a migrated page the components decide.
  const leaks = await page.locator(".ll-app").evaluate((root, legacy) => {
    const pattern = new RegExp(legacy)
    return Array.from(root.querySelectorAll("*"))
      .filter((element) => (element as HTMLElement).innerText?.trim() || /^(H[1-6]|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(element.tagName))
      .map((element) => ({ font: getComputedStyle(element).fontFamily, tag: element.tagName.toLowerCase(), text: (element as HTMLElement).innerText.trim().slice(0, 40) }))
      .filter(({ font }) => pattern.test(font))
  }, LEGACY_FONT.source)
  expect(leaks, "design-system text resolving to the legacy Archivo/Inter stacks").toEqual([])
}

/** The V2 faces app/v2/layout.tsx sets on `.ll-theme` (next/font/local family names), and the weights each ships. */
const PLEX_WEIGHTS = { display: [600, 700], mono: [500, 600], sans: [400, 500, 600, 700] } as const
type PlexRole = keyof typeof PLEX_WEIGHTS

async function plexFamilies(page: Page): Promise<Record<PlexRole, string>> {
  return page.locator(".ll-app").evaluate((root) => {
    const first = (list: string) => list.split(",")[0]!.trim().replace(/^["']|["']$/g, "")
    const style = getComputedStyle(root)
    return {
      display: first(style.getPropertyValue("--ll-font-display-face")),
      mono: first(style.getPropertyValue("--ll-font-mono-face")),
      sans: first(style.getPropertyValue("--ll-font-sans-face"))
    }
  })
}

/** Every @font-face the page declares for the given families, with the URLs it loads them from. */
async function declaredFaces(page: Page, families: string[]): Promise<Array<{ family: string; urls: string[] }>> {
  return page.evaluate((wanted) => {
    const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "")
    const rules = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })

    return rules
      .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
      .map((rule) => ({
        family: unquote(rule.style.getPropertyValue("font-family")),
        // A relative url() resolves against its stylesheet, not the page.
        urls: Array.from(rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)["']?\)/g), (match) =>
          new URL(match[1]!, rule.parentStyleSheet?.href ?? document.baseURI).href)
      }))
      .filter((face) => wanted.includes(face.family))
  }, families)
}

/**
 * The page's V2 text resolves to the self-hosted IBM Plex faces: each `--ll-font-*-face` names a face this page
 * declares, every shipped weight loads from the app itself, and headings and body text use them.
 */
async function expectSelfHostedPlex(page: Page) {
  const families = await plexFamilies(page)
  const faces = await declaredFaces(page, Object.values(families))

  for (const [role, family] of Object.entries(families) as Array<[PlexRole, string]>) {
    expect(family, `--ll-font-${role}-face is set`).not.toBe("")
    expect(family, `--ll-font-${role}-face is a self-hosted face, not the bare name in tokens.css`).not.toMatch(/^IBM Plex/)
    const urls = faces.filter((face) => face.family === family).flatMap((face) => face.urls)
    expect(urls, `${role}: one file per shipped weight`).toHaveLength(PLEX_WEIGHTS[role].length)
    for (const url of urls) expect(url, `${role}: served by the app`).toMatch(new RegExp(`^${baseOrigin(page)}/_next/static/media/[^/]+\\.woff2$`))
  }

  const loaded = await page.evaluate(async ({ families, weights }) => {
    const results: string[] = []
    for (const [role, family] of Object.entries(families)) {
      for (const weight of weights[role as keyof typeof weights]) {
        const faces = await document.fonts.load(`${weight} 16px "${family}"`)
        if (!faces.some((face) => face.status === "loaded")) results.push(`${role} ${weight}`)
      }
    }
    return results
  }, { families, weights: PLEX_WEIGHTS })
  expect(loaded, "Plex weights that did not load").toEqual([])

  const used = await page.locator(".ll-app").evaluate((root) => {
    const first = (element: Element | null) => (element ? getComputedStyle(element).fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "") : null)
    // The page root: the text style every page's body copy inherits from the shell.
    return { body: first(root.querySelector("#main [data-ds-page]")), heading: first(root.querySelector("#main h1")) }
  })
  expect(used.heading, "the page title uses Plex Sans Condensed").toBe(families.display)
  expect(used.body, "page text inherits Plex Sans").toBe(families.sans)
}

const baseOrigin = (page: Page) => new URL(page.url()).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

test.describe("style isolation", () => {
  test("/v2/work and the migrated visitor pages: the shell carries the theme and nothing resolves to a legacy font", async ({ page }) => {
    const jobPath = await firstJobPath(page)
    for (const path of ["/v2/work", jobPath, "/v2/start", "/v2/work/00000000-0000-4000-8000-000000000000"]) {
      await openV2(page, path)
      await expectNoLegacyFonts(page)
    }
  })

  test("signed-in migrated pages: nothing resolves to a legacy font", async ({ page }) => {
    await signIn(page, LANDING_WITHOUT_INQUIRIES)
    for (const path of ["/v2/landing/inquiries", "/v2/switch"]) {
      await openV2(page, path)
      await expectNoLegacyFonts(page)
    }
  })

  test("/v2/work makes no requests to Google Fonts", async ({ page }) => {
    const requests: string[] = []
    page.on("request", (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) requests.push(request.url())
    })

    await openV2(page, "/v2/work")
    await page.waitForLoadState("networkidle")

    expect(requests).toEqual([])
  })

  test("V2 text renders in self-hosted IBM Plex, on the board and in a signed-in page", async ({ page }) => {
    await openV2(page, "/v2/work")
    await expectSelfHostedPlex(page)

    await signIn(page, LANDING_WITHOUT_INQUIRIES)
    await openV2(page, "/v2/landing/inquiries")
    await expectSelfHostedPlex(page)
  })

  test("legacy / and /pricing neither declare nor download the V2 faces", async ({ page }) => {
    await openV2(page, "/v2/work")
    const families = Object.values(await plexFamilies(page))
    const plexUrls = (await declaredFaces(page, families)).flatMap((face) => face.urls)
    expect(plexUrls.length).toBeGreaterThan(0)

    for (const path of ["/", "/pricing"]) {
      const fonts: string[] = []
      const onRequest = (request: { resourceType(): string; url(): string }) => {
        if (request.resourceType() === "font" || /\.woff2?(\?|$)/.test(request.url())) fonts.push(request.url())
      }
      page.on("request", onRequest)
      await page.goto(path)
      await page.waitForLoadState("load")
      await page.evaluate(() => document.fonts.ready)
      page.off("request", onRequest)

      expect(await declaredFaces(page, families), `${path}: no @font-face for the V2 families`).toEqual([])
      const preloads = await page.locator("link[rel='preload'][as='font']").evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href))
      expect(preloads.filter((href) => plexUrls.includes(href)), `${path}: no V2 font preloads`).toEqual([])
      expect(fonts.filter((url) => plexUrls.includes(url)), `${path}: no V2 font downloads`).toEqual([])
    }
  })

  for (const { path, email } of [
    { email: null, path: "/" },
    { email: null, path: "/pricing" },
    { email: "dispatch@northpine.example", path: "/fleet/trucks" }
  ]) {
    test(`legacy ${path} carries no design-system theme`, async ({ page }) => {
      if (email) await signIn(page, email)
      await page.goto(path)
      await page.waitForLoadState("domcontentloaded")
      await expect(page.locator(".route-skeleton")).toHaveCount(0)
      expect(new URL(page.url()).pathname).toBe(path)

      await expect(page.locator(".ll-theme")).toHaveCount(0)
      expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--ll-color-action"))).toBe("")
    })
  }
})

/**
 * Automated accessibility audit (#148 criterion 6; `@axe-core/playwright` approved in docs/DECISIONS.md). Scoped to the
 * V2 shell, WCAG 2.2 A/AA rules. A serious or critical violation fails the test and names the rule and nodes;
 * any exception must name an issue. Pages are added here as they move onto the design system.
 */
async function expectNoSeriousAxeViolations(page: Page) {
  // The sticky form actions and bottom tabs cover whatever sits under them at the current scroll position, and
  // axe's target-size rule then measures only the uncovered sliver of that control (seen in CI at 390 px, where the
  // Linux fonts push a 44 px select under the bar). The audit is about the components, so it runs with the viewport
  // grown to the full page height at the same width, so nothing is under a sticky bar, then restores it.
  const viewport = page.viewportSize()
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  if (viewport && pageHeight > viewport.height) await page.setViewportSize({ height: pageHeight, width: viewport.width })

  const results = await new AxeBuilder({ page })
    .include(".ll-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()

  if (viewport) await page.setViewportSize(viewport)
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  const summary = blocking.map((violation) => {
    const nodes = violation.nodes.slice(0, 5).map((node) => node.target.join(" "))
    return `${violation.id} (${violation.impact}): ${violation.help} — ${nodes.join(" | ")}`
  })

  expect(summary, "serious or critical axe violations").toEqual([])
}

test.describe("accessibility audit (axe)", () => {
  for (const width of [1440, 390]) {
    test(`/v2/work at ${width} px has no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await openFindWorkWithRows(page)
      await expectNoSeriousAxeViolations(page)
    })
  }

  test("/v2/switch (signed in) has no serious or critical violations", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, "hank@northpine.example")
    await openV2(page, "/v2/switch")
    await expectNoSeriousAxeViolations(page)
  })

  // The job editor and job list (#128, #175), signed in as a landing user.
  for (const width of [1440, 390]) {
    test(`job editor step 1 and the job list at ${width} px have no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await signIn(page, "cole@summit.example")
      await openV2(page, "/v2/landing/jobs/new")
      await expect(page.locator("[data-ds-page='job-editor']")).toBeVisible()
      await expectNoSeriousAxeViolations(page)

      await openV2(page, "/v2/landing/jobs")
      await expect(page.locator("[data-ds-page='job-postings']").first()).toBeVisible()
      await expectNoSeriousAxeViolations(page)
    })
  }

  // Pages migrated in DS-04 (#147). The interest form and both conversations are audited in their own tests below,
  // where the inquiry they need exists.
  for (const width of [1440, 390]) {
    test(`the job page, /v2/start and the not-found page (visitor) at ${width} px have no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      const jobPath = await firstJobPath(page)

      for (const path of [jobPath, "/v2/start", "/v2/work/00000000-0000-4000-8000-000000000000"]) {
        await openV2(page, path)
        await expectNoSeriousAxeViolations(page)
      }
    })

    test(`an empty landing inbox at ${width} px has no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await signIn(page, LANDING_WITHOUT_INQUIRIES)
      await openV2(page, "/v2/landing/inquiries")
      await expect(page.locator("[data-ds-page='landing-inbox']")).toBeVisible()
      await expectNoSeriousAxeViolations(page)
    })
  }
})

/**
 * Find work as list and detail (#129; 06_DESIGN_SYSTEM.md §4–5 and §9 "Job list"). With scripts a row's link selects
 * the job instead of leaving the page: beside the list in the DetailPanel at bp-xl and up, in a Dialog sheet below.
 */
test.describe("find work: list and detail (#129)", () => {
  /** Selects the first row at 1440 px and returns the selected search's URL and the row's title. */
  async function selectFirstRow(page: Page): Promise<{ title: string; url: string }> {
    await page.setViewportSize(viewportFor(1440))
    await openFindWorkWithRows(page)
    const link = jobRows(page).first().locator("h3 a")
    const title = (await link.innerText()).trim()

    await link.click()
    await expect(detailPanel(page).getByRole("heading", { level: 2, name: title })).toBeVisible()
    return { title, url: page.url() }
  }

  test(`DetailPanel shows beside the job list at ${BP_XL} px and up, and never below`, async ({ page }) => {
    const { url } = await selectFirstRow(page)

    for (const width of MATRIX) {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, url)
      await expectNoHorizontalOverflow(page)

      if (width >= BP_XL) {
        await expect(detailPanel(page), `${width} px: the panel is shown`).toBeVisible()
        const list = await page.locator("[data-ds-page] ul[aria-label='Jobs']").boundingBox()
        const panel = await detailPanel(page).boundingBox()
        expect(panel!.x, `${width} px: the panel is beside the list`).toBeGreaterThanOrEqual(list!.x + list!.width - 1)
      } else {
        await expect(detailPanel(page), `${width} px: no panel below ${BP_XL} px`).toBeHidden()
        await expect(page.getByRole("dialog")).toHaveCount(0)
      }
    }
  })

  test("selecting a job row updates the DetailPanel", async ({ page }) => {
    const { title } = await selectFirstRow(page)
    const first = jobRows(page).first().locator("h3 a")

    // The row is current and the page did not navigate away.
    await expect(first).toHaveAttribute("aria-current", "true")
    await expect(first).toHaveAttribute("aria-controls", "find-work-detail")
    await expect(page).toHaveURL(/\/v2\/work\?(.*&)?job=/)
    await expect(detailPanel(page).locator("article h2")).toHaveText(title)

    // Enter on another row moves the selection and the panel with it.
    if ((await jobRows(page).count()) > 1) {
      const second = jobRows(page).nth(1).locator("h3 a")
      const secondTitle = (await second.innerText()).trim()
      await second.focus()
      await page.keyboard.press("Enter")
      await expect(detailPanel(page).locator("article h2")).toHaveText(secondTitle)
      await expect(second).toHaveAttribute("aria-current", "true")
      await expect(first).not.toHaveAttribute("aria-current", "true")
      await expect(second).toBeFocused()
    }

    // Close clears the selection.
    await detailPanel(page).getByRole("button", { name: /^Close/ }).click()
    await expect(detailPanel(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]job=/)
    await expect(page.locator("[data-ds-page] ul[aria-label='Jobs'] a[aria-current='true']")).toHaveCount(0)
  })

  for (const width of [1024, 390]) {
    test(`below ${BP_XL} px a row opens a dialog; Escape closes it and focus returns to the row link (${width} px)`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await openFindWorkWithRows(page)
      const link = jobRows(page).first().locator("h3 a")
      const title = (await link.innerText()).trim()

      await link.click()
      const sheet = jobSheet(page)
      await expect(sheet.getByRole("heading", { level: 2, name: title })).toBeVisible()
      await expect(sheet).toHaveClass(/\bll-theme\b/)
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]"))), "focus is inside the sheet").toBe(true)
      await expect(detailPanel(page)).toHaveCount(0)
      await expectNoSeriousAxeViolations(page)

      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(link).toBeFocused()

      // The Close button returns focus the same way.
      await link.click()
      await expect(sheet.getByRole("heading", { level: 2, name: title })).toBeVisible()
      await sheet.getByRole("button", { name: "Close" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(link).toBeFocused()
      await expectNoHorizontalOverflow(page)
    })
  }

  test("switching density keeps the selection", async ({ page }) => {
    const { title } = await selectFirstRow(page)
    const density = page.getByRole("group", { name: "Density" })
    const list = page.locator("[data-ds-page] [data-density]:has(ul[aria-label='Jobs'])")

    for (const choice of ["Compact", "Comfortable"] as const) {
      await density.getByRole("button", { name: choice }).click()
      await expect(density.getByRole("button", { name: choice })).toHaveAttribute("aria-pressed", "true")
      await expect(list).toHaveAttribute("data-density", choice.toLowerCase())
      await expect(jobRows(page).first().locator("h3 a")).toHaveAttribute("aria-current", "true")
      await expect(detailPanel(page).locator("article h2")).toHaveText(title)
    }
  })
})

/** Find work's search (#129, UX-06): summary bar, filter sheet, location and radius, and the phone fold. */
test.describe("find work: the search (#129)", () => {
  test("the first job's title is above the fold at 390 × 844", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 })
    await openFindWorkWithRows(page)

    const title = await jobRows(page).first().locator("h3").boundingBox()
    const tabs = await bottomTabs(page).boundingBox()
    expect(title, "the first row has a title").toBeTruthy()
    expect(title!.y + title!.height, "the title ends above the bottom tabs").toBeLessThanOrEqual((tabs?.y ?? 844) + 0.5)
  })

  test("the summary bar opens the filter sheet; a typed town searches from its approximate point", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await openV2(page, "/v2/work?all=1")
    await expect(findWorkSummary(page)).toContainText("Anywhere")

    await findWorkSummary(page).click()
    const sheet = page.getByRole("dialog", { name: "Filter jobs" })
    await expect(sheet).toBeVisible()
    for (const label of ["Location", "Radius", "Equipment", "Product", "Pay basis", "Starting", "Include filled, paused and closed jobs"]) {
      await expect(sheet.getByLabel(label, { exact: true }), label).toBeVisible()
    }
    await expect(sheet.getByLabel("Radius", { exact: true }).locator("option")).toHaveText(["50 mi", "100 mi", "150 mi", "250+ mi"])
    await expect(sheet.getByRole("button", { name: "Apply" })).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Reset" })).toBeVisible()
    await expectNoSeriousAxeViolations(page)

    // Escape closes the sheet and returns focus to the bar.
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(findWorkSummary(page)).toBeFocused()

    await findWorkSummary(page).click()
    await sheet.getByLabel("Location", { exact: true }).fill("sweet home")
    await sheet.getByRole("button", { name: "Apply" }).click()
    await expect(page).toHaveURL(/[?&]near=sweet\+home/)
    await expect(page).toHaveURL(/[?&]all=1/)
    await expect(findWorkSummary(page)).toContainText("Near Sweet Home, OR · 100 mi")

    // Distance is to each job's approximate public point, and says so.
    for (const row of await jobRows(page).all()) {
      await expect(row.locator("dd").first()).toContainText(/About \d+ mi from your search|Under 1 mi from your search/)
    }
    if ((await jobRows(page).count()) === 0) {
      await expect(page.getByRole("heading", { name: /within 100 mi of Sweet Home, OR/ })).toBeVisible()
    }
  })
})

test.describe("equipment on a page (#148 criterion 4)", () => {
  test("a per-setup count never exceeds the units listed, and unknown capacity is never 0", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, GRANITE_CREEK.email)
    await openV2(page, "/v2/work")
    const link = northPineJobLink(page)
    test.skip((await link.count()) === 0, NO_OPEN_JOB)

    const jobPath = (await link.getAttribute("href"))!
    await openV2(page, jobPath)
    // Nothing in this suite sends Granite Creek's interest, so a job that accepts interest always offers the form.
    const form = page.locator("form:has(input[name='loadPostingId'])")
    await expect(form, "Granite Creek Hauling can express interest in North Pine Logging's open job").toHaveCount(1)
    await expect(form.locator("[name='trucksOffered']"), "with equipment listed there is no plain count").toHaveCount(0)

    const setups = form.locator("fieldset li")
    await expect(setups).toHaveCount(GRANITE_CREEK.setups.length)

    for (const [index, { label, units }] of GRANITE_CREEK.setups.entries()) {
      const setup = setups.nth(index)
      await expect(setup).toContainText(label)

      // EquipmentCapacity: V2 has no availability record, so it is unknown — the units listed, never a 0.
      const capacity = setup.locator("[data-state]")
      await expect(capacity).toHaveAttribute("data-state", "unknown")
      await expect(capacity).toHaveText(`${units} ${units === 1 ? "unit" : "units"} · availability not recently confirmed`)
      await expect(capacity.locator("[aria-hidden='true'] > span"), "one dashed mark per unit").toHaveCount(units)
      await expect(capacity.locator("[data-on]"), "no mark claims a unit is available").toHaveCount(0)

      // The stepper starts at 0 when there are several setups and stops at the units listed.
      const stepper = setup.getByRole("group", { name: `Trucks offered: ${label}` })
      const more = stepper.getByRole("button", { name: "One more" })
      const fewer = stepper.getByRole("button", { name: "One fewer" })
      const value = setup.locator("input[type='hidden'][name='equipmentCount']")

      await expect(value).toHaveValue("0")
      for (let step = 0; step < units + 2; step += 1) await more.click({ force: true })
      await expect(value).toHaveValue(String(units))
      await expect(stepper.locator("output")).toHaveText(String(units))
      await expect(more).toHaveAttribute("aria-disabled", "true")
      await expect(fewer).not.toHaveAttribute("aria-disabled", "true")
    }

    // The server re-checks every count: one edited past the listing is refused, and no interest is sent.
    const [first] = GRANITE_CREEK.setups
    const refusal = `Your profile lists ${first.units} x ${first.label}`
    await setups.first().locator("input[type='hidden'][name='equipmentCount']").evaluate((input, count) => {
      (input as HTMLInputElement).value = String(count)
    }, first.units + 1)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === jobPath),
      form.getByRole("button", { name: "Send interest" }).click()
    ])

    // The action answers with a redirect back to the job carrying the refusal. The test opens that target itself:
    // in CI the client router sometimes does not follow an action's redirect (seen on PR #179 and #181, on this
    // form and the reply composer alike), which is not what this case is about.
    const redirect = response.headers()["x-action-redirect"]?.split(";")[0]
    expect(redirect, "the action redirects back to the job").toBeTruthy()
    const target = new URL(redirect!, page.url())
    expect(target.pathname).toBe(jobPath)
    expect(target.searchParams.get("error")).toContain(refusal)

    await openV2(page, `${target.pathname}${target.search}`)
    await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible()
    await expect(page.locator("form:has(input[name='loadPostingId'])"), "the refused offer created no inquiry").toHaveCount(1)
  })
})

test.describe("conversation on a page (#148 criterion 4)", () => {
  test("hauler: messages are escaped text, an empty send is blocked, a sent reply stays text", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)
    await openV2(page, "/v2/inquiries")

    const log = page.getByRole("log")
    const composer = page.locator("form:has(textarea[aria-label^='Reply to'])")
    const textarea = composer.locator("textarea")
    const send = composer.getByRole("button", { name: "Send", exact: true })

    // The selected row's link is marked current, and its conversation is the one shown.
    await expect(inquiryRows(page).first().getByRole("link")).toHaveAttribute("aria-current", "true")
    await expect(log).toContainText(MARKUP_NOTE)
    await expect(log.locator("img, script, b")).toHaveCount(0)

    // Blank and whitespace-only drafts cannot be sent: Send stays unavailable and pressing it changes nothing.
    const url = page.url()
    const messages = await log.locator("li").count()
    await expect(send).toHaveAttribute("aria-disabled", "true")
    await send.click({ force: true })
    await textarea.fill("   \n  ")
    await expect(send).toHaveAttribute("aria-disabled", "true")
    await send.click({ force: true })
    await expect(page).toHaveURL(url)
    await expect(log.locator("li")).toHaveCount(messages)

    // A reply with markup is posted and comes back as text; the composer starts again empty.
    await textarea.fill(MARKUP_REPLY)
    await expect(send).not.toHaveAttribute("aria-disabled", "true")

    // PR #179: in CI (production build + Supabase) the reply was saved and redirected but the page never moved, and
    // the trace holds neither the action's response body nor console output. Keep them, attached on a failure.
    const diagnostics: string[] = []
    page.on("console", (entry) => diagnostics.push(`console.${entry.type()}: ${entry.text()}`))
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.stack ?? error.message}`))
    page.on("response", async (response) => {
      if (response.request().method() !== "POST") return
      const body = await response.text().catch((error: unknown) => `<unreadable: ${String(error)}>`)
      diagnostics.push(`${response.status()} ${response.url()}\n${JSON.stringify(response.headers())}\n${body.slice(0, 50_000)}`)
    })

    await send.click()
    try {
      await expect(page).toHaveURL(/[?&]updated=reply/)
    } catch (error) {
      await test.info().attach("reply-diagnostics", { body: diagnostics.join("\n\n") || "(nothing captured)", contentType: "text/plain" })
      throw error
    }
    await expect(page).toHaveURL(/[?&]inquiry=/)
    await expect(page.getByRole("log")).toContainText(MARKUP_REPLY)
    await expect(page.getByRole("log").locator("img, script, b")).toHaveCount(0)
    await expect(page.locator("textarea[aria-label^='Reply to']")).toHaveValue("")
    expect(await page.evaluate(() => (window as { __llInjected?: unknown }).__llInjected)).toBeUndefined()

    await expectNoSeriousAxeViolations(page)
  })

  test("hauler: Withdraw asks first in a Dialog; Escape and Cancel close it and return focus", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)
    await openV2(page, "/v2/inquiries")

    const withdraw = page.getByRole("link", { exact: true, name: "Withdraw interest" })
    const dialog = page.getByRole("dialog", { name: "Withdraw your interest?" })

    // Without scripts the same link opens the confirmation in the page.
    await expect(withdraw).toHaveAttribute("href", /[?&]confirm=withdraw#confirm-action$/)
    await withdraw.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveClass(/\bll-theme\b/)
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
    await expect(page).not.toHaveURL(/confirm=/)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(withdraw).toBeFocused()

    await withdraw.press("Enter")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(withdraw).toBeFocused()
    await expect(page.getByRole("log")).not.toContainText("You withdrew this inquiry.")
  })

  test("landing: the hauler's note is text, and Decline asks first in a Dialog that returns focus", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)
    await page.context().clearCookies()
    await signIn(page, NORTH_PINE_LANDING)
    await openV2(page, "/v2/landing/inquiries")

    // Selecting the row is a plain link: it marks the row current and shows its conversation.
    const rowLink = inquiryRows(page).getByRole("link", { exact: true, name: NEW_RIVER.name }).first()
    await rowLink.click()
    await expect(page).toHaveURL(/[?&]inquiry=[^&#]+#conversation$/)
    await expect(inquiryRows(page).getByRole("link", { exact: true, name: NEW_RIVER.name }).first()).toHaveAttribute("aria-current", "true")
    await expect(page.getByRole("heading", { level: 2, name: NEW_RIVER.name })).toBeVisible()

    const log = page.getByRole("log", { name: `Messages with ${NEW_RIVER.name}` })
    await expect(log).toContainText(MARKUP_NOTE)
    await expect(log.locator("img, script, b")).toHaveCount(0)

    const decline = page.getByRole("link", { exact: true, name: "Decline" })
    const dialog = page.getByRole("dialog", { name: "Decline this inquiry?" })

    await decline.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveClass(/\bll-theme\b/)
    await expect(dialog).toContainText(`${NEW_RIVER.name} will see that you declined`)
    await expect(dialog.getByRole("button", { name: "Decline inquiry" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(decline).toBeFocused()

    await decline.click()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(decline).toBeFocused()
    await expect(log).not.toContainText("You declined this inquiry.")

    await expectNoSeriousAxeViolations(page)
    await page.setViewportSize(viewportFor(390))
    await expectNoSeriousAxeViolations(page)
  })
})

test.describe("conversation without JavaScript (#174)", () => {
  // The row link opens `#conversation`, and globals.css sets `html { scroll-behavior: smooth }`. With scripts off and
  // smooth scrolling on, Playwright often never found Send stable, even after the page had stopped at its last scroll
  // position (seen locally on Edge once the thread was long enough to scroll). Reduced motion turns smooth scrolling
  // off; it changes nothing about how the form posts.
  test.use({ contextOptions: { reducedMotion: "reduce" }, javaScriptEnabled: false })

  test("hauler: the plain Send button posts a reply and the page comes back with it", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    test.skip(!(await ensureNewRiverInquiry(page)), NO_OPEN_JOB)
    await openV2(page, "/v2/inquiries")

    // Selecting North Pine Logging's inquiry is a plain link.
    await inquiryRows(page).filter({ hasText: NORTH_PINE.name }).first().getByRole("link").click()
    await page.waitForURL((url) => url.searchParams.has("inquiry"))
    const inquiry = new URL(page.url()).searchParams.get("inquiry")

    // The <noscript> submit stands in for the scripted Send; `required` is what blocks an empty reply here.
    const composer = page.locator("form:has(textarea[aria-label^='Reply to'])")
    await expect(composer.locator("textarea")).toHaveAttribute("required", "")
    await composer.locator("textarea").fill(PLAIN_FORM_REPLY)
    await composer.getByRole("button", { exact: true, name: "Send" }).click()

    await page.waitForURL((url) => url.searchParams.get("updated") === "reply" && url.searchParams.get("inquiry") === inquiry)
    await expect(page.getByRole("log")).toContainText(PLAIN_FORM_REPLY)
    await expect(page.locator("textarea[aria-label^='Reply to']")).toHaveValue("")
  })
})

/**
 * Visual baselines (#148 criterion 5): `toHaveScreenshot` at 1440 and 390 px, with the fonts self-hosted
 * (app/v2/_fonts) so the glyphs are the committed files, not whatever a machine has installed.
 *
 * Only screens the shared CI state cannot change are baselined: their content is fixed by the seed and no test in
 * either suite writes to it. The board, the job page and the inquiry pages are not: the pilot journeys run first on
 * the same state and publish, fill and close jobs, seed dates move with the calendar (apps/web/lib/seed-dates.ts),
 * and the DS cases above add an inquiry. Masking all of that would leave nothing to compare. Those pages stay
 * covered by the layout, keyboard and axe cases.
 *
 * The baselines are Linux Chromium renders from CI (`*-linux.png`, design-system.config.mjs). Text rasterises
 * differently on Windows and macOS and in branded channels such as Edge, so other platforms skip these cases rather
 * than compare against or write a second set. To add or update one: run CI, download the `design-system-traces`
 * artifact, and commit each case's `<name>-actual.png` as `design-system.spec.ts-snapshots/<name>-linux.png`.
 * Retries are off here: a baseline that only matches on a second attempt is not deterministic.
 */
test.describe("visual baselines (#148 criterion 5)", () => {
  test.describe.configure({ retries: 0 })
  test.skip(process.platform !== "linux" || Boolean(process.env.DS_E2E_CHANNEL), "Baselines are Linux Chromium renders from CI; other platforms rasterise text differently")

  const screens = [
    { email: null, heading: "Set up your business", name: "start", path: "/v2/start" },
    { email: null, heading: "This page is not available", name: "not-found", path: "/v2/work/00000000-0000-4000-8000-000000000000" },
    { email: "hank@northpine.example", heading: "Switch business", name: "switch", path: "/v2/switch" },
    { email: LANDING_WITHOUT_INQUIRIES, heading: "Hauler inquiries", name: "landing-inbox-empty", path: "/v2/landing/inquiries" }
  ] as const

  for (const { email, heading, name, path } of screens) {
    for (const width of [1440, 390]) {
      test(`${name} at ${width} px`, async ({ page }) => {
        await page.setViewportSize(viewportFor(width))
        if (email) await signIn(page, email)
        await openV2(page, path)
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
        await expectSelfHostedPlex(page)

        // Nothing hovered or focused: the pointer leaves wherever sign-in left it.
        await page.mouse.move(0, 0)
        await expect(page).toHaveScreenshot(`${name}-${width}.png`, { fullPage: true })
      })
    }
  }
})

/**
 * UX-13 (#136): the optional Find work map. The basemap is a network service, so these cases serve a stand-in CARTO
 * style (one background layer, no tiles, glyphs or sprites) and never depend on tiles loading; every marker is a DOM
 * button the page draws from its own data. The seed has fewer than 21 mappable jobs, so clustering is covered in
 * apps/web/lib/marketplace-v2/job-map.test.tsx.
 */
const STAND_IN_BASEMAP = {
  layers: [{ id: "background", paint: { "background-color": "#eef1ef" }, type: "background" }],
  name: "DS-05 stand-in basemap",
  sources: {},
  version: 8
}
const MAP_CANVAS = "Map of approximate job areas. Arrow keys pan, plus and minus zoom."

/** Serves the stand-in style for CARTO's style.json and refuses every other CARTO request, or fails them all. */
async function standInBasemap(page: Page, outcome: "style" | "down" = "style") {
  await page.route(/^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//, (route) => {
    if (outcome === "down") return route.fulfill({ body: "", status: 503 })
    if (/\/style\.json/.test(route.request().url())) {
      return route.fulfill({ body: JSON.stringify(STAND_IN_BASEMAP), contentType: "application/json" })
    }
    return route.abort()
  })
}

const jobMap = (page: Page) => page.getByRole("region", { exact: true, name: "Approximate job locations" })
const mapMarkers = (page: Page) => jobMap(page).locator("button[data-marker-key]")

/** /v2/work with the map open (and `all=1` when no job accepts interest), its markers drawn. */
async function openFindWorkMap(page: Page, width: number) {
  await page.setViewportSize(viewportFor(width))
  await standInBasemap(page)
  await openFindWorkWithRows(page)
  const url = new URL(page.url())
  url.searchParams.set("view", "map")
  await openV2(page, `${url.pathname}${url.search}`)
  await expect(jobMap(page)).toBeVisible()
  await expect(mapMarkers(page).first()).toBeVisible()
}

test.describe("find-work map (UX-13)", () => {
  for (const width of [1280, 390]) {
    test(`${width} px: 44 px targets around 32 px pins, the "Approximate areas" label and the attribution in view`, async ({ page }) => {
      await openFindWorkMap(page, width)
      const region = jobMap(page)

      for (const marker of await mapMarkers(page).all()) {
        const target = (await marker.boundingBox())!
        const pin = (await marker.locator("span").first().boundingBox())!
        expect(Math.min(target.width, target.height), "target size (--ll-target-touch)").toBeGreaterThanOrEqual(44)
        expect(Math.min(pin.width, pin.height), "visible pin (UX-13 criterion 1)").toBeGreaterThanOrEqual(32)
      }
      for (const control of await region.locator(".maplibregl-ctrl-group button").all()) {
        const box = (await control.boundingBox())!
        expect(Math.min(box.width, box.height), `${await control.getAttribute("aria-label")}: target size`).toBeGreaterThanOrEqual(44)
      }

      await expect(region.getByText("Approximate areas", { exact: true })).toBeInViewport()
      const attribution = region.locator(".maplibregl-ctrl-attrib")
      await expect(attribution).toBeInViewport()
      await expect(attribution.getByRole("link", { name: "OpenStreetMap" })).toBeVisible()
      await expect(attribution.getByRole("link", { name: "CARTO" })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      const showList = region.getByRole("link", { name: "Show list" })
      if (width >= 768) {
        await expect(showList).toBeHidden()
        return
      }

      // Below bp-md the map is the full-screen view: edge to edge, from the top of the screen down to the bottom tabs
      // (the tabs' height varies with the label font by a few px), never under them. It settles at the top again once
      // the web fonts have reflowed the page above it.
      await expect.poll(async () => Math.abs((await region.boundingBox())!.y), { message: "the map starts at the top of the screen" }).toBeLessThanOrEqual(1)
      const box = (await region.boundingBox())!
      const tabs = (await bottomTabs(page).boundingBox())!
      expect(box.x).toBe(0)
      expect(box.width).toBe(width)
      expect(box.y + box.height, "the map never runs under the bottom tabs").toBeLessThanOrEqual(tabs.y + 0.5)
      expect(box.y + box.height, "the map reaches the bottom tabs").toBeGreaterThan(tabs.y - 12)

      // The list is one tap away: the same search without view=map.
      expect((await showList.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await showList.click()
      await expect(page).not.toHaveURL(/[?&]view=map/)
      await expect(jobRows(page).first()).toBeVisible()
      await expect(jobMap(page)).toHaveCount(0)
    })
  }

  for (const width of [1280, 390]) {
    test(`${width} px: the map is keyboard reachable and every stop draws the design-system ring`, async ({ page }) => {
      await openFindWorkMap(page, width)
      const markerLabels = await mapMarkers(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")!))
      const rowTitles = (await jobRows(page).locator("h3 a").allInnerTexts()).map((title) => title.trim())

      const stops = await tabThrough(page)
      const keys = stops.map((stop) => stop.key)
      // The map sits at the top of the list column (#129): after the summary bar, before the list's tools (the sort,
      // offered with more than one job; the map toggle; density from bp-lg) and the rows.
      // Below bp-md the first Tab lands on the full-screen map's "Show list", so anchor on the map's own first stop.
      const tools = [...(rowTitles.length > 1 ? ["#work-sort"] : []), "Hide map", ...(width >= BP_LG ? ["Comfortable", "Compact"] : [])]
      const first = keys.indexOf(width < 768 ? "Show list" : MAP_CANVAS)
      const last = keys.indexOf(tools[0]!)
      expect(first, "the map is reachable by keyboard").toBeGreaterThanOrEqual(0)
      if (first > 0) expect(keys[first - 1], "the map follows the summary bar").toBe("#work-filters-summary")

      expect(keys.slice(first, last)).toEqual([
        ...(width < 768 ? ["Show list"] : []),
        MAP_CANVAS,
        ...markerLabels,
        "Zoom in",
        "Zoom out",
        "OpenStreetMap",
        "CARTO"
      ])
      // The list stays complete and reachable after the map and its tools.
      expect(keys.slice(last, last + tools.length + rowTitles.length)).toEqual([...tools, ...rowTitles])
      for (const stop of stops.slice(first, last)) expectDesignSystemRing(stop)
    })
  }

  for (const width of [1280, 390]) {
    test(`${width} px: a pin opens its preview sheet over the map without resizing it; Escape and Close return focus to the pin`, async ({ page }) => {
      await openFindWorkMap(page, width)
      const region = jobMap(page)
      const pin = mapMarkers(page).first()
      const canvas = region.locator(".maplibregl-canvas")
      const mapSize = async () => {
        const box = (await canvas.boundingBox())!
        return { height: box.height, width: box.width }
      }
      // Where the camera puts the pin: relative to the map, so page scrolling does not count.
      const pinOnMap = async () => {
        const [marker, map] = await Promise.all([pin.boundingBox(), canvas.boundingBox()])
        return { x: marker!.x - map!.x, y: marker!.y - map!.y }
      }
      const expectSamePlace = (actual: { x: number; y: number }, expected: { x: number; y: number }, message: string) => {
        expect(Math.abs(actual.x - expected.x) + Math.abs(actual.y - expected.y), message).toBeLessThanOrEqual(1)
      }
      const size = await mapSize()

      await pin.focus()
      await page.keyboard.press("Enter")
      const sheet = region.getByRole("region", { name: /in this area$/ })
      await expect(sheet).toBeVisible()
      await expect(pin).toHaveAttribute("aria-expanded", "true")
      await expect(pin).toHaveAttribute("aria-controls", (await sheet.getAttribute("id"))!)
      await expect(sheet.getByRole("heading", { level: 2 })).toBeFocused()
      expect(await mapSize(), "opening the sheet never resizes the map").toEqual(size)

      // The preview links each job. It covers part of the map, but never the pin, the "Approximate areas" label, the
      // attribution or the zoom buttons.
      const links = sheet.getByRole("list", { name: "Jobs in this area" }).getByRole("link")
      expect(await links.count()).toBeGreaterThan(0)
      for (const href of await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")))) {
        expect(href).toMatch(/^\/v2\/work\/[^/?#]+$/)
      }
      // Find work passes each job's public card (#129, #183): every link is a full JobResultRow's title, not a bare link.
      await expect(sheet.getByRole("list", { name: "Jobs in this area" }).locator("li h3 a")).toHaveCount(await links.count())
      const sheetBox = (await sheet.boundingBox())!
      const uncovered = [
        ["the pin", pin],
        ["the label", region.getByText("Approximate areas", { exact: true })],
        ["the attribution", region.locator(".maplibregl-ctrl-attrib")],
        ["the zoom buttons", region.locator(".maplibregl-ctrl-group")]
      ] as const
      for (const [name, locator] of uncovered) {
        await expect(locator).toBeInViewport()
        const box = (await locator.boundingBox())!
        const overlaps = box.x < sheetBox.x + sheetBox.width && sheetBox.x < box.x + box.width && box.y < sheetBox.y + sheetBox.height && sheetBox.y < box.y + box.height
        expect(overlaps, `the sheet covers ${name}`).toBe(false)
      }
      const opened = await pinOnMap()

      // The audit grows the viewport to the page's height and back; the camera ends where it was.
      await expectNoSeriousAxeViolations(page)
      expectSamePlace(await pinOnMap(), opened, "a window resize leaves the camera where it was")

      await sheet.getByRole("heading", { level: 2 }).focus()
      await page.keyboard.press("Escape")
      await expect(sheet).toHaveCount(0)
      await expect(pin).toBeFocused()
      await expect(pin).toHaveAttribute("aria-expanded", "false")
      expect(await mapSize(), "closing the sheet never resizes the map").toEqual(size)
      expectSamePlace(await pinOnMap(), opened, "closing the sheet never moves the camera")

      await pin.click()
      await expect(sheet).toBeVisible()
      await sheet.getByRole("button", { name: "Close job preview" }).click()
      await expect(sheet).toHaveCount(0)
      await expect(pin).toBeFocused()
      expectSamePlace(await pinOnMap(), opened, "reopening and closing leave the camera where it was")
    })
  }

  test("when the basemap is down the map says so and the list stays complete", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await standInBasemap(page, "down")
    await openFindWorkWithRows(page)
    const rows = await jobRows(page).count()
    const url = new URL(page.url())
    url.searchParams.set("view", "map")
    await openV2(page, `${url.pathname}${url.search}`)

    await expect(page.getByRole("status").filter({ hasText: "The map could not load right now. Every job is listed below." })).toBeVisible()
    await expect(jobMap(page)).toHaveCount(0)
    await expect(jobRows(page)).toHaveCount(rows)
  })
})

/**
 * #124 criterion 8's dual-membership account. Maya Mills drives for North Pine Logging: a hauling business where a
 * driver holds no landing seat, so that context shows hauler navigation only. Summit Ridge Timber is a landing
 * business, so her dispatcher seat there shows landing navigation only. The seed gives her North Pine only.
 */
const DUAL = { email: "maya@northpine.example", hauling: "North Pine Logging", landing: "Summit Ridge Timber", name: "Maya Mills" }
const SUMMIT_OWNER = "cole@summit.example"
const HAULER_NAVIGATION = ["Find work", "My inquiries"]
const LANDING_NAVIGATION = ["Overview", "Landing inbox", "Post jobs", "Landings"]

const businessChoices = (page: Page) => page.getByRole("list", { name: "Your businesses" }).getByRole("listitem")

/** A fresh browser session for another account, at the suite's base URL. */
async function session(browser: Browser, baseURL: string | undefined, width = 1280) {
  const context = await browser.newContext({ baseURL, viewport: viewportFor(width) })
  return { close: () => context.close(), page: await context.newPage() }
}

/** Opens Summit Ridge Timber's legacy team settings as its owner: the app's only member-management page. */
async function openSummitTeam(browser: Browser, baseURL: string | undefined) {
  const owner = await session(browser, baseURL)
  await signInToV2(owner.page, SUMMIT_OWNER)
  await owner.page.goto("/host/settings")
  await expect(owner.page.getByRole("heading", { name: "Who works in this workspace" })).toBeVisible()
  return owner
}

/**
 * Makes Maya a Summit Ridge Timber member through the app, unless she is one: Summit's owner invites her as a
 * dispatcher (unless an invitation is already waiting) and she accepts from the legacy account menu, the only
 * place an existing account accepts an invitation today. Accepting a removed membership restores the same row.
 */
async function ensureDualMembership(browser: Browser, baseURL: string | undefined) {
  const maya = await session(browser, baseURL)

  try {
    await signInToV2(maya.page, DUAL.email)
    await openV2(maya.page, "/v2/switch")
    if ((await businessChoices(maya.page).filter({ hasText: DUAL.landing }).count()) > 0) return

    const owner = await openSummitTeam(browser, baseURL)
    try {
      const waiting = owner.page.getByRole("group", { name: "Waiting invitations" }).getByText(DUAL.email)
      if ((await waiting.count()) === 0) {
        await owner.page.getByLabel("Email address").fill(DUAL.email)
        await owner.page.getByLabel("Role", { exact: true }).selectOption({ label: "Dispatcher" })
        await owner.page.getByRole("button", { name: "Invite to workspace" }).click()
        await expect(owner.page.getByText(/Invitation recorded/)).toBeVisible()
      }
    } finally {
      await owner.close()
    }

    await maya.page.goto("/driver/profile")
    await maya.page.getByRole("button", { name: "Account and product feedback" }).click()
    const invitations = maya.page.getByRole("group", { name: "Workspace invitations" })
    await expect(invitations.getByText(DUAL.landing)).toBeVisible()
    await invitations.getByRole("button", { name: "Accept" }).click()
    // Accepting opens /workspace, which redirects to the newly selected business's V2 home.
    await settleOnV2(maya.page)

    await openV2(maya.page, "/v2/switch")
    await expect(businessChoices(maya.page).filter({ hasText: DUAL.landing }), "Maya holds the Summit membership again").toHaveCount(1)
  } finally {
    await maya.close()
  }
}

/**
 * Presses an "Act as …" button and returns where the server sends the account: the action response's
 * `x-action-redirect`. It is read from the response, not the address bar: while a loading boundary sat above every
 * route (before #174), CI's production build stopped short of an action's redirect, the reply composer's symptom
 * in PR #179's diagnostics and here an empty /v2/landing. Callers then open the page they check with a full
 * navigation.
 */
async function chooseBusiness(page: Page, button: Locator): Promise<string> {
  const before = page.url()
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/v2/switch")
  await button.click()
  const target = ((await (await posted).headerValue("x-action-redirect")) ?? "").split(";")[0]!
  // Let the client router finish whatever it does with that redirect before the caller's next navigation.
  await page.waitForURL((url) => url.href !== before, { timeout: 10_000 }).catch(() => undefined)
  return target
}

/** Acts as `business` from /v2/switch, then opens `then` (a page of that context). Returns the server's landing path. */
async function actAs(page: Page, business: string, then: string): Promise<string> {
  await openV2(page, "/v2/switch")
  const home = await chooseBusiness(page, businessChoices(page).filter({ hasText: business }).getByRole("button", { name: `Act as ${business}` }))
  await openV2(page, then)
  return home
}

test.describe("business switching with two memberships (#124 criterion 8)", () => {
  test("landing → hauling shows only hauler navigation at 1280 and 390 px; a removed membership is refused on the next request", async ({ baseURL, browser, page }) => {
    // Several sessions, two legacy pages and a cold `next dev` compile of each: triple the budget.
    test.slow()
    await ensureDualMembership(browser, baseURL)

    await page.setViewportSize(viewportFor(1280))
    await signInToV2(page, DUAL.email)

    for (const width of [1280, 390]) {
      await page.setViewportSize(viewportFor(width))

      expect(await actAs(page, DUAL.landing, "/v2/landing/inquiries"), "a landing context lands on its V2 home").toBe("/v2/landing")
      expect(await expectNavigationForWidth(page, width), `${width} px: the landing context`).toEqual(LANDING_NAVIGATION)

      expect(await actAs(page, DUAL.hauling, "/v2/work"), "a hauling context lands on its V2 home").toBe("/v2/work")
      expect(await expectNavigationForWidth(page, width), `${width} px: only hauler navigation`).toEqual(HAULER_NAVIGATION)
      await expectCurrent(page, width, "Find work")
      await expect(page.getByRole("link", { name: /^Acting as North Pine Logging/ })).toHaveCount(1)
      await expectNoHorizontalOverflow(page)
      if (width < BP_LG) expect(await chromeHeight(page), "chrome above the content at 390 px").toBeLessThanOrEqual(120)
    }

    // When Summit removes her, Maya has one session acting for Summit (390 px) and one acting for North Pine with
    // the switch page, which still offers Summit, open (1280 px).
    const asLanding = await session(browser, baseURL, 390)
    await signInToV2(asLanding.page, DUAL.email)
    await actAs(asLanding.page, DUAL.landing, "/v2/landing/inquiries")
    await expect(asLanding.page.getByRole("link", { name: /^Acting as Summit Ridge Timber/ })).toHaveCount(1)

    await page.setViewportSize(viewportFor(1280))
    await openV2(page, "/v2/switch")
    const staleSwitch = page.getByRole("button", { name: `Act as ${DUAL.landing}` })
    await expect(staleSwitch).toBeVisible()

    const owner = await openSummitTeam(browser, baseURL)
    owner.page.once("dialog", (dialog) => void dialog.accept())
    const removal = owner.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/host/settings")
    await owner.page.getByRole("button", { name: `Remove ${DUAL.name}` }).click()
    await removal
    // A fresh load of the roster, which lists no removed member: her row and its Remove control are gone.
    await owner.page.reload()
    await expect(owner.page.getByRole("heading", { name: "Who works in this workspace" })).toBeVisible()
    await expect(owner.page.getByRole("button", { name: `Remove ${DUAL.name}` })).toHaveCount(0)
    await owner.close()

    // The next request acting for Summit is refused: no business, the public board only, and the account menu
    // still offers Switch business.
    await openV2(asLanding.page, "/v2/landing/inquiries")
    await expect(asLanding.page.locator("#main")).toContainText("No landing business is selected for your account.")
    await expect(asLanding.page.getByRole("link", { name: /^Acting as/ })).toHaveCount(0)
    expect(await expectNavigationForWidth(asLanding.page, 390)).toEqual(["Find work"])
    await accountTrigger(asLanding.page).click()
    await expect(accountMenu(asLanding.page).getByRole("link", { name: "Switch business" })).toHaveAttribute("href", "/v2/switch")
    await asLanding.close()

    // The stale switch to Summit is refused on the server; Maya stays on North Pine with hauler navigation.
    expect(await chooseBusiness(page, staleSwitch), "the server refuses the switch").toBe("/v2/switch?unavailable=1")
    await openV2(page, "/v2/switch?unavailable=1")
    await expect(page.locator("#main").getByRole("alert")).toContainText("That business is not available to your account right now.")
    await expect(businessChoices(page).filter({ hasText: DUAL.landing })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /^Acting as North Pine Logging/ })).toHaveCount(1)
    expect(await expectNavigationForWidth(page, 1280)).toEqual(HAULER_NAVIGATION)

    // Restore the membership this case removed: Summit invites Maya back and she accepts.
    await ensureDualMembership(browser, baseURL)
  })
})

/**
 * #127 (UX-04): landing business setup and plans, the landings list and the landing editor. Summit Ridge Timber's
 * owner (cole@summit.example) manages Blue River Landing in the seed. The pilot store cannot save V2 landings, so
 * the form posts and the page answers that saving isn't available, with the input kept: nothing in these cases
 * writes. The private half of the seeded landings (pilot contact phone, entrance and site coordinates, gate notes)
 * must appear on the landing's own editor and nowhere else.
 */
const LANDING_OWNER = SUMMIT_OWNER
const BLUE_RIVER = { id: "66666666-6666-4666-8666-666666666662", name: "Blue River Landing" }
const BLUE_RIVER_PRIVATE = ["555-1003", "44.1919", "-122.0925", "44.1926", "-122.0898", "Summit dispatcher confirms gate status"]
const OAK_LANDING_PRIVATE = ["555-2002", "43.7463", "-122.4628", "43.7471", "-122.4617", "Gate code rotates daily"]
const LANDING_PAGES = [
  { email: null, heading: "Set up your landing business", path: "/v2/start/landing", root: "landing-setup" },
  { email: LANDING_OWNER, heading: "Landings", path: "/v2/landing/landings", root: "landings" },
  { email: LANDING_OWNER, heading: "Add a landing", path: "/v2/landing/landings/new", root: "landing-editor" },
  { email: LANDING_OWNER, heading: "Edit landing", path: `/v2/landing/landings/${BLUE_RIVER.id}`, root: "landing-editor" }
] as const

/**
 * The HTML the server sends for a page, fetched by navigating so the browser's own session cookie goes with it (an
 * API request does not send the production build's Secure cookie over plain http). A redirect, for example to
 * sign-in, fails rather than letting an absence check pass on the wrong page.
 */
async function pageHtml(page: Page, path: string): Promise<string> {
  const response = await page.goto(path)
  expect(response?.status(), `${path} answers`).toBe(200)
  const served = new URL(response!.url())
  expect(`${served.pathname}${served.search}`, `${path} is served without a redirect`).toBe(path)
  return response!.text()
}

const landingForm = (page: Page) => page.locator("[data-ds-page='landing-editor'] form").filter({ has: page.locator("input[name='name']") })

test.describe("landing workspace (#127)", () => {
  test("responsive at 1440 and 390 px: no overflow, the width's navigation, Landings current on landing pages", async ({ page }) => {
    for (const { email, heading, path, root } of LANDING_PAGES) {
      await page.context().clearCookies()
      if (email) await signIn(page, email)

      for (const width of [1440, 390]) {
        await page.setViewportSize(viewportFor(width))
        await openV2(page, path)
        await expect(page.locator(`[data-ds-page='${root}']`)).toBeVisible()
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()

        await expectNoHorizontalOverflow(page)
        const items = await expectNavigationForWidth(page, width)
        if (email) {
          expect(items).toEqual(LANDING_NAVIGATION)
          await expectCurrent(page, width, "Landings")
        } else {
          expect(items).toEqual(["Find work"])
        }
      }
    }
  })

  test("plans: every card from the contracts, billing stated as inactive, no checkout", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await openV2(page, "/v2/start/landing")

    const plans = page.getByRole("list", { name: "Landing plans" }).locator(":scope > li")
    await expect(plans).toHaveCount(3)
    for (const [name, price, landings, team, invitations] of [
      ["Basic", "$149 per month", "1 active landing", "2 team members, including you", "3 targeted invitations per billing cycle"],
      ["Pro", "$299 per month", "3 active landings", "5 team members, including you", "10 targeted invitations per billing cycle"],
      ["Regional", "$499 per month", "Unlimited active landings", "10 team members, including you", "30 targeted invitations per billing cycle"]
    ] as const) {
      const card = plans.filter({ has: page.getByRole("heading", { level: 3, name }) })
      for (const fact of [price, landings, team, invitations]) await expect(card.getByText(fact, { exact: true })).toBeVisible()
    }
    await expect(page.getByText("Billing isn't active yet. You can set up landings and draft jobs.")).toBeVisible()
    await expect(page.locator("[data-ds-page='landing-setup']").getByRole("button", { name: /checkout|subscribe|buy|pay/i })).toHaveCount(0)
    await expect(page.locator("[data-ds-page='landing-setup']").getByRole("link", { name: /checkout|subscribe|buy|pay/i })).toHaveCount(0)
  })

  test("the landings list shows the plan count and status actions, and none of the private half", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, LANDING_OWNER)
    await openV2(page, "/v2/landing/landings")

    const row = page.getByRole("list", { name: "Your landings" }).locator(":scope > li").filter({ hasText: BLUE_RIVER.name })
    await expect(row.getByText("Recruiting", { exact: true })).toBeVisible()
    await expect(row.getByRole("button", { name: `Pause ${BLUE_RIVER.name}` })).toBeVisible()
    await expect(page.locator("[data-ds-page='landings'] header")).toContainText("active landing")

    const listHtml = await pageHtml(page, "/v2/landing/landings")
    for (const secret of BLUE_RIVER_PRIVATE) expect(listHtml, `the list page never carries ${secret}`).not.toContain(secret)

    // The landing's own editor is where its team sees the private half, inside the private panel only.
    const editorHtml = await pageHtml(page, `/v2/landing/landings/${BLUE_RIVER.id}`)
    const privateAt = editorHtml.indexOf('aria-label="Private · your team only"')
    expect(privateAt).toBeGreaterThan(0)
    expect(editorHtml.slice(privateAt)).toContain("555-1003")
    expect(editorHtml.slice(privateAt)).toContain("44.1919")
  })

  test("public pages never carry a landing's private half (criterion 4)", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    const paths = ["/v2/work", "/v2/work?all=1", await firstJobPath(page)]
    await openV2(page, "/v2/work?all=1")
    const northPine = northPineJobLink(page)
    if ((await northPine.count()) > 0) paths.push((await northPine.getAttribute("href"))!)

    for (const path of paths) {
      const body = await pageHtml(page, path)
      for (const secret of [...BLUE_RIVER_PRIVATE, ...OAK_LANDING_PRIVATE]) expect(body, `${path} never carries ${secret}`).not.toContain(secret)
    }
  })

  test("keyboard: every stop on the landing pages keeps the design-system ring", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, LANDING_OWNER)

    for (const path of ["/v2/landing/landings", "/v2/landing/landings/new", "/v2/start/landing"]) {
      await openV2(page, path)
      const stops = await tabThrough(page)

      expect(stops.filter((stop) => stop.where === "main").length, `${path}: focus reaches the page content`).toBeGreaterThan(0)
      for (const stop of stops) expectDesignSystemRing(stop)
    }

    // The form's fields are reachable in reading order: the public half first, then the private half.
    await openV2(page, "/v2/landing/landings/new")
    const main = (await tabThrough(page)).filter((stop) => stop.where === "main").map((stop) => stop.key)
    expect(main.indexOf("#landing-name")).toBeGreaterThanOrEqual(0)
    expect(main.indexOf("#landing-name")).toBeLessThan(main.indexOf("#landing-lat"))
    expect(main.indexOf("#landing-lat")).toBeLessThan(main.indexOf("#landing-gate"))
  })

  for (const width of [1440, 390]) {
    test(`the landing pages at ${width} px have no serious or critical axe violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))
      await openV2(page, "/v2/start/landing")
      await expectNoSeriousAxeViolations(page)

      await signIn(page, LANDING_OWNER)
      for (const path of ["/v2/landing/landings", "/v2/landing/landings/new", `/v2/landing/landings/${BLUE_RIVER.id}`]) {
        await openV2(page, path)
        await expectNoSeriousAxeViolations(page)
      }
    })
  }
})

test.describe("the landing form without JavaScript (#127)", () => {
  // As in "conversation without JavaScript": globals.css sets smooth scrolling, and with scripts off Playwright never
  // found Save landing stable at 1440 px (seen locally on Edge). Reduced motion turns it off; the form posts the same.
  test.use({ contextOptions: { reducedMotion: "reduce" }, javaScriptEnabled: false })

  test("posts to the server, which says saving isn't available and keeps what was typed; no exact location needed", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, LANDING_OWNER)
    await openV2(page, "/v2/landing/landings/new")

    const form = landingForm(page)
    await form.getByLabel("Landing name").fill("Hills Creek Unit 4")
    await form.getByLabel("Nearest town").fill("Oakridge")
    await form.getByLabel("State", { exact: true }).fill("OR")
    await form.getByLabel("Gate and access instructions").fill("Blue gate past the scale")
    await form.getByRole("button", { name: "Save landing" }).click()

    await expect(page.getByRole("status").filter({ hasText: "Saving landings isn't available in this preview yet" })).toBeVisible()
    const kept = landingForm(page)
    await expect(kept.getByLabel("Landing name")).toHaveValue("Hills Creek Unit 4")
    await expect(kept.getByLabel("Nearest town")).toHaveValue("Oakridge")
    await expect(kept.getByLabel("Gate and access instructions")).toHaveValue("Blue gate past the scale")
    await expect(kept.getByLabel("Latitude")).toHaveValue("")
  })

  test("a refused field comes back next to the field, with the rest kept", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, LANDING_OWNER)
    await openV2(page, "/v2/landing/landings/new")

    const form = landingForm(page)
    await form.getByLabel("Landing name").fill("Gate code 4417 landing")
    await form.getByLabel("Nearest town").fill("Oakridge")
    await form.getByLabel("State", { exact: true }).fill("OR")
    await form.getByRole("button", { name: "Save landing" }).click()

    await expect(page.getByRole("alert").filter({ hasText: "Remove coordinates and gate or lock codes" })).toBeVisible()
    await expect(landingForm(page).getByLabel("Landing name")).toHaveAttribute("aria-invalid", "true")
    await expect(landingForm(page).getByLabel("Nearest town")).toHaveValue("Oakridge")
  })
})

/**
 * #133 (UX-10): the landing overview at /v2/landing. Summit Ridge Timber (landing only) and North Pine Logging (both
 * sides) in the seed. The pilot store cannot save a reconfirmation, so Confirm is shown inert with that note and
 * nothing in these cases writes.
 */
const OVERVIEW_ACCOUNTS = [
  { email: LANDING_OWNER, items: LANDING_NAVIGATION },
  // Both sides: five destinations, the bottom tabs' limit; Landings is one tap away under Overview.
  { email: "dispatch@northpine.example", items: ["Find work", "My inquiries", "Overview", "Landing inbox", "Post jobs"] }
] as const

test.describe("landing overview (#133)", () => {
  test("responsive at 1440 and 390 px: no overflow, Overview current, the action row in order", async ({ page }) => {
    for (const { email, items } of OVERVIEW_ACCOUNTS) {
      await page.context().clearCookies()
      await signIn(page, email)

      for (const width of [1440, 390]) {
        await page.setViewportSize(viewportFor(width))
        await openV2(page, "/v2/landing")
        await expect(page.locator("[data-ds-page='landing-overview']")).toBeVisible()
        await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()

        await expectNoHorizontalOverflow(page)
        expect(await expectNavigationForWidth(page, width)).toEqual([...items])
        await expectCurrent(page, width, "Overview")

        const actions = page.locator("[data-ds-page='landing-overview'] header").getByRole("link").or(
          page.locator("[data-ds-page='landing-overview'] header").getByRole("button")
        )
        const labels = (await actions.allInnerTexts()).map((label) => label.trim()).filter((label) => /^(Post a job|Inbox|Find trucks)/.test(label))
        expect(labels.map((label) => label.replace(/ \(.*\)$/, ""))).toEqual(["Post a job", "Inbox", "Find trucks"])
        expect(labels[1]).toMatch(/^Inbox \(\d+ new\)$/)
      }
    }
  })

  test("states allowances from the contracts and billing as inactive, and no hired-truck, load or revenue figure", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, LANDING_OWNER)
    await openV2(page, "/v2/landing")
    const overview = page.locator("[data-ds-page='landing-overview']")

    const cycle = overview.getByRole("region", { name: "This billing cycle" })
    await expect(cycle).toContainText("None active · billing isn't active yet")
    await expect(cycle).toContainText("None while billing is inactive")
    await expect(cycle).toContainText("Billing isn't active yet")
    await expect(overview).not.toContainText(/hired|revenue|earnings|loads (hauled|delivered|completed)|tons hauled/i)

    // Find trucks is announced as unavailable, not a dead link.
    await expect(overview.getByRole("button", { name: "Find trucks" })).toHaveAttribute("aria-disabled", "true")

    const body = await pageHtml(page, "/v2/landing")
    for (const secret of BLUE_RIVER_PRIVATE) expect(body, `the overview never carries ${secret}`).not.toContain(secret)
  })

  test("a listing past the interval offers one-tap Confirm, inert with a note while the store can't save it", async ({ page }) => {
    await page.setViewportSize(viewportFor(1440))
    await signIn(page, "dispatch@northpine.example")
    await openV2(page, "/v2/landing")

    const attention = page.getByRole("list", { name: "Needs attention" })
    const confirm = attention.getByRole("button", { name: "Confirm still available" })
    test.skip((await confirm.count()) === 0, "No North Pine Logging listing is past the confirmation interval in this run's state")

    await expect(confirm.first()).toHaveAttribute("aria-disabled", "true")
    await expect(page.getByText("Confirming isn't saved in this preview.")).toBeVisible()
    await expect(page.getByText(/Confirm records your statement: .I confirm this job is currently available as described../)).toBeVisible()
  })

  test("keyboard: every stop on the overview keeps the design-system ring", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))

    for (const { email } of OVERVIEW_ACCOUNTS) {
      await page.context().clearCookies()
      await signIn(page, email)
      await openV2(page, "/v2/landing")
      const stops = await tabThrough(page)

      expect(stops.filter((stop) => stop.where === "main").map((stop) => stop.key)).toEqual(expect.arrayContaining(["Post a job", "Find trucks"]))
      for (const stop of stops) expectDesignSystemRing(stop)
    }
  })

  for (const width of [1440, 390]) {
    test(`the overview at ${width} px has no serious or critical axe violations`, async ({ page }) => {
      await page.setViewportSize(viewportFor(width))

      for (const { email } of OVERVIEW_ACCOUNTS) {
        await page.context().clearCookies()
        await signIn(page, email)
        await openV2(page, "/v2/landing")
        await expectNoSeriousAxeViolations(page)
      }
    })
  }
})

test.describe("the landing overview without JavaScript (#133)", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" }, javaScriptEnabled: false })

  test("the server sends the whole overview: the action row as plain links, the allowances and the checklist or attention list", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await signIn(page, LANDING_OWNER)
    await openV2(page, "/v2/landing")
    const overview = page.locator("[data-ds-page='landing-overview']")

    await expect(overview.getByRole("link", { name: "Post a job" })).toHaveAttribute("href", "/v2/landing/jobs/new")
    await expect(overview.getByRole("link", { name: /^Inbox \(\d+ new\)$/ })).toHaveAttribute("href", "/v2/landing/inquiries")
    await expect(overview.getByRole("region", { name: "This billing cycle" })).toBeVisible()
    await expect(overview.getByRole("region", { name: "Get started" }).or(overview.getByRole("region", { name: "Needs attention" }))).toBeVisible()
  })
})
