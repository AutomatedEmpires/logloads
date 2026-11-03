import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * DS-05 (#148): responsive, keyboard and style-isolation regressions for the V2 design system, run against the
 * real app with Marketplace V2 enabled (design-system.config.mjs). Pages count as migrated when their root
 * carries `data-ds-page`; today that is /v2/work only. Cases that need a page nobody has built yet are
 * `test.fixme` with the page they wait for, never faked.
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

/** Opens a V2 page and waits until the shell has replaced the root loading skeleton. */
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

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false })

    test.fixme("the row's title link still lists and opens the job", async ({ page }) => {
      // Fails today: app/loading.tsx is a Suspense boundary above every route, so a dynamic page arrives as the
      // skeleton plus a hidden streamed segment that only React's inline script reveals. With JavaScript off the
      // visitor sees the skeleton and no jobs (observed on `next dev`, 2026-11-02). Needs a product decision on
      // the root loading boundary for /v2; not a design-system component defect.
      await page.goto("/v2/work")
      const link = jobRows(page).first().locator("h3 a")
      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(/\/v2\/work\/[^/]+$/)
    })
  })
})

test.describe("style isolation", () => {
  test("/v2/work: the shell carries the theme and nothing resolves to a legacy font", async ({ page }) => {
    await openV2(page, "/v2/work")

    await expect(page.locator(".ll-app")).toHaveClass(/\bll-theme\b/)
    expect(await page.locator(".ll-app").evaluate((root) => getComputedStyle(root).getPropertyValue("--ll-color-action").trim())).not.toBe("")

    // Legacy globals.css styles bare h1–h3 and :focus-visible; on a migrated page the components decide.
    const leaks = await page.locator(".ll-app").evaluate((root, legacy) => {
      const pattern = new RegExp(legacy)
      return Array.from(root.querySelectorAll("*"))
        .filter((element) => !element.closest(".v2:not(:has([data-ds-page]))"))
        .filter((element) => (element as HTMLElement).innerText?.trim() || /^(H[1-6]|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(element.tagName))
        .map((element) => ({ font: getComputedStyle(element).fontFamily, tag: element.tagName.toLowerCase(), text: (element as HTMLElement).innerText.trim().slice(0, 40) }))
        .filter(({ font }) => pattern.test(font))
    }, LEGACY_FONT.source)
    expect(leaks, "design-system text resolving to the legacy Archivo/Inter stacks").toEqual([])
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
  const results = await new AxeBuilder({ page })
    .include(".ll-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
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

  test.fixme("equipment capacity on a page: the count never exceeds the units and unknown is never 0", async () => {
    // No page renders EquipmentCapacity yet (the hauler profile and inquiry pages still use v2.css markup).
    // Component behaviour is covered by packages/ui/src/marketplace/profile.test.tsx.
  })

  test.fixme("conversation on a page: messages are escaped text and an empty send is blocked", async () => {
    // No page renders ConversationThread or MessageComposer yet (/v2/inquiries and /v2/landing/inquiries still
    // use v2.css markup). Component behaviour is covered by packages/ui/src/marketplace/conversation.test.tsx.
  })
})
