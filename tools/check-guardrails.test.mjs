import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkGuardrails, scanSource } from "./check-guardrails.mjs"

// Every sample below is a bad or a good line for one rule of the legal review of November 2026
// (docs/legal/2026-11-legal-review.md). The guardrail skips this file when it walks the repository, because the bad
// samples are here on purpose.

const script = fileURLToPath(new URL("./check-guardrails.mjs", import.meta.url))

const V2_COMPONENT = "apps/web/components/v2/profile/PublicHaulerProfile.tsx"
const UI_COMPONENT = "packages/ui/src/marketplace/JobSummary.tsx"
const PUBLIC_PAGE = "apps/web/components/v3/PublicPages.tsx"
const CONTRACT = "packages/contracts/src/marketplace-v2.ts"
const TERMS = "apps/web/lib/legal/terms.ts"

/** The ids of the rules that fire on `source` as if it were the file `file`. */
function fired(file, source) {
  return [...new Set(scanSource(file, source).map((failure) => failure.id))]
}

function assertFires(id, file, samples) {
  for (const sample of samples) {
    assert.ok(fired(file, sample).includes(id), `${id} must fire in ${file} on: ${sample}`)
  }
}

function assertPasses(id, file, samples) {
  for (const sample of samples) {
    assert.ok(!fired(file, sample).includes(id), `${id} must not fire in ${file} on: ${sample}`)
  }
}

test("(a) customer copy never says LogLoads finds, provides, arranges, supplies, books, dispatches or guarantees trucks, loads or haulers", () => {
  assertFires("broker-holding-out", PUBLIC_PAGE, [
    `<p>LogLoads finds trucks for your landing.</p>`,
    `const hero = "LogLoads provides log trucks when you need them."`,
    `const hero = "LogLoads arranges your loads"`,
    `const hero = "LogLoads supplies haulers to mills."`,
    `const hero = "LogLoads books trucks for you"`,
    `const hero = "LogLoads dispatches trucks to your landing"`,
    `const hero = "LogLoads guarantees loads every week"`,
    `const hero = "We find the trucks. You run the landing."`,
    `const hero = "We'll find you haulers in minutes."`,
    `const hero = "LogLoads will find trucks for every job"`,
    `const hero = "Our team books carriers for you."`,
    `const hero = "Guaranteed loads for every hauler."`,
    `const hero = "Trucks dispatched by LogLoads."`
  ])
  assertFires("broker-holding-out", "packages/services/src/v2/notify/templates.ts", [`const subject = "LogLoads found you a load"`])
  assertFires("broker-holding-out", UI_COMPONENT, [`<p>LogLoads guarantees trucks.</p>`])

  assertPasses("broker-holding-out", PUBLIC_PAGE, [
    `<a href="/v2/landing/trucks">Find trucks</a>`,
    `const hero = "The landing posts the job. The hauler responds."`,
    `const hero = "Post a job and haulers respond to you directly."`,
    `const note = "Stated by the poster. Not a LogLoads guarantee."`,
    `const terms = "LogLoads does not arrange transportation, select carriers, negotiate for either side or set rates."`,
    `const terms = "LogLoads does not guarantee that a job is real or still open, that a hauler is qualified or available."`,
    `const body = "if we find that your business does not qualify or already has a founding offer under another account."`,
    `const body = "LogLoads provides software for posting timber hauling jobs."`,
    `const body = "LogLoads never books trucks and never guarantees loads."`,
    `const body = "There are no guaranteed loads. A haul is never arranged by LogLoads."`,
    ` * Internal note in a comment: LogLoads finds trucks is the phrase the rule bans.`,
    `// LogLoads finds trucks is the phrase the rule bans.`
  ])
  // Tests quote the banned phrases to assert they are absent.
  assertPasses("broker-holding-out", "apps/web/lib/public-entry-copy.test.ts", [`expect(copy).not.toContain("LogLoads finds trucks")`])
})

