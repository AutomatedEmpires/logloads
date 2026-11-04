import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

/**
 * #140: the product's core loop on PERSISTENT normalized storage, through the running app's own pages:
 *
 *   1. a verified landing (North Pine Logging's landing desk) publishes a real job in the job editor;
 *   2. the job appears in public discovery, signed out;
 *   3. a free hauler (New River Hauling: no plan, no trucks listed) expresses interest;
 *   4. the landing replies from its inbox;
 *   5. the hauler reads the reply in My inquiries.
 *
 * Config: v2-normalized-loop.config.mjs (`next start`, `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`). CI:
 * `.github/workflows/normalized-e2e-loop.yml`, on a disposable Supabase local stack deployed and seeded with
 * `tools/normalized-store.mjs` (architecture/normalized-v2/seed/pilot_demo_seed.sql). Step 1 is tagged `@publish` and
 * steps 2–5 `@loop`: CI runs them as two invocations, each with its own server, and checks the rows with psql in
 * between and after, so the loop is proven against the database, not a process's memory.
 *
 * Every person is a seeded account signed in with the app's seeded sign-in. Their sessions map to the normalized
 * store through the seed's pilot-compatible ids: the session's profile id and Clerk user id are the ones the seed
 * links under the configured issuer (`adapter.ts`, `sessionPrincipalResolver`).
 *
 * Each project (desktop, mobile) runs the whole loop at its own width on its own job, titled with the project name.
 * The negative checks run once, on desktop, after its loop: private details stay private to visitors and other
 * businesses, a closed job refuses new interest, a stranger cannot respond to another business's inquiry, and Find
 * work stays a complete text list when the map cannot load. The forged requests replay a real form's fields, server
 * action id included, from another account's session, so the server's own checks are what refuse them.
 *
 * Every step is idempotent: a retry continues from what the store already holds instead of writing twice.
 *
 * What this does NOT prove: a hosted Supabase project, real Clerk tokens (#112), signed-in pages for a business
 * created in the normalized store rather than seeded with pilot ids (#213), or production readiness.
 */

const NORTH_PINE = { email: "dispatch@northpine.example", landing: "Oak Landing", name: "North Pine Logging" }
const NEW_RIVER = { email: "emptyfleet@logloads.example", name: "New River Hauling" }
const GRANITE_CREEK = { email: "avery@granitecreek.example", name: "Granite Creek Hauling" }
const SUMMIT = { email: "cole@summit.example", name: "Summit Ridge Timber" }
/** Seeded open jobs. The pilot seed publishes no Summit Ridge Timber job, so listing it shows the normalized store answered. */
const SEEDED_OPEN = { northPine: "Oak chip shuttle", summit: "Blue River high-grade campaign" }
/** The seed's closed North Pine Logging job, "Oak recovery load" (pilot_demo_seed.sql §5). */
const SEEDED_CLOSED_JOB_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5"

/** Each project's job. CI's psql checks match `Spruce saw logs, loop check (%)`. */
const jobTitle = (testInfo: TestInfo) => `Spruce saw logs, loop check (${testInfo.project.name})`
const haulerNote = (testInfo: TestInfo) => `Loop check (${testInfo.project.name}): one truck from Oakridge, mornings.`
const landingReply = (testInfo: TestInfo) => `Loop check (${testInfo.project.name}): can you start Monday at 6?`
/** What the stranger tries to post on North Pine Logging's inquiry. CI's psql check counts it: it must be 0. */
const FORGED_REPLY = "Forged by another business: this must never be posted"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The landings' private details (exact point, directions, gate instructions, site phone), read from the store by the
 * CI job (`NORMALIZED_LOOP_PRIVATE_DETAILS`, a JSON array). No page outside the landing's own business may carry one.
 */
