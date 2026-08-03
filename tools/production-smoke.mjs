// LogLoads production smoke — post-deploy proof against a live URL.
//
//   SMOKE_BASE=https://logloads.com SMOKE_EXPECT_FEE_COLLECTION=disabled SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=disabled node tools/production-smoke.mjs
//
// Adaptive: in dev-session mode it drives the full operating loop; in Clerk mode
// (real production auth) the interactive loop is skipped with a clear MANUAL note,
// since Clerk sign-in can't be scripted without credentials. Integration wiring,
// public surfaces, auth protection, and health are always checked.
//
// Exit code is non-zero if any hard check FAILs. SKIP/MANUAL do not fail the run.
import { chromium } from "@playwright/test"

const BASE = (process.env.SMOKE_BASE ?? process.argv[2] ?? "http://127.0.0.1:3002").replace(/\/$/, "")
const results = []
const record = (status, name, detail = "") => {
  results.push({ status, name, detail })
  console.log(`${status.padEnd(6)} ${name}${detail ? ` — ${detail}` : ""}`)
}

// 1. Health + integration wiring
let health
try {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(15000) })
  health = await res.json()
  record(res.status === 200 && health.status === "ok" ? "PASS" : "FAIL", "health", `${res.status} engine=${health?.engine?.ok} profiles=${health?.engine?.profiles}`)
} catch (error) {
  record("FAIL", "health", String(error).slice(0, 120))
}

const integrations = health?.integrations ?? {}
const authMode = integrations.auth ?? "unknown"
record("INFO", "integrations", JSON.stringify(integrations))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

try {
  // 2. Public product renders
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 })
  const heroOk = await page.getByRole("heading", { name: "Move more loads. Make fewer calls." })
    .waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)
  record(heroOk ? "PASS" : "FAIL", "public home renders")

  await page.goto(`${BASE}/loads`, { waitUntil: "domcontentloaded" })
  const loadsOk = await page.getByText("Exact access unlocks after assignment.").first()
    .waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)
  record(loadsOk ? "PASS" : "FAIL", "public loads renders")

  // 3. Cockpits are protected (unauthenticated → sign-in)
  await page.goto(`${BASE}/driver/map`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(800)
  record(page.url().includes("/sign-in") ? "PASS" : "FAIL", "cockpit protected", new URL(page.url()).pathname)

  // 4-9. Authenticated loop
  if (authMode === "dev-session") {
    const email = "hank@northpine.example"
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" })
    await page.fill('input[name="email"]', email)
    await page.click('button[type="submit"]')
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {})
    record(page.url().includes("/driver/map") ? "PASS" : "FAIL", "auth: driver reaches Map", new URL(page.url()).pathname)

    await page.goto(`${BASE}/driver/loads`, { waitUntil: "networkidle" })
    const cards = await page.locator("a.load-card-v3").count()
    record(cards > 0 ? "PASS" : "FAIL", "load discovery", `${cards} cards`)
  } else {
    record("MANUAL", "authenticated loop", `auth=${authMode}: sign in as a real user and run request→approve→trip→message`)
  }

  // 10-11. Billing / email / analytics / errors wiring
  const percentageBilling = integrations.billingPercentageV1 ?? {}
  const expectedFeeCollection =
    process.env.SMOKE_EXPECT_FEE_COLLECTION?.trim().toLowerCase() ?? "missing"
  const collectionExpectationValid =
    expectedFeeCollection === "enabled" || expectedFeeCollection === "disabled"
  const expectedEnrollment =
    process.env.SMOKE_EXPECT_PERCENTAGE_ENROLLMENT?.trim().toLowerCase() ?? "missing"
  const enrollmentExpectationValid =
    expectedEnrollment === "enabled" || expectedEnrollment === "disabled"
  const expectedEnrollmentCount = Number.parseInt(
    process.env.SMOKE_EXPECT_PERCENTAGE_ALLOWED_ORGANIZATION_COUNT ?? "",
    10
  )
  const expectedEnrollmentScope =
    process.env.SMOKE_EXPECT_PERCENTAGE_ALLOWED_ORGANIZATION_SCOPE_SHA256
      ?.trim()
      .toLowerCase() ?? ""
  const enrollmentScopeMatches = expectedEnrollment === "disabled"
    ? percentageBilling.enrollment === "disabled" &&
      percentageBilling.allowedOrganizationCount === 0 &&
      percentageBilling.allowedOrganizationScopeSha256 === null &&
      percentageBilling.invalidEnrollmentEntryCount === 0
    : percentageBilling.enrollment === "enabled" &&
      Number.isSafeInteger(expectedEnrollmentCount) &&
      expectedEnrollmentCount > 0 &&
      percentageBilling.allowedOrganizationCount === expectedEnrollmentCount &&
      /^[0-9a-f]{64}$/.test(expectedEnrollmentScope) &&
      percentageBilling.allowedOrganizationScopeSha256 === expectedEnrollmentScope &&
      percentageBilling.invalidEnrollmentEntryCount === 0
  const billingReady =
    collectionExpectationValid &&
    (
      integrations.billing === "dark_configured" ||
      integrations.billing === "collection_configured"
    ) &&
    percentageBilling.stripeSecretConfigured === true &&
    percentageBilling.cardSetupConfigured === true &&
    percentageBilling.providerAccountAssertionConfigured === true &&
    percentageBilling.providerModeAligned === true &&
    percentageBilling.webhookConfigured === true &&
    percentageBilling.collection === expectedFeeCollection
  record(
    billingReady ? "PASS" : "FAIL",
    "percentage billing configuration",
    `state=${String(integrations.billing)} collection=${String(percentageBilling.collection)} expected=${expectedFeeCollection}`
  )
  if (!collectionExpectationValid) {
    record(
      "FAIL",
      "fee collection expectation",
      "set SMOKE_EXPECT_FEE_COLLECTION=enabled or disabled explicitly"
    )
  }
  record(
    enrollmentExpectationValid && enrollmentScopeMatches ? "PASS" : "FAIL",
    "percentage enrollment scope",
    `state=${String(percentageBilling.enrollment)} expected=${expectedEnrollment} organizations=${String(percentageBilling.allowedOrganizationCount)}`
  )
  if (!enrollmentExpectationValid) {
    record(
      "FAIL",
      "percentage enrollment expectation",
      "set SMOKE_EXPECT_PERCENTAGE_ENROLLMENT=enabled or disabled explicitly"
    )
  }
  record(integrations.email ? "PASS" : "SKIP", "email wired", integrations.email ? "Resend key present" : "no Resend key")
  record(integrations.analytics ? "PASS" : "SKIP", "analytics wired", integrations.analytics ? "PostHog key present" : "no PostHog key")
  record(integrations.errorTracking ? "PASS" : "SKIP", "error tracking wired", integrations.errorTracking ? "Sentry DSN present" : "no Sentry DSN")

  // 12. Cold-start recovery is a host-level check.
  record("MANUAL", "cold-start/recovery", "force a fresh instance; confirm it awaits canonical Supabase state before health returns 200")
} finally {
  await browser.close()
}

const fails = results.filter((r) => r.status === "FAIL")
console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${fails.length} failed, ${results.filter((r) => r.status === "SKIP" || r.status === "MANUAL").length} skipped/manual`)
process.exit(fails.length > 0 ? 1 : 0)