test("(a) the legal conclusion 'LogLoads is not a broker' stays in the Terms only", () => {
  const conclusion = `const body = "LogLoads is not a motor carrier, broker, freight forwarder or dispatcher."`

  assertFires("broker-legal-conclusion", PUBLIC_PAGE, [
    conclusion,
    `<p>LogLoads is not a broker.</p>`,
    `<p>LogLoads isn't a freight broker</p>`,
    `const faq = "We are not a broker and never touch freight money."`
  ])
  assertFires("broker-legal-conclusion", "apps/web/lib/legal/privacy.ts", [conclusion])

  assertPasses("broker-legal-conclusion", TERMS, [conclusion])
  // Earlier Terms versions are kept word for word as a record of what people accepted.
  assertPasses("broker-legal-conclusion", "apps/web/lib/legal-archive.ts", [conclusion])
  assertPasses("broker-legal-conclusion", PUBLIC_PAGE, [
    `const hero = "The landing posts the job. The hauler responds. They agree the haul between themselves."`,
    `const body = "LogLoads is not a party to any hauling agreement."`
  ])
})

test("(b) a bare verification word is never a label on an organization, profile, job or truck", () => {
  for (const word of ["Verified", "Trusted", "Approved", "Vetted", "Safe", "Certified", "Background checked", "Background-checked"]) {
    assertFires("bare-verification-word", V2_COMPONENT, [
      `<Badge tone="success">${word}</Badge>`,
      `const label = "${word}"`,
      `return { label: '${word}', tone: "success" }`,
      `<span>\n  ${word}\n</span>`
    ])
  }

  assertFires("bare-verification-word", V2_COMPONENT, [
    `const label = "VERIFIED"`,
    `const label = "Verified hauler"`,
    `const label = "Trusted carriers"`,
    `const label = "Verified ✓"`,
    `<Chip label="verified" />`,
    `<img alt="certified" src="/mark.svg" />`,
    `const label = "LogLoads Verified"`,
    `const label = "Vetted by LogLoads"`
  ])
  assertFires("bare-verification-word", UI_COMPONENT, [`<span className={styles.mark}>Verified</span>`])
  assertFires("bare-verification-word", CONTRACT, [`return { label: "Verified", state: "reviewed" }`])
  assertFires("bare-verification-word", "apps/web/app/v2/hauler/trucks/page.tsx", [`<Badge>Safe</Badge>`])
  assertFires("bare-verification-word", "apps/web/lib/marketplace-v2/find-work.ts", [`const badge = "Approved"`])
})

test("(b) the full reviewed sentences, the freshness labels and stored values pass", () => {
  // The strings in code since PR #393 (legal review §7.3 items 1, 4, 7 and 10).
  assertPasses("bare-verification-word", CONTRACT, [
    "return { label: `Business identity reviewed by LogLoads on ${date}`, state: \"reviewed\" }",
    `const label = "Business identity reviewed by LogLoads on Oct 14, 2026"`,
    `const label = "Business identity last reviewed by LogLoads on Oct 14, 2025"`,
    `const label = "Business identity reviewed by LogLoads, date not on record"`,
    `const label = "Not yet reviewed"`,
    `const label = "Confirmed by North Pine Logging 3 days ago"`,
    `const label = "Last confirmed by North Pine Logging 9 days ago — check with the poster"`
  ])
  assertPasses("bare-verification-word", V2_COMPONENT, [
    `<span>Business identity reviewed by LogLoads on Oct 14, 2026</span>`,
    `<span>Not yet reviewed</span>`,
    `if (value.verification_status === "verified") return mark`,
    `const verificationStatus = z.enum(["unverified", "pending", "verified", "rejected"])`,
    `<Icon aria-hidden name="status.verified" size={16} />`,
    `<span className={styles.verified} data-state={state} title={meaning}>`,
    `note: "Self-reported by the hauler; not verified",`,
    ` * caller can pass a generic "Verified" (Gate 5).`,
    `<p>Your padding respects the safe areas.</p>`
  ])
  // Tests quote the word to assert it is absent, so they stay outside the rule. Since #428 the pilot cockpits are inside
  // it: see the #428 tests below.
  assertPasses("bare-verification-word", "packages/ui/src/marketplace/indicators.test.tsx", [`expect(html).not.toContain(">Verified<")`])
})

// #428 widened the rule from Marketplace V2 to every file a customer can read words from. The pilot cockpits under
// components/v3 are what production serves while Marketplace V2 is off, so they are live surfaces, not retired ones.
const COCKPIT = "apps/web/components/v3/FleetPages.tsx"
const COPY_DECK = "docs/content/ux-copy-deck.md"

