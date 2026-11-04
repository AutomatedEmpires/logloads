import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * DS-05 (#148): responsive, keyboard and style-isolation regressions for the V2 design system, run against the
 * real app with Marketplace V2 enabled (design-system.config.mjs). Pages count as migrated when their root
 * carries `data-ds-page`; since DS-04 (#147) that is every V2 page and v2.css is gone. Cases that need a page or
 * data nobody has built yet are `test.fixme` with what they wait for, never faked.
 *
 * Writes: the conversation cases need an inquiry, and the seed has none. New River Hauling (a hauling business
 * with no trucks listed) expresses interest in the one public job, North Pine Logging's, and replies on it. Nothing
 * else in the suite writes, and nothing declines or withdraws; the no-JavaScript interest case posts once with a date
 * range the server refuses, which writes nothing. The equipment case signs in as Granite Creek Hauling (equipment
 * listed) and submits one offer above its listing, which the server refuses without writing. When no job accepts
 * interest in the shared CI state those cases are skipped with that reason, not passed.
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

const topNavigation = (page: Page) => page.locator(".ll-app > header nav[aria-label='Main']")
const bottomTabs = (page: Page) => page.locator(".ll-app > nav[aria-label='Main']")
const jobRows = (page: Page) => page.locator("[data-ds-page] ul[aria-label='Jobs'] > li")

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
        await expect(page.locator("#work-q")).toBeFocused()
      })

      test("no horizontal overflow with web fonts blocked (fallback stack)", async ({ page }) => {
        await page.route(/\.(woff2?|ttf|otf)(\?.*)?$/, (route) => route.abort())
        await openV2(page, "/v2/work")

        await expectNoHorizontalOverflow(page)
        await expect(page.getByRole("heading", { level: 1, name: "Find hauling work" })).toBeVisible()
        await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled()
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
      expect(await expectNavigationForWidth(page, width)).toEqual(["Landing inbox", "Post jobs"])
      await expectCurrent(page, width, "Landing inbox")
    }
  })
})

test.describe("capability navigation (#124)", () => {
  const cases = [
    { email: "hank@northpine.example", home: "/v2/work", items: ["Find work", "My inquiries"], visit: "/v2/inquiries", current: "My inquiries" },
    { email: "cole@summit.example", home: "/v2/landing", items: ["Landing inbox", "Post jobs"], visit: "/v2/landing/inquiries", current: "Landing inbox" },
    {
      email: "dispatch@northpine.example",
      home: "/v2/work",
      items: ["Find work", "My inquiries", "Landing inbox", "Post jobs"],
      visit: "/v2/inquiries",
      current: "My inquiries"
    }
  ] as const

  for (const { email, home, items, visit, current } of cases) {
    test(`${email} sees ${items.join(", ")}`, async ({ page }) => {
      await page.setViewportSize(viewportFor(1280))
      await signIn(page, email)
      // Sign-in lands on the business's V2 home (#124). /v2/landing redirects into the job editor, which is
      // checked here by path only: its pages are being migrated separately.
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
        "#work-q",
        "#work-equipment",
        "#work-pay",
        "Apply",
        "#work-all",
        "Show map",
        // One stop per job row (its title link), in list order; there is no Save button on this page yet.
        ...rowTitles,
        ...tabs
      ])
      expect(stops.find((stop) => stop.key === "Find work")?.where).toBe(width >= BP_LG ? "chrome" : "tabs")

      for (const stop of stops) expectDesignSystemRing(stop)
    })
  }

  test("a signed-in hauler's chrome: navigation and business switcher keep the design-system ring", async ({ page }) => {
    await page.setViewportSize(viewportFor(1280))
    await signIn(page, "hank@northpine.example")
    await openV2(page, "/v2/work")

    const stops = await tabThrough(page, 6)
    const chrome = stops.filter((stop) => stop.where === "chrome")

    expect(chrome.map((stop) => stop.key)).toEqual([
      "Skip to main content",
      "LogLoads home",
      "Find work",
      "My inquiries",
      // The switcher's first text line; its full accessible name (visible text plus hidden words) is asserted in the
      // capability-navigation tests.
      "Acting as"
    ])
    for (const stop of chrome) expectDesignSystemRing(stop)
  })

  test("Enter on a job row's link opens the job (below 1200 px it navigates)", async ({ page }) => {
    await page.setViewportSize(viewportFor(390))
    await openFindWorkWithRows(page)

    const link = jobRows(page).first().locator("h3 a")
    const href = await link.getAttribute("href")
    expect(href).toMatch(/^\/v2\/work\/[^/]+$/)

    await link.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(new RegExp(`${href}$`))
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
      const filters = page.getByRole("search", { name: "Filter jobs" })
      const search = filters.getByLabel("Search")

      // The page rendered the box from the query, so the next search still includes every listing.
      await expect(filters.getByRole("checkbox", { name: "Include filled, paused and closed jobs" })).toBeChecked()

      await search.fill(title)
      await filters.getByRole("button", { name: "Apply" }).click()
      await page.waitForURL((url) => url.searchParams.get("q") === title && url.searchParams.get("all") === "1")
      await expect(search).toHaveValue(title)
      await expect(jobRows(page).filter({ hasText: title }).first()).toBeVisible()

      await search.fill("no listing matches this zqxv")
      await filters.getByRole("button", { name: "Apply" }).click()
      await page.waitForURL((url) => url.searchParams.get("q") === "no listing matches this zqxv")
      await expect(jobRows(page)).toHaveCount(0)
      await expect(page.getByText("No jobs match right now")).toBeVisible()
      await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/v2/work")
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

test.describe("waiting on page migrations", () => {
  test.fixme(`DetailPanel shows beside the job list at ${BP_XL} px and up, and never below`, async () => {
    // No V2 page renders ContentGrid layout="list-detail" with a DetailPanel yet; /v2/work is layout="single".
    // When the find-work page adopts list-detail (#147 follow-up): at 1440 and 1280 the panel (an <aside> with the
    // job's label) is visible beside the list; at 1024, 768 and 390 it is absent and no overflow appears.
  })

  test.fixme("selecting a job row updates the DetailPanel", async () => {
    // Needs the list-detail find-work page: click and Enter on a row link set aria-current="true" on that link and
    // show the same job in the panel, without navigating.
  })

  test.fixme(`below ${BP_XL} px a row opens a dialog; Escape closes it and focus returns to the row link`, async () => {
    // Needs the list-detail find-work page and its Dialog sheet (#146 Gate 3): focus moves into the dialog, which
    // carries ll-theme; Escape, Close and Cancel each close it and return focus to the opener.
  })

  test.fixme("switching density keeps the selection", async () => {
    // No page offers a density control yet (AppShell renders data-density="comfortable" only). Once one does,
    // selecting a row, switching to compact and back keeps the same row selected and the panel on it.
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
