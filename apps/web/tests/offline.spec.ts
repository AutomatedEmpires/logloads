import { expect, test } from "@playwright/test"

/**
 * The shell stays on the phone (#288). Find Work and job pages are covered by the
 * worker tests: this server runs with Marketplace V2 off, so those routes 404.
 * The public home is the shell every cab loads first.
 */
test("the cached shell opens when the signal drops", async ({ page, context }) => {
  await page.goto("/")
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Move more loads. Make fewer calls." })).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Move more loads. Make fewer calls." })).toBeVisible()
})