test("(b) #428: the pilot cockpits, their data and the contracts never show a bare verification word", () => {
  // The strings that were on screen before #428, each in the file that held it.
  const before = {
    "apps/web/components/v3/AdminPages.tsx": [`    return "Verified"`, `          <Metric label="Verified" value={verifiedCount} />`],
    "apps/web/components/v3/Shells.tsx": [`    return "Verified"`],
    "apps/web/components/v3/DriverPages.tsx": [`    return { label: "Verified", tone: "success" }`],
    [COCKPIT]: [`    return <Badge tone="success">Verified</Badge>`],
    "apps/web/components/v3/HostActions.tsx": [
      `  ["verified_network", "Verified carriers", "Limited to carriers building a verified track record."]`
    ],
    "apps/web/components/v3/LoadMap.tsx": ["          : `Verified ${formatDateTime(pack.lastVerifiedAt)}`}"],
    "apps/web/lib/credential-data.ts": [
      `  satisfied: { blocksWork: false, label: "Approved", tone: "success" }`,
      `  approved: { label: "Approved", tone: "success" },`
    ],
    "apps/web/lib/verification-data.ts": [`  verified: { label: "Verified", tone: "success" },`],
    "apps/web/lib/plans.ts": [`      label: "Verified",`],
    "apps/web/lib/v3-shared.ts": [`    return "Verified network"`],
    "apps/web/lib/admin-data.ts": [`  verified_network: "Verified network"`],
    "packages/contracts/src/reputation.ts": [`  safe: "Safe",`],
    "packages/contracts/src/recommendations.ts": [`    return "Verified regional work"`]
  }

  for (const [file, samples] of Object.entries(before)) {
    assertFires("bare-verification-word", file, samples)
  }

  // The whole web app, the shared components, the contracts and the services are covered, not only the files above.
  assertFires("bare-verification-word", "apps/web/lib/pilot-showroom.ts", [`const badge = "Verified"`, `const badge = "Trusted local carriers"`])
  assertFires("bare-verification-word", "apps/web/app/driver/profile/page.tsx", [`<Badge>Approved</Badge>`])
  assertFires("bare-verification-word", "packages/services/src/notifications.ts", [`const subject = "Business identity verified"`])
  assertFires("bare-verification-word", "packages/ui/src/primitives/Badge.tsx", [`const label = "Certified"`])
  // The word after its noun, and the word before a date, are the same label.
  assertFires("bare-verification-word", COCKPIT, [
    `label: "Organization verified"`,
    `<span>Identity verified</span>`,
    "const note = `Approved on ${day}`",
    `<span>Verified {formatDate(reviewedAt)}</span>`
  ])
})

test("(b) #428: the attributed statements, stored values and plain sentences pass in the cockpits", () => {
  assertPasses("bare-verification-word", COCKPIT, [
    // What replaced the bare words.
    `const label = "Business identity reviewed by LogLoads on Oct 14, 2026"`,
    `const label = "Business identity reviewed by LogLoads, date not on record"`,
    `const label = "Business identity last reviewed by LogLoads on Oct 14, 2025"`,
    `const label = "Not yet reviewed"`,
    `<Metric label="Identity reviewed" value={reviewedCount} />`,
    `  satisfied: { blocksWork: false, label: "Checked by LogLoads", tone: "success" }`,
    "const detail = `LogLoads checked this record on ${dayText(reviewedAt)}. In date until ${dayText(expiresOn)}.`",
    `  ["verified_network", "Identity-reviewed carriers", "Only hauling organizations whose business identity LogLoads has reviewed see it."]`,
    "          : `Issued ${formatDateTime(pack.lastVerifiedAt)}.`}",
    `  safe: "Worked safely",`,
    `    return "Open to identity-reviewed carriers"`,
    // A refusal is not an endorsement, and stays.
    `    return { label: "Not approved", tone: "critical" }`,
    // Stored values and keys are lower case.
    `  if (status === "verified") {`,
    `const verifiedCount = organizations.filter((organization) => organization.verificationStatus === "verified").length`,
    `decide("verify", "verified")`,
    // Sentences that use the word for what the person did.
    `<p>Invite trusted carriers or hosts to share work and selected availability.</p>`,
    `const detail = "Riley Woods's approved, current records cover Unit 1."`,
    `<button type="submit">Save and verify briefing</button>`
  ])

  // The Privacy Policy says it keeps LogLoads safe. That is not a label on anyone.
  assertPasses("bare-verification-word", "apps/web/lib/legal/privacy.ts", [
    `    "keep LogLoads safe: reviewing businesses, preventing fraud, spam and contact harvesting, handling reports, and securing accounts",`
  ])
  assertFires("bare-verification-word", "apps/web/lib/legal/privacy.ts", [`const line = "LogLoads Verified businesses"`])

  // One named exemption: the status.verified icon's default accessible name. Every use is aria-hidden today; the
  // neutral icon is #336 and #423 holds the file. The same line anywhere else still fires.
  const iconLine = `  "status.verified": { key: "status.verified", icon: SealCheck, label: "Verified", weight: "duotone" },`
  assertPasses("bare-verification-word", "packages/ui/src/icons/registry.ts", [iconLine])
  assertFires("bare-verification-word", "packages/ui/src/icons/other-registry.ts", [iconLine])
})