function privateDetails(): string[] {
  const parsed: unknown = JSON.parse(process.env.NORMALIZED_LOOP_PRIVATE_DETAILS ?? "[]")
  const values = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length >= 6) : []

  // Two seeded landings, five details each.
  expect(values.length, "the private details of both seeded landings").toBeGreaterThanOrEqual(10)
  return values
}

/** The page's whole HTML, including the serialized server-component payload, carries no private detail. */
async function expectNoPrivateDetails(page: Page, where: string) {
  const html = await page.content()
  const leaked = privateDetails().filter((secret) => html.includes(secret))

  expect(leaked.length, `${where}: private landing details in the page`).toBe(0)
}

/** Opens a V2 page and waits for the shell (the same check as DS-05's `openV2`). */
async function openV2(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator(".ll-app #main")).toBeVisible()
}

/** The app's seeded sign-in (the same steps as DS-05's `signIn`), from a signed-out browser. */
async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/sign-in")
  await page.waitForLoadState("domcontentloaded")
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"))
}

const jobRows = (page: Page) => page.locator("[data-ds-page] ul[aria-label='Jobs'] > li")
const inquiryRows = (page: Page) => page.locator("#main [data-ds-page] ul[aria-label$='inquiries'] > li")
const interestForm = (page: Page) => page.locator("form:has(input[name='loadPostingId'])")
const replyComposer = (page: Page) => page.locator("form:has(textarea[aria-label^='Reply to'])")
const conversation = (page: Page) => page.locator("#conversation")

