import { expect, test, type Page, type TestInfo } from "@playwright/test"

const ROLE_TOURS = [
  {
    captureCount: 12,
    commercialTruth: /5% on top of stated driver pay only after an authoritative physical completion/,
    heading: "Run the landing from one shared operating picture.",
    role: "host"
  },
  {
    captureCount: 14,
    commercialTruth: /Fleet workspace access is free forever/,
    heading: "Coordinate every truck without taxing driver pay.",
    role: "fleet"
  },
  {
    captureCount: 9,
    commercialTruth: /Driver access is free forever/,
    heading: "Know the work before you turn the key.",
    role: "driver"
  }
] as const

interface TourNetworkAudit {
  externalRequests: string[]
  operatingApiReads: string[]
  unsafeRequests: string[]
}

function recordTourNetworkAudit(page: Page): TourNetworkAudit {
  const audit: TourNetworkAudit = {
    externalRequests: [],
    operatingApiReads: [],
    unsafeRequests: []
  }

  page.context().on("request", (request) => {
    const url = new URL(request.url())
    const method = request.method()

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      audit.unsafeRequests.push(`${method} ${url.href}`)
    }

    if (url.origin !== "http://127.0.0.1:3002") {
      audit.externalRequests.push(url.href)
    }

    if (
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/auth/session"
    ) {
      audit.operatingApiReads.push(`${method} ${url.pathname}`)
    }
  })

  return audit
}

async function expectNoHorizontalOverflow(page: Page) {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))

  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

async function expectControlFloor(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox()

  if (!box) throw new Error("Pilot control geometry is missing")
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
}

async function captureViewport(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`)
  })
}

test("anonymous Pilot Center explains the real product without creating a demo identity", async ({ page }, testInfo) => {
  const networkAudit = recordTourNetworkAudit(page)

  await page.goto("/pilot")
  await expect(page.getByRole("heading", { name: "See the operating day before you commit." })).toBeVisible()
  await expect(page.getByText(/This public tour is read-only/)).toBeVisible()
  await expect(page.getByText(/disposable synthetic workspace/i).first()).toBeVisible()
  await expect(page.getByRole("heading", { name: "The same movement, seen from your job." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Tour Host" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Tour Fleet" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Tour Driver" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Tour first. Rehearse second. Go live only when ready." })).toBeVisible()
  await expect(page.getByText("Separate approval required", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "What must be true before real work." })).toBeVisible()

  const cockpitHrefs = await page.locator(".pilot-page a[href]").evaluateAll((links) =>
    links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .filter((href) => /^\/(?:host|fleet|driver)(?:\/|$)/.test(href))
  )

  expect(cockpitHrefs).toEqual([])
  expect(networkAudit).toEqual({
    externalRequests: [],
    operatingApiReads: [],
    unsafeRequests: []
  })
  await expectNoHorizontalOverflow(page)
  await captureViewport(page, testInfo, "pilot-center")
})

test("every role tour exposes its complete current-product surface atlas", async ({ page }, testInfo) => {
  test.slow()
  const networkAudit = recordTourNetworkAudit(page)

  for (const tour of ROLE_TOURS) {
    await page.goto(`/pilot/${tour.role}`)
    await expect(page.getByRole("heading", { name: tour.heading })).toBeVisible()
    await expect(page.getByText(tour.commercialTruth).first()).toBeVisible()
    await expect(page.getByText(/This public tour is read-only/)).toBeVisible()

    const roleNavigation = page.getByRole("navigation", { name: "Choose a role tour" })
    await expect(roleNavigation.getByRole("link")).toHaveCount(3)
    await expect(roleNavigation.getByRole("link", {
      name: tour.role.charAt(0).toUpperCase() + tour.role.slice(1)
    })).toHaveAttribute("aria-current", "page")

    const captures = page.locator(".pilot-atlas__capture img")
    await expect(captures).toHaveCount(tour.captureCount)

    const surfaceIndex = page.getByRole("navigation", {
      name: `${tour.role.charAt(0).toUpperCase() + tour.role.slice(1)} surface index`
    })
    const firstSurfaceLink = surfaceIndex.getByRole("link").first()
    const firstFullSizeLink = page.locator(".pilot-atlas__capture").first()

    await expectControlFloor(firstSurfaceLink)
    await expectControlFloor(firstFullSizeLink)

    if (tour.role === "host") {
      await firstSurfaceLink.focus()
      await firstSurfaceLink.press("Enter")
      await expect(page).toHaveURL(/#surface-host-command$/)

      const fragmentTarget = page.locator("#surface-host-command")
      await expect(fragmentTarget).toBeFocused()
      await expect(fragmentTarget).toBeInViewport()
      const targetBox = await fragmentTarget.boundingBox()

      if (!targetBox) throw new Error("Pilot surface fragment geometry is missing")
      expect(targetBox.y).toBeGreaterThanOrEqual(120)

      const viewerPromise = page.context().waitForEvent("page")
      await firstFullSizeLink.click()
      const viewer = await viewerPromise

      await viewer.waitForLoadState("domcontentloaded")
      await expect(viewer).toHaveURL(/\/pilot\/capture\/host-command$/)
      await expect(viewer.getByRole("heading", { name: "Host · Command" })).toBeVisible()
      await expect(viewer.getByText(/Synthetic product capture · Not a live workspace/)).toBeVisible()
      await expect(viewer.getByText(/This public tour is read-only/)).toBeVisible()
      await expectNoHorizontalOverflow(viewer)
      await viewer.close()
    }

    for (let index = 0; index < tour.captureCount; index += 1) {
      const image = captures.nth(index)
      await image.scrollIntoViewIfNeeded()
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((node) => ({
        complete: (node as HTMLImageElement).complete,
        naturalWidth: (node as HTMLImageElement).naturalWidth
      }))).toMatchObject({ complete: true, naturalWidth: expect.any(Number) })
      expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }

    const cockpitHrefs = await page.locator(".pilot-page a[href]").evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
        .filter((href) => /^\/(?:host|fleet|driver)(?:\/|$)/.test(href))
    )

    expect(cockpitHrefs).toEqual([])
    await expectControlFloor(roleNavigation.getByRole("link").first())
    await expectNoHorizontalOverflow(page)
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto"
      window.scrollTo(0, 0)
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await captureViewport(page, testInfo, `pilot-${tour.role}`)
  }

  expect(networkAudit).toEqual({
    externalRequests: [],
    operatingApiReads: [],
    unsafeRequests: []
  })
})

test("pilot CTAs preserve role intent without submitting operating state", async ({ page }) => {
  const networkAudit = recordTourNetworkAudit(page)

  await page.goto("/pilot/fleet")
  await page.getByRole("link", { name: "Plan a fleet rehearsal" }).first().click()
  await expect(page).toHaveURL(/\/contact\?topic=pilot&role=fleet$/)
  await expect(page.getByLabel("What are you exploring?")).toHaveValue("pilot_fleet")
  await expect(page.getByRole("heading", { name: "Talk with LogLoads." })).toBeVisible()

  expect(networkAudit).toEqual({
    externalRequests: [],
    operatingApiReads: [],
    unsafeRequests: []
  })
  await expectNoHorizontalOverflow(page)
})
