import { expect, type Locator, type Page } from "@playwright/test"

/**
 * The guided builder's fields are React-controlled. A fill or select that
 * lands in the gap between the server render and hydration sets the DOM value,
 * then the first client render replaces it from state and the value is gone —
 * leaving the step's Next button disabled for the rest of the test.
 *
 * These retry until the value survives a client render, so a slow or
 * contended runner reports a real failure rather than a hydration race.
 *
 * The scope may be a Page or any Locator. A page that repeats a field — an
 * "add" form beside one "edit" form per record — has the same label several
 * times over, so the caller narrows to the form it means rather than matching
 * whichever copy happens to be first.
 */
type FieldScope = Pick<Page, "getByLabel"> | Locator

export async function fillWhenReady(scope: FieldScope, label: string, value: string): Promise<void> {
  const field = scope.getByLabel(label)

  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

export async function selectWhenReady(
  scope: FieldScope,
  label: string,
  option: string | { index: number }
): Promise<void> {
  const field = scope.getByLabel(label)

  await expect(async () => {
    const [selected] = await field.selectOption(option)

    expect(selected).toBeTruthy()
    await expect(field).toHaveValue(selected as string, { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}
