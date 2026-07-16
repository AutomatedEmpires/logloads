import { expect, type Page } from "@playwright/test"

/**
 * The guided builder's fields are React-controlled. A fill or select that
 * lands in the gap between the server render and hydration sets the DOM value,
 * then the first client render replaces it from state and the value is gone —
 * leaving the step's Next button disabled for the rest of the test.
 *
 * These retry until the value survives a client render, so a slow or
 * contended runner reports a real failure rather than a hydration race.
 */

export async function fillWhenReady(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label)

  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

export async function selectWhenReady(
  page: Page,
  label: string,
  option: string | { index: number }
): Promise<void> {
  const field = page.getByLabel(label)

  await expect(async () => {
    const [selected] = await field.selectOption(option)

    expect(selected).toBeTruthy()
    await expect(field).toHaveValue(selected as string, { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}