test("(b) #428: the copy deck never writes a bare verification word as product copy", () => {
  // What the deck said before #428 and #344.
  assertFires("bare-verification-word", COPY_DECK, [
    `**Tabs:** Pending, Verified, Denied, Suspended`,
    `**Denied subject:** Business identity was not verified`,
    `**Body:** "First 10 qualifying landing organizations per opened state. One per verified organization."`,
    `**Mark text the public will see:** "Business identity verified"`,
    `**Absent:** "Not verified"`,
    `**Badge:** Verified`,
    `**Card label:** "Trusted hauler"`
  ])

  assertPasses("bare-verification-word", COPY_DECK, [
    `**Tabs:** Pending, Identity reviewed, Denied, Suspended`,
    `**Mark text the public will see:** "Business identity reviewed by LogLoads on {date}". After 12 months: "Business identity last reviewed by LogLoads on {date}". With no review: "Not yet reviewed".`,
    `**Denied subject:** Business identity review not completed for {organization}`,
    `**Body:** LogLoads could not confirm the business identity of {organization} from what was submitted.`,
    // The deck states the rule by quoting the word it bans.
    `**Verification:** "Business identity reviewed by LogLoads on {date}" only after that specific review. Never the bare word "Verified". Absence of the mark is not an accusation.`,
    `| Road note haulers may see | Optional. Safe summary only. | Move gate codes and private road names to the landing's Access tab. |`,
    `**Status:** Draft for founder review. Not approved. Not in the product.`,
    `**Low area:** "Do not sell extra invitations here. Add-on packs are not approved."`
  ])

  // The rule reads the copy deck, not every document: design notes and decisions quote the old strings.
  assertPasses("bare-verification-word", "docs/DECISIONS.md", [`**Tabs:** Pending, Verified, Denied, Suspended`])
})

// #448 (review pass 3 of PR 445). The #428 patterns fired only when the word started or ended a whole string. Two
// strings on live screens passed: the word in the middle of a sentence, and a noun, the word and then a date.
test("(b) #448: the word in front of its noun inside a sentence, and a noun plus the word plus a date, fire", () => {
  // The strings that were on screen before #448, each in the file that held it.
  assertFires("bare-verification-word", "apps/web/lib/v3-shared.ts", [
    `        points: ["Keep it inside your carrier circle", "Open it to verified carriers in the region", "Or post it for everyone"]`
  ])
  assertFires("bare-verification-word", "apps/web/components/v3/HostPages.tsx", [
    "                      ? `Details verified ${formatDateTime(landing.lastVerifiedAt)}`",
    `                      : "Details not yet verified"`
  ])

  // The sentence form: verified, vetted or certified, then the thing it describes, anywhere in a string or a JSX text.
  assertFires("bare-verification-word", COCKPIT, [
    `const body = "Only vetted haulers see this load."`,
    `const body = 'Work with certified local drivers near you.'`,
    "const body = `Post to ${count} verified fleets today`",
    `<p>Open it to verified carriers in the region.</p>`,
    `<p>\n  Post the work to our Verified carriers and wait.\n</p>`,
    `<Field hint="Seen by verified organizations only" />`
  ])
  // A noun, the word, then a date from the code.
  assertFires("bare-verification-word", COCKPIT, [
    "const note = `Record approved on ${day}`",
    "const note = `Last saved. Business identity verified since ${day}.`",
    `<span>Details verified {formatDateTime(landing.lastVerifiedAt)}</span>`,
    `<span>Equipment certified {formatDate(reviewedAt)}</span>`
  ])
  // "Not yet" in front of the word still says a verification exists.
  assertFires("bare-verification-word", COCKPIT, [`<span>Identity not yet verified</span>`, `label: "Organization not verified"`])
})