/** The job's page, from its row in public discovery (signed out or in). */
async function discoveredJobPath(page: Page, title: string): Promise<string> {
  await openV2(page, "/v2/work")
  const row = jobRows(page).filter({ hasText: title })
  await expect(row, `"${title}" is listed in Find work`).toHaveCount(1)
  const href = await row.locator("h3 a").getAttribute("href")

  expect(href).toMatch(/^\/v2\/work\/[^/?#]+$/)
  return href!
}

/** Opens one of the inquiry queue tabs (landing: "Inquiries by queue"; hauler: "Inquiries by status"). */
async function openQueue(page: Page, navigation: string, label: string) {
  const tabs = page.getByRole("navigation", { name: navigation })

  await tabs.getByRole("link", { name: new RegExp(`^${label}`) }).click()
  await expect(tabs.locator("a[aria-current='page']")).toHaveText(new RegExp(`^${label}`))
}

/** A landing's row for this job and New River Hauling, on whichever queue holds it (New, or Replied on a retry). */
async function landingRow(page: Page, title: string, testInfo: TestInfo): Promise<Locator> {
  await openV2(page, "/v2/landing/inquiries")
  const row = inquiryRows(page).filter({ hasText: title }).filter({ hasText: NEW_RIVER.name })

  if ((await row.count()) === 0 && testInfo.retry > 0) {
    await openQueue(page, "Inquiries by queue", "Replied")
  }

  await expect(row, `${NORTH_PINE.name}'s inbox lists New River Hauling's interest in "${title}"`).toHaveCount(1)
  return row
}

type FormFields = Array<[string, string]>

/** A real form's fields as the browser would submit them, including React's server-action id field. */
async function formFields(form: Locator): Promise<FormFields> {
  const fields = await form.evaluate((element) =>
    Array.from((element as HTMLFormElement).elements).flatMap((control): Array<[string, string]> => {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return []
      if (!control.name || control.disabled) return []
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio") && !control.checked) return []
      return [[control.name, control.value]]
    })
  )

  // Without the action id the POST would not reach the server action, and a refusal would prove nothing.
  expect(fields.some(([name]) => name.startsWith("$ACTION_")), "the captured form posts to a server action").toBe(true)
  return fields
}

/** Posts the fields natively (no script, as a browser without JavaScript does) to `path`, from `page`'s session. */
async function postNatively(page: Page, path: string, fields: FormFields) {
  await page.evaluate(({ path, fields }) => {
    const form = document.createElement("form")
    form.method = "post"
    form.enctype = "multipart/form-data"
    form.action = path
    for (const [name, value] of fields) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = name
      input.value = value
      form.append(input)
    }
    document.body.append(form)
    HTMLFormElement.prototype.submit.call(form)
  }, { fields, path })
  await page.waitForURL((url) => url.searchParams.has("error"))
}

const withField = (fields: FormFields, name: string, value: string): FormFields =>
  fields.map(([field, current]) => [field, field === name ? value : current])

// ---------------------------------------------------------------------------------------------------------------------
// 1. Publish (the first invocation; the server is restarted after it)
// ---------------------------------------------------------------------------------------------------------------------

test("1. a verified landing publishes a real job through the job editor", { tag: "@publish" }, async ({ page }, testInfo) => {
  const title = jobTitle(testInfo)

  // A fresh store has no such job. Only a retry may find it already published, and then it is not published twice.
  await openV2(page, "/v2/work")
  if ((await jobRows(page).filter({ hasText: title }).count()) > 0) {
    expect(testInfo.retry, `"${title}" exists before the first attempt published it`).toBeGreaterThan(0)
    return
  }

  await signIn(page, NORTH_PINE.email)
  await openV2(page, "/v2/landing/jobs")
  await page.getByRole("link", { name: "Post a job" }).first().click()
  await page.waitForURL((url) => url.pathname === "/v2/landing/jobs/new")
  await expect(page.locator("[data-ds-page='job-editor']")).toBeVisible()

  // Step 1: Basics & location, from one of the business's own active landings.
  const landing = page.getByLabel("Landing", { exact: true })
  const landingId = await landing.locator("option", { hasText: NORTH_PINE.landing }).getAttribute("value")
  expect(landingId, `${NORTH_PINE.landing} is one of the business's landings`).toMatch(UUID)
  await landing.selectOption(landingId!)
  await page.getByLabel("Title", { exact: true }).fill(title)
  await page.getByLabel("Product", { exact: true }).selectOption("Saw logs")
  await page.getByLabel("Destination (optional)", { exact: true }).fill("Valley Mill · Sweet Home, OR")
  await page.getByLabel("One-way miles (optional)", { exact: true }).fill("42")
  await page.getByRole("button", { name: "Next: pay & scope" }).click()
  await page.waitForURL((url) => url.searchParams.get("step") === "pay")

  // Step 2: Pay & scope.
  const startsOn = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel("Pay basis", { exact: true }).selectOption("per_load")
  await page.getByLabel("Amount ($)", { exact: true }).fill("480")
  await page.getByLabel("Work starts", { exact: true }).fill(startsOn)
  await page.getByLabel("Duration (days)", { exact: true }).fill("10")
  await page.getByLabel("Trucks needed for the job", { exact: true }).fill("2")
  await page.getByRole("button", { name: "Next: equipment & volume" }).click()
  await page.waitForURL((url) => url.searchParams.get("step") === "equipment")

  // Step 3: Equipment & volume.
  await page.getByRole("checkbox", { exact: true, name: "Log truck" }).check()
  await page.getByRole("button", { name: "Next: review & publish" }).click()
  await page.waitForURL((url) => url.pathname === "/v2/landing/jobs/preview")

  // Step 4: Review & publish. The private details are named as never shown; the three statements are ticked by hand.
  await expect(page.getByText("How haulers see it in search")).toBeVisible()
  await expect(page.getByText(`The exact location of ${NORTH_PINE.landing}`)).toBeVisible()
  await expect(page.locator("#publish-unavailable"), "the normalized store publishes").toHaveCount(0)
  const statements = page.getByRole("group", { name: "Before you publish" }).getByRole("checkbox")
  await expect(statements).toHaveCount(3)
  for (const statement of await statements.all()) await statement.check()
  const publish = page.getByRole("button", { name: "Publish job" })
  await expect(publish).not.toHaveAttribute("aria-disabled", "true")
  await publish.click()

  await page.waitForURL((url) => /^\/v2\/work\/[^/]+$/.test(url.pathname) && url.searchParams.get("published") === "1")
  expect(decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!)).toMatch(UUID)
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
  await expect(page.locator("[data-ds-page='job-detail']")).toContainText("This is your organization’s job.")
})

