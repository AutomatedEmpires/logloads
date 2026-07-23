import { expect, test, type Page } from "@playwright/test"

/**
 * Operating-loop journey: a driver requests capacity, the host approves it,
 * the driver progresses the trip and messages the counterparty. Runs against
 * seeded state and tolerates re-runs (requests/trips from earlier runs).
 */

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.waitForLoadState("networkidle")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 })
}

test.describe.serial("operating loop", () => {
  test("driver requests capacity on a load that fits", async ({ page }) => {
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/loads")
    await page.waitForLoadState("networkidle")

    const cards = page.locator("a.load-card-v3")
    const cardCount = await cards.count()

    let requested = false

    for (let index = 0; index < Math.min(cardCount, 5) && !requested; index += 1) {
      await page.goto("/driver/loads")
      await page.waitForLoadState("networkidle")

      // Click can land in the hydration gap where the router is not attached
      // yet; retry until the URL actually changes to the load detail route.
      await expect(async () => {
        await page.locator("a.load-card-v3").nth(index).click()
        await page.waitForURL(/\/driver\/loads\/[^/?]+/, { timeout: 3_000 })
      }).toPass({ timeout: 20_000 })

      await page.waitForLoadState("networkidle")

      // A prior project run may already hold this load in any assignment state
      // (Requested, Assigned to you, At the landing, ...).
      const alreadyCommitted = await page
        .getByText(/The host is deciding|You're booked|At the landing|Loading|Hauled|On this load/)
        .first()
        .isVisible()
        .catch(() => false)

      if (alreadyCommitted) {
        requested = true
        break
      }

      const requestButton = page.getByRole("button", { name: "Request haul" })

      if (!(await requestButton.isVisible().catch(() => false))) {
        continue
      }

      // Button handlers are dead until hydration completes — retry the click
      // until the panel reacts (pending label, outcome copy, or error).
      await expect(async () => {
        await requestButton.click()
        await expect(page.locator(".request-panel").first()).not.toContainText("Request haul", { timeout: 2_500 })
      }).toPass({ timeout: 30_000 })

      // Success renders either the optimistic "Requested — ..." confirmation or,
      // after revalidation, the persisted "Waiting for host approval" state. A
      // compatibility rejection renders an alert instead — move to the next card.
      const confirmed = await Promise.race([
        page.getByText("The host is deciding.").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true),
        page.getByText("Request sent").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true),
        page.locator(".action-error").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => false)
      ]).catch(() => false)

      if (confirmed) {
        await expect(page.getByRole("heading", { name: "Route Pack unlocks after assignment." })).toBeVisible()
        requested = true
      }
    }

    if (!requested) {
      // The mobile project may already have requested, received, and advanced
      // the only compatible seeded haul. Committed work correctly disappears
      // from Available Loads and moves to Schedule, so verify it there.
      await page.goto("/driver/schedule")
      await page.waitForLoadState("networkidle")
      requested = await page.locator(".schedule-request-card, .trip-card").first().isVisible().catch(() => false)
    }

    expect(requested, "driver should be able to request a visible load or see committed work on Schedule").toBe(true)
  })

  test("host sees the capacity request and approves it", async ({ page }) => {
    await signIn(page, "cole@summit.example")
    await page.goto("/host/command")
    await page.waitForLoadState("networkidle")

    const approvalRow = page.locator(".host-approval-row").first()
    const hasApprove = await approvalRow.getByRole("button", { name: "Review approval" }).isVisible().catch(() => false)

    if (hasApprove) {
      const assignmentId = await approvalRow.getAttribute("data-assignment-id")
      expect(assignmentId, "a capacity request should expose a stable assignment identity").toBeTruthy()

      // Labels can legitimately repeat when the same truck requests multiple
      // slots on one campaign. Track the exact assignment so removing it does
      // not cause this locator to rebind to the next visually identical row.
      const trackedRequest = page.locator(`.host-approval-row[data-assignment-id="${assignmentId}"]`)

      // The first click can land in the hydration gap. Retry the same visible
      // request until its committed approval removes that request from the queue.
      await expect(async () => {
        if (!(await trackedRequest.isVisible().catch(() => false))) {
          return
        }

        const approve = trackedRequest.getByRole("button", { name: "Review approval", exact: true })

        if (await approve.isEnabled().catch(() => false)) {
          await approve.click()
          await trackedRequest.getByRole("button", { name: "Confirm approval" }).click()
        }

        await expect(trackedRequest).toBeHidden({ timeout: 5_000 })
      }).toPass({ timeout: 30_000 })

      await expect(trackedRequest).toBeHidden()
    } else {
      // A prior run may already have drained the queue; the journey continues
      // as long as committed work exists for the driver to progress.
      await expect(page.getByRole("heading", { name: "Command" })).toBeVisible()
    }
  })

  test("driver progresses the active trip one step", async ({ page }) => {
    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/schedule")
    await page.waitForLoadState("networkidle")

    const advance = page.locator("button.advance-button").first()

    await expect(advance, "an active trip with a next action should exist after approval").toBeVisible({ timeout: 15_000 })

    const labelBefore = (await advance.textContent())?.trim() ?? ""

    await advance.click()
    await expect
      .poll(
        async () => {
          const current = await page.locator("button.advance-button").first().textContent().catch(() => null)

          return (current ?? "").trim()
        },
        { timeout: 15_000 }
      )
      .not.toBe(labelBefore)
  })

  test("driver sends a message tied to the work", async ({ page }) => {
    const uniqueMessage = `Journey check-in ${Date.now()}`

    await signIn(page, "hank@northpine.example")
    await page.goto("/driver/messages")
    await page.waitForLoadState("networkidle")

    const existingThread = page.locator(".thread-item").first()

    if (await existingThread.isVisible().catch(() => false)) {
      const href = await existingThread.getAttribute("href")

      expect(href, "an existing conversation should expose a navigable thread URL").toBeTruthy()
      await page.goto(href!)
      await page.waitForLoadState("networkidle")
      await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible({ timeout: 15_000 })
    } else {
      await page.getByRole("button", { name: "New message" }).click()
      await page.locator(".messages-new__people button").first().click()
      await page.locator(".messages-new__form textarea").fill(uniqueMessage)
      await page.locator('.messages-new__form button[type="submit"]').click()
      await page.waitForURL(/thread=/, { timeout: 15_000 })
      await expect(page.getByText(uniqueMessage).first()).toBeVisible({ timeout: 15_000 })

      return
    }

    await page.locator('textarea[aria-label="Message"]').fill(uniqueMessage)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText(uniqueMessage).first()).toBeVisible({ timeout: 15_000 })
  })
})