test("(b) #448: what replaced the two strings, 'trusted' in a sentence, negations and code pass", () => {
  assertPasses("bare-verification-word", "apps/web/lib/v3-shared.ts", [
    `        points: ["Keep it inside your carrier circle", "Open it to identity-reviewed carriers in the region", "Or post it for everyone"]`,
    "  return lastSavedAt ? `Details saved ${formatDateTime(lastSavedAt)}` : \"No briefing saved yet\"",
    `  "LogLoads reviews the business identity details you send and records the date. This identity review does not cover insurance, authority or safety."`
  ])
  assertPasses("bare-verification-word", COCKPIT, [
    // "Trusted" stays out of the sentence form: the person, not LogLoads, decides whom they trust.
    `<p>Invite trusted carriers or hosts to share work and selected availability.</p>`,
    `const body = "Share availability with trusted fleets you already work with."`,
    // Saying what was not done is not a claim.
    `const body = "LogLoads has not verified carriers' insurance."`,
    `const body = "Self-reported by the hauler; never certified records."`,
    `const body = "Unverified carriers see public work only."`,
    // The verifier is named, and the word between is not lower case.
    `<span>Verified Clerk identity</span>`,
    // A broken invariant about a stored status is not a label. The same words in a label still fire (below).
    `        throw new RangeError("A verified business has no review date")`,
    // Stored values, keys and code.
    `  ["verified_network", "Identity-reviewed carriers", "Only hauling organizations whose business identity LogLoads has reviewed see it."]`,
    `const verified = records.filter((record) => record.status === "verified" && record.documents.length > 0)`,
    `if (status === "verified") return carriers`,
    `const label = isVerified ? "verified" : carriers.length > 0 ? "pending" : "none"`,
    `<Icon aria-hidden name="status.verified" size={14} /> You rated {trip.reviewable.counterpartyName}.`,
    // The billing record sentence in the host cockpit is about LogLoads' own record, with the verb after its noun.
    `              : "Live publication is held until the billing record is verified."}`,
    "          : `Issued ${formatDateTime(pack.lastVerifiedAt)}.`}",
    `          {pending ? "Saving…" : "Save and verify briefing"}`
  ])
  assertFires("bare-verification-word", COCKPIT, [`const note = "A verified business has no review date"`])
})

test("(b) a public marketplace component takes the verification object, never a bare verified flag", () => {
  assertFires("public-verified-flag", V2_COMPONENT, [`  verified: boolean`, `  verified?: boolean`, `<CompanyProfileHeader verified={true} />`, `<CompanyProfileHeader verified />`])
  assertFires("public-verified-flag", "packages/ui/src/marketplace/CompanyProfileHeader.tsx", [`  isVerified: boolean`])

  assertPasses("public-verified-flag", V2_COMPONENT, [
    `  verification: MarketplaceVerification | null`,
    `<VerificationIndicator now={now} verification={profile.verification} />`
  ])
  // The hauler's own profile form is private: the flag only tells it that a name change re-opens the review.
  assertPasses("public-verified-flag", "apps/web/components/v2/profile/HaulerProfileForm.tsx", [`  verified: boolean`])
})