// ---------------------------------------------------------------------------------------------------------------------
// 2–5. Discover, interest, respond, reply (the second invocation, on a restarted server)
// ---------------------------------------------------------------------------------------------------------------------

test("2–5. the published job is discovered signed out, a free hauler sends interest, the landing replies, the hauler reads it", { tag: "@loop" }, async ({ page }, testInfo) => {
  const title = jobTitle(testInfo)
  const note = haulerNote(testInfo)
  const reply = landingReply(testInfo)
  let jobPath = ""
  let inquiryId = ""

  await test.step("2. public discovery, signed out, after the restart", async () => {
    await page.context().clearCookies()
    jobPath = await discoveredJobPath(page, title)
    const row = jobRows(page).filter({ hasText: title })
    await expect(row).toContainText(NORTH_PINE.name)
    // The normalized store answered this page: the pilot store has no open Summit Ridge Timber job.
    await expect(jobRows(page).filter({ hasText: SEEDED_OPEN.summit })).toHaveCount(1)
    await expectNoPrivateDetails(page, "Find work, signed out")

    await openV2(page, jobPath)
    const job = page.locator("[data-ds-page='job-detail']")
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
    await expect(job).toContainText("Business identity verified")
    await expect(job).toContainText("Oakridge, OR")
    await expect(job).toContainText("Valley Mill · Sweet Home, OR")
    await expect(page.getByRole("link", { name: "Sign in to express interest" }).first()).toBeVisible()
    await expect(interestForm(page)).toHaveCount(0)
    await expectNoPrivateDetails(page, "the job page, signed out")
  })

  await test.step("3. New River Hauling, a free hauler with no trucks listed, expresses interest", async () => {
    await signIn(page, NEW_RIVER.email)
    await openV2(page, jobPath)
    const form = interestForm(page)

    if ((await form.count()) > 0) {
      await expect(form.getByRole("spinbutton", { name: "Trucks you can offer" })).toHaveValue("1")
      await form.getByLabel("Message").fill(note)
      await form.getByRole("button", { name: "Send interest" }).click()
      await page.waitForURL((url) => url.searchParams.get("sent") === "1")
      await expect(page.getByRole("status").filter({ hasText: "Your interest was sent." })).toBeVisible()
    } else {
      expect(testInfo.retry, "the interest form is offered before any interest was sent").toBeGreaterThan(0)
    }

    await expect(page.locator("[data-ds-page='job-detail']")).toContainText("You offered this landing 1 truck.")
    const open = page.getByRole("link", { name: "Open my inquiries" })
    inquiryId = new URL((await open.getAttribute("href")) ?? "", page.url()).searchParams.get("inquiry") ?? ""
    expect(inquiryId, "the inquiry's id").toMatch(UUID)
    await expectNoPrivateDetails(page, "the job page, as New River Hauling")
  })

  await test.step("4. North Pine Logging's landing desk replies from its inbox", async () => {
    await signIn(page, NORTH_PINE.email)
    const row = await landingRow(page, title, testInfo)
    await row.getByRole("link").click()
    await page.waitForURL((url) => url.searchParams.get("inquiry") === inquiryId)
    await expect(page.getByRole("log")).toContainText(note)

    if (!((await page.getByRole("log").innerText()).includes(reply))) {
      const composer = replyComposer(page)
      await composer.locator("textarea").fill(reply)
      await composer.getByRole("button", { exact: true, name: "Send" }).click()
      await page.waitForURL((url) => url.searchParams.get("updated") === "replied" && url.searchParams.get("inquiry") === inquiryId)
    }

    await expect(page.getByRole("log")).toContainText(reply)
    await expect(inquiryRows(page).filter({ hasText: title }).first()).toContainText("Waiting for the hauler")
  })

  await test.step("5. New River Hauling reads the reply in My inquiries", async () => {
    await signIn(page, NEW_RIVER.email)
    await openV2(page, "/v2/inquiries")
    await openQueue(page, "Inquiries by status", "Replied")
    const row = inquiryRows(page).filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(NORTH_PINE.name)
    await expect(row).toContainText("Your turn")
    await row.getByRole("link").click()
    await page.waitForURL((url) => url.searchParams.get("inquiry") === inquiryId)

    const thread = page.getByRole("log")
    await expect(thread).toContainText(note)
    await expect(thread).toContainText(reply)
    await expect(replyComposer(page), "the hauler can answer").toHaveCount(1)
    await expectNoPrivateDetails(page, "the hauler's conversation")
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Negative checks (desktop, after its loop)
// ---------------------------------------------------------------------------------------------------------------------

/** The negative checks do not depend on the width: they run once, on desktop, after its loop (file order, one worker). */
function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop", "Width-independent: runs once, on desktop, after its loop")
}

test.describe("negative checks", () => {
  test("private details stay private to visitors and to other businesses", { tag: "@loop" }, async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    const title = jobTitle(testInfo)

    // Signed out: Find work, its map view and every open job's page.
    await page.context().clearCookies()
    const paths = [
      await discoveredJobPath(page, title),
      await discoveredJobPath(page, SEEDED_OPEN.northPine),
      await discoveredJobPath(page, SEEDED_OPEN.summit)
    ]
    for (const path of ["/v2/work", "/v2/work?view=map", "/v2/work?all=1", ...paths]) {
      await openV2(page, path)
      await expectNoPrivateDetails(page, `${path}, signed out`)
    }

    // Another hauler and another landing business see the same public job, and nothing more.
    for (const account of [GRANITE_CREEK, SUMMIT]) {
      await signIn(page, account.email)
      for (const path of ["/v2/work", paths[0]!]) {
        await openV2(page, path)
        await expectNoPrivateDetails(page, `${path}, as ${account.name}`)
      }
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
    }

    // Summit Ridge Timber's inbox does not hold North Pine Logging's inquiries.
    await openV2(page, "/v2/landing/inquiries")
    await expect(inquiryRows(page).filter({ hasText: title })).toHaveCount(0)
    await expect(conversation(page).filter({ hasText: NEW_RIVER.name })).toHaveCount(0)
  })

  test("a closed job refuses new interest, even from a forged request", { tag: "@loop" }, async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, NEW_RIVER.email)

    // The closed job is not public, so its page offers nothing.
    const response = await page.goto(`/v2/work/${SEEDED_CLOSED_JOB_ID}`)
    expect(response?.status(), "a closed job's page, for a hauler that never sent interest").toBe(404)
    await expect(interestForm(page)).toHaveCount(0)

    // The real interest form of an open job, replayed with the closed job's id.
    const openPath = await discoveredJobPath(page, SEEDED_OPEN.northPine)
    await openV2(page, openPath)
    await expect(interestForm(page), "New River Hauling can express interest in the open job").toHaveCount(1)
    const fields = withField(await formFields(interestForm(page)), "loadPostingId", SEEDED_CLOSED_JOB_ID)

    await postNatively(page, openPath, fields)
    const refused = new URL(page.url())
    expect(refused.pathname).toBe(`/v2/work/${SEEDED_CLOSED_JOB_ID}`)
    expect(refused.searchParams.get("error")).toMatch(/no longer accepting interest/)

    // Nothing was sent: My inquiries has no inquiry for it (CI's psql check counts the rows too).
    await openV2(page, "/v2/inquiries")
    for (const label of ["Active", "Replied", "Closed"]) {
      await openQueue(page, "Inquiries by status", label)
      await expect(inquiryRows(page).filter({ hasText: "Oak recovery load" })).toHaveCount(0)
    }
  })

  test("a stranger cannot respond to another business's inquiry, even from a forged request", { tag: "@loop" }, async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    const title = jobTitle(testInfo)

    // North Pine Logging's own reply form on New River Hauling's inquiry: its fields, with the stranger's words.
    await signIn(page, NORTH_PINE.email)
    await openV2(page, "/v2/landing/inquiries")
    await openQueue(page, "Inquiries by queue", "Replied")
    const row = inquiryRows(page).filter({ hasText: title }).filter({ hasText: NEW_RIVER.name })
    await expect(row).toHaveCount(1)
    await row.getByRole("link").click()
    await page.waitForURL((url) => url.searchParams.has("inquiry"))
    const inquiryId = new URL(page.url()).searchParams.get("inquiry")!
    const fields = withField(await formFields(replyComposer(page)), "body", FORGED_REPLY)
    expect(fields.find(([name]) => name === "interestId")?.[1]).toBe(inquiryId)

    // Summit Ridge Timber's owner can respond to inquiries, but only to Summit's: the inquiry is not theirs to open.
    await signIn(page, SUMMIT.email)
    await openV2(page, `/v2/landing/inquiries?inquiry=${inquiryId}`)
    await expect(conversation(page).filter({ hasText: NEW_RIVER.name })).toHaveCount(0)
    await expect(replyComposer(page)).toHaveCount(0)

    await postNatively(page, "/v2/landing/inquiries", fields)
    expect(new URL(page.url()).searchParams.get("error")).toMatch(/Inquiry not found/)
    await expect(page.getByRole("alert").filter({ hasText: "Inquiry not found" })).toBeVisible()

    // The conversation is unchanged for both of its parties.
    await signIn(page, NORTH_PINE.email)
    await openV2(page, `/v2/landing/inquiries?inquiry=${inquiryId}`)
    await expect(page.getByRole("log")).toContainText(landingReply(testInfo))
    await expect(page.getByRole("log")).not.toContainText(FORGED_REPLY)
    await signIn(page, NEW_RIVER.email)
    await openV2(page, `/v2/inquiries?inquiry=${inquiryId}`)
    await expect(page.getByRole("log")).not.toContainText(FORGED_REPLY)
  })

  test("Find work stays a complete text list when the map cannot load", { tag: "@loop" }, async ({ baseURL, browser, page }, testInfo) => {
    desktopOnly(testInfo)
    const title = jobTitle(testInfo)

    // The basemap is down: the map says so in text, and every job, the published one included, stays listed.
    await page.context().clearCookies()
    await openV2(page, "/v2/work")
    const rows = await jobRows(page).count()
    await page.route(/^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//, (route) => route.fulfill({ body: "", status: 503 }))
    await openV2(page, "/v2/work?view=map")
    await expect(page.getByRole("status").filter({ hasText: "The map could not load right now. Every job is listed below." })).toBeVisible()
    await expect(page.getByRole("region", { exact: true, name: "Approximate job locations" })).toHaveCount(0)
    await expect(jobRows(page)).toHaveCount(rows)
    await expect(jobRows(page).filter({ hasText: title })).toHaveCount(1)

    // Without JavaScript there is no map at all: the list and the job page are plain text.
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
    try {
      const plain = await context.newPage()
      await openV2(plain, "/v2/work?view=map")
      await expect(jobRows(plain)).toHaveCount(rows)
      const href = await jobRows(plain).filter({ hasText: title }).locator("h3 a").getAttribute("href")
      await openV2(plain, href!)
      await expect(plain.getByRole("heading", { name: title }).first()).toBeVisible()
      await expect(plain.locator("[data-ds-page='job-detail']")).toContainText("Oakridge, OR")
      await expectNoPrivateDetails(plain, "the job page without JavaScript")
    } finally {
      await context.close()
    }
  })
})
