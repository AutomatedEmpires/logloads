import { expect, test } from "@playwright/test"

test("visitor understands the public product and can inspect public loads", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "TIMBER MOVES HERE." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Find loads" }).first()).toBeVisible()
  await expect(page.getByText("Timber needs trucks. Trucks need work.").first()).toBeVisible()

  await page.getByRole("link", { name: "Find loads" }).first().click()
  await expect(page).toHaveURL(/\/loads$/)
  await expect(page.getByRole("region", { name: "Load discovery" })).toBeVisible()
  await expect(page.getByText("Exact access unlocks after assignment.").first()).toBeVisible()
})

test("role cockpits render distinct operating surfaces", async ({ page }) => {
  await page.goto("/driver/today")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await expect(page.getByText(/Open Route Pack|Find loads/).first()).toBeVisible()

  await page.goto("/fleet/command")
  await expect(page.getByRole("heading", { name: "Command" })).toBeVisible()
  await expect(page.getByText("Available trucks")).toBeVisible()
  await expect(page.getByText("Unassigned work")).toBeVisible()

  await page.goto("/host/live-board")
  await expect(page.getByRole("heading", { name: "Live Board" })).toBeVisible()
  await expect(page.getByText("Expected")).toBeVisible()
  await expect(page.getByText("Loading")).toBeVisible()

  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible()
  await expect(page.getByText("Platform intervention")).toBeVisible()
})