test("(c) 'free forever' never appears on a customer surface", () => {
  assertFires("free-forever", "apps/web/lib/pilot-showroom.ts", [
    `commercialTruth: "Driver access is free forever. The stated driver pay is never reduced.",`,
    `const copy = "Free forever for haulers"`,
    `const copy = "free-forever"`,
    `const copy = "Forever free for fleets"`,
    `const copy = "Free for life"`
  ])
  assertFires("free-forever", PUBLIC_PAGE, [`<h2>Haulers are free forever</h2>`])
  assertFires("free-forever", CONTRACT, [`export const HAULER_PROMISE = "Free forever."`])

  assertPasses("free-forever", PUBLIC_PAGE, [
    `const copy = "Free for haulers and fleets. Finding work, listing your trucks and messaging landings will not cost you anything."`,
    `const copy = "Driver access is free."`,
    `/** Haulers and hauling businesses use core marketplace features free forever (§2.1). */`,
    ` * Free forever. Self-reported, never tracked.`
  ])
  // A test may name the phrase to assert it is absent.
  assertPasses("free-forever", "apps/web/lib/public-entry-copy.test.ts", [`expect(source).not.toMatch(/free forever/i)`])
  assertPasses("free-forever", "apps/web/tests/subscription-billing.spec.ts", [`await expect(hauler).not.toContainText("free forever")`])
  assertPasses("free-forever", "docs/DECISIONS.md", [`Haulers and fleets remain free forever.`])
})

test("(d) no session replay, chat widget or advertising pixel package", () => {
  for (const name of [
    "@fullstory/browser",
    "logrocket",
    "react-hotjar",
    "@hotjar/browser",
    "rrweb",
    "@microsoft/clarity",
    "smartlook-client",
    "@sentry/replay",
    "react-use-intercom",
    "@intercom/messenger-js-sdk",
    "crisp-sdk-web",
    "tawkto-react",
    "react-zendesk",
    "@livechat/widget-react",
    "react-facebook-pixel",
    "tiktok-pixel",
    "react-linkedin-insight",
    "react-gtm-module",
    "@next/third-parties"
  ]) {
    assertFires("recording-vendor-package", "apps/web/package.json", [`{ "dependencies": { "${name}": "^1.0.0" } }`])
  }
  assertFires("recording-vendor-package", "package.json", [`{ "devDependencies": { "logrocket": "1.0.0" } }`])

  assertPasses("recording-vendor-package", "apps/web/package.json", [
    `{ "dependencies": { "posthog-js": "1.0.0", "@sentry/nextjs": "10.0.0", "next": "16.0.0", "@clerk/nextjs": "6.0.0" } }`
  ])
})

test("(d) no session replay, chat widget or advertising pixel script", () => {
  const layout = "apps/web/app/layout.tsx"

  assertFires("recording-vendor-script", layout, [
    `<Script src="https://connect.facebook.net/en_US/fbevents.js" />`,
    `<Script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX" />`,
    `<Script src="https://static.hotjar.com/c/hotjar-1.js" />`,
    `<Script src="https://widget.intercom.io/widget/abc" />`,
    `<Script src="https://client.crisp.chat/l.js" />`,
    `<Script src="https://embed.tawk.to/abc/default" />`,
    `<Script src="https://www.clarity.ms/tag/abc" />`,
    `<Script src="https://cdn.lr-ingest.com/LogRocket.min.js" />`,
    `<Script src="https://edge.fullstory.com/s/fs.js" />`,
    `<Script src="https://snap.licdn.com/li.lms-analytics/insight.min.js" />`,
    `<Script src="https://analytics.tiktok.com/i18n/pixel/events.js" />`,
    `fbq("track", "PageView")`,
    `window.Intercom("boot", { app_id })`,
    `window.dataLayer.push({ event: "signup" })`,
    `import LogRocket from "logrocket"`,
    `const { default: Hotjar } = await import("@hotjar/browser")`,
    `Sentry.init({ integrations: [Sentry.replayIntegration()] })`,
    `Sentry.init({ replaysSessionSampleRate: 0.1 })`,
    `posthog.startSessionRecording()`,
    `posthog.init(key, { disable_session_recording: false })`,
    `posthog.init(key, { disable_session_recording: !consented })`
  ])
  assertFires("recording-vendor-script", "apps/web/public/widget.js", [`window.$crisp = []`])

  assertPasses("recording-vendor-script", layout, [
    `posthog.init(key, { ...ANALYTICS_CAPTURE_POLICY })`,
    `  disable_session_recording: true,`,
    `["Facebook", "https://www.facebook.com/logloads"],`,
    `const NAMED_CHANNELS = new Set(["sms", "facebook", "copy_link", "other"])`,
    `const QUERY = /^\\$?(?:gclid|dclid|fbclid|msclkid|ttclid)$/i`,
    `Sentry.init({ dsn, tracesSampleRate: 0 })`
  ])
  // A test may name a vendor to assert that nothing loads it.
  assertPasses("recording-vendor-script", "apps/web/tests/pilot-showroom.spec.ts", [`expect(requests).not.toContain("https://connect.facebook.net/en_US/fbevents.js")`])
})

