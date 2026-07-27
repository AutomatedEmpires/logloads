import { expect, test } from "@playwright/test"

test("local founder launcher opens Cole in Host without exposing an invalid persona", async ({ page }, testInfo) => {
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")

  await expect(page.getByRole("heading", { name: "Choose a working view." })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue as Hank Hauler, Driver" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue as Dana Dispatch, Fleet" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue as Cole Cedar, Host" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue as LogLoads Admin, Admin" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue as Morgan Newfleet, Empty fleet" })).toBeVisible()
  await expect(page.getByText("Lee Loader")).toHaveCount(0)
  await expect(page.locator('input[name="email"]')).toHaveCount(1)
  await expect(page.locator('input[name="email"]')).toBeVisible()

  await page.locator('input[name="email"]').fill("loader@northpine.example")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.locator(".form-error[role='alert']")).toHaveText(
    "Use one of the available founder demo accounts."
  )

  await page.screenshot({ fullPage: true, path: testInfo.outputPath("founder-demo-launcher.png") })
  await page.getByRole("button", { name: "Continue as Cole Cedar, Host" }).click()

  await expect(page).toHaveURL(/\/host\/command$/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Command" })).toBeVisible()
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("founder-demo-cole-host.png") })
})