test("(d) disable_session_recording stays true in ANALYTICS_CAPTURE_POLICY", () => {
  const file = "apps/web/lib/analytics-pageview.ts"
  const policy = (body) => `export const ANALYTICS_CAPTURE_POLICY = Object.freeze({\n${body}\n})\n`

  assertFires("session-recording-policy", file, [
    policy(`  autocapture: false,\n  disable_surveys: true`),
    policy(`  autocapture: false,\n  disable_session_recording: false,\n  disable_surveys: true`),
    policy(`  autocapture: false,\n  disable_session_recording: replayAllowed === false,`),
    // True somewhere else in the file does not count.
    `${policy("  autocapture: false")}\nexport const OTHER = { disable_session_recording: true }\n`,
    `export const SOMETHING_ELSE = 1\n`
  ])

  assertPasses("session-recording-policy", file, [
    policy(`  autocapture: false,\n  disable_session_recording: true,\n  logs: { captureConsoleLogs: false },\n  rageclick: false`),
    policy(`  logs: { captureConsoleLogs: false },\n  disable_session_recording: true`)
  ])
  assertPasses("session-recording-policy", "apps/web/lib/analytics/client.ts", [`export const x = 1\n`])
})

test("(e) the inquiry status list never gains accepted, awarded, assigned, booked or hired", () => {
  for (const status of ["accepted", "awarded", "assigned", "booked", "hired"]) {
    assertFires("inquiry-outcome-status", CONTRACT, [
      `export const marketplaceInterestStatusSchema = z.enum(["submitted", "viewed", "replied", "${status}", "declined", "withdrawn"])`,
      `export const marketplaceInterestStatusSchema = z.enum([\n  "submitted",\n  "viewed",\n  "replied",\n  "declined",\n  "withdrawn",\n  "${status}"\n])`,
      // A renamed schema is still the inquiry list.
      `export const inquiryStatus = z.enum(["${status}", "submitted", "viewed", "replied"])`
    ])
    assertFires("inquiry-outcome-status", "architecture/normalized-v2/01_schema.sql", [
      `check (status in ('submitted', 'viewed', 'replied', 'declined', 'withdrawn', '${status}')),`
    ])
    assertFires("inquiry-outcome-status", "supabase/migrations/20261201000000_inquiries.sql", [
      `alter table marketplace.job_interests add constraint job_interests_status_check\n  check (status in ('submitted', 'viewed', 'replied', '${status}'));`
    ])
  }

  assertPasses("inquiry-outcome-status", CONTRACT, [
    `export const marketplaceInterestStatusSchema = z.enum(["submitted", "viewed", "replied", "declined", "withdrawn"])`,
    // Another list may hold one of the words: a seat invitation is accepted, and that is not an inquiry.
    `export const seatInvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"])`,
    `// nothing reads as hired, booked or assigned`
  ])
  assertPasses("inquiry-outcome-status", "architecture/normalized-v2/01_schema.sql", [
    `check (status in ('submitted', 'viewed', 'replied', 'declined', 'withdrawn')),`,
    `set status = case when status in ('submitted', 'viewed') then 'replied' else status end,`
  ])
})

test("the rules that were here before still fire", () => {
  assert.ok(fired("apps/web/lib/x.ts", `import { thing } from "@logloads/core"`).length > 0)
  assert.ok(fired("apps/web/components/v2/X.tsx", `<svg viewBox="0 0 1 1" />`).length > 0)
  assert.ok(fired("packages/services/src/x.ts", `const charge = { transfer_data: { destination } }`).length > 0)
  assert.ok(fired("apps/web/lib/x.ts", `const score = "87 / 100"`).length > 0)
  assert.ok(fired("apps/web/components/v3/PublicPages.tsx", `<p>Start subscription</p>`).length > 0)
  assert.deepEqual(fired("apps/web/lib/x.ts", `export const fine = "Post a job. Haulers respond."`), [])
})

test("a failure names the file, the line and the rule", () => {
  const failures = scanSource(PUBLIC_PAGE, `const a = 1\nconst b = 2\nconst hero = "Haulers are free forever"\n`)

  assert.equal(failures.length, 1)
  assert.equal(failures[0].file, PUBLIC_PAGE)
  assert.equal(failures[0].line, 3)
  assert.equal(failures[0].id, "free-forever")
  assert.match(failures[0].message, /free forever/i)
})

// One fixture repository, written once and removed after the run.
const temporaryRoots = []
after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true })
})

function fixtureRepository(files) {
  const root = mkdtempSync(join(tmpdir(), "logloads-guardrails-344-"))
  temporaryRoots.push(root)

  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }

  return root
}

const GOOD_POLICY = `export const ANALYTICS_CAPTURE_POLICY = Object.freeze({\n  autocapture: false,\n  disable_session_recording: true\n})\n`

test("the command passes a clean tree and fails a tree with a violation", () => {
  const clean = fixtureRepository({
    "apps/web/lib/analytics-pageview.ts": GOOD_POLICY,
    "apps/web/lib/copy.ts": `export const hero = "The landing posts the job. The hauler responds."\n`
  })
  assert.deepEqual(checkGuardrails({ root: clean }), [])

  const passed = spawnSync(process.execPath, [script, "--root", clean], { encoding: "utf8" })
  assert.equal(passed.status, 0, passed.stderr)
  assert.match(passed.stdout, /LogLoads guardrails passed\./)

  const dirty = fixtureRepository({
    "apps/web/lib/analytics-pageview.ts": GOOD_POLICY,
    "apps/web/lib/copy.ts": `export const hero = "LogLoads finds trucks for you. Free forever."\n`,
    "apps/web/package.json": `{ "dependencies": { "logrocket": "1.0.0" } }\n`,
    // A dependency folder is never read.
    "node_modules/logrocket/index.js": `window.LogRocket = {}\n`
  })
  const failed = spawnSync(process.execPath, [script, "--root", dirty], { encoding: "utf8" })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /apps\/web\/lib\/copy\.ts:1 .*\[broker-holding-out\]/)
  assert.match(failed.stderr, /apps\/web\/lib\/copy\.ts:1 .*\[free-forever\]/)
  assert.match(failed.stderr, /apps\/web\/package\.json:1 .*\[recording-vendor-package\]/)
  assert.doesNotMatch(failed.stderr, /node_modules/)
})

test("#428: the command fails a tree with a bare word in a pilot cockpit or in the copy deck", () => {
  const dirty = fixtureRepository({
    "apps/web/lib/analytics-pageview.ts": GOOD_POLICY,
    [COCKPIT]: `export function Mark() {\n  return <Badge tone="success">Verified</Badge>\n}\n`,
    [COPY_DECK]: `# Copy deck\n\n**Tabs:** Pending, Verified, Denied, Suspended\n`
  })
  const failed = spawnSync(process.execPath, [script, "--root", dirty], { encoding: "utf8" })

  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /apps\/web\/components\/v3\/FleetPages\.tsx:2 .*\[bare-verification-word\]/)
  assert.match(failed.stderr, /docs\/content\/ux-copy-deck\.md:3 .*\[bare-verification-word\]/)

  const clean = fixtureRepository({
    "apps/web/lib/analytics-pageview.ts": GOOD_POLICY,
    [COCKPIT]: `export function Mark() {\n  return <Badge tone="info">Business identity reviewed by LogLoads on Oct 14, 2026</Badge>\n}\n`,
    [COPY_DECK]: `# Copy deck\n\n**Tabs:** Pending, Identity reviewed, Denied, Suspended\n`
  })
  assert.deepEqual(checkGuardrails({ root: clean }), [])
})

test("the command fails when the analytics policy file is gone", () => {
  const root = fixtureRepository({ "apps/web/lib/copy.ts": `export const hero = "Post a job."\n` })
  const failures = checkGuardrails({ root })

  assert.deepEqual(failures.map((failure) => failure.id), ["session-recording-policy"])
  assert.equal(failures[0].file, "apps/web/lib/analytics-pageview.ts")
})

test("the repository itself passes", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr)
})
