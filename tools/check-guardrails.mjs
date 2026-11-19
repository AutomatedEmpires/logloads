import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = fileURLToPath(new URL("..", import.meta.url))

const ignoredDirs = new Set([
  ".data",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
])

const ignoredFiles = new Set(["pnpm-lock.yaml"])
const textExtensions = new Set([
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml"
])

const commercialCustomerSurfaces = new Set([
  "apps/web/app/pricing/page.tsx",
  "apps/web/components/v3/BillingSettings.tsx",
  "apps/web/components/v3/PublicPages.tsx",
  "apps/web/components/v3/Shells.tsx",
  "apps/web/lib/plans.ts",
  "apps/web/lib/subscription-billing-data.ts",
  "apps/web/lib/v3-shared.ts"
])

const checks = [
  {
    message: "Use @logloads/contracts; @logloads/core is retired.",
    pattern: /@logloads\/core|packages\/core/g
  },
  {
    message: "Use @logloads/ui <Icon>; LogLoads icons are Phosphor through the semantic registry.",
    pattern: /from\s+["'](?:lucide-react|@heroicons\/[^"']+|react-icons(?:\/[^"']+)?|@fortawesome\/[^"']+|@mui\/icons-material(?:\/[^"']+)?)["']/g
  },
  {
    message: "Supabase Storage is the only active private-media provider. Cloudinary runtime imports, environment switches, provider branches, and dependencies are retired.",
    pattern: /(?:(?:process\.env|environment)\.(?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+\b|(?:process\.env|environment)\[\s*["'](?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+["']\s*\]|from\s+["']cloudinary["']|import\(\s*["']cloudinary["']\s*\)|require\(\s*["']cloudinary["']\s*\)|["']cloudinary["']\s*:|\bprovider\s*(?:===|!==|:)\s*["']cloudinary["'])/g,
    include: (file) => {
      const runtimeSource = file.startsWith("apps/") || file.startsWith("packages/")
      const testSource =
        file.includes("/__tests__/") ||
        /(?:^|\/)(?:fixtures|test-helpers)\.[cm]?[jt]sx?$/.test(file) ||
        /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)

      return (
        (runtimeSource && !testSource) ||
        file === "package.json" ||
        file === ".env.example" ||
        file === "ops/production-env-contract.json"
      )
    }
  },
  {
    message: "Cloudinary environment variables are retired from current deployment manifests.",
    pattern: /\b(?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+\b/g,
    include: (file) =>
      file === ".env.example" ||
      file === "ops/production-env-contract.json"
  },
  {
    message: "Feature code must not hand-roll inline SVG icons.",
    pattern: /<svg[\s>]/g,
    include: (file) => file.startsWith("apps/web/") || file.startsWith("packages/ui/")
  },
  {
    // transfer_data and application_fee_amount are banned permanently, not as a
    // posture: they route driver pay through the platform balance (custody) or
    // silently deduct the platform cut from the driver ($500 posted, $475 paid
    // at the decided 5%).
    // Stripe's own tutorials default to both, so a plausible-looking custodial
    // integration would otherwise pass review. Connect itself stays out until a
    // counsel-gated direct-charges design. See AGENTS.md section 7.
    message: "Driver pay must never route through LogLoads. transfer_data/application_fee_amount are permanently banned (custody + fee deduction); Stripe Connect is counsel-gated. See AGENTS.md section 7.",
    pattern: /Stripe Connect|stripe\.accounts|connect_account|transfer_data|application_fee_amount/g,
    include: (file) => file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("supabase/")
  },
  {
    message: "Private operational routes must not be marked public.",
    pattern: /private_operational_route["'\s:]+public|visibility["'\s:]+public_operational_route/g
  },
  {
    message: "LogLoads local web runtime must use port 3002, not 3000.",
    pattern: /(?:127\.0\.0\.1|localhost):3000|\b-p\s+3000\b|PORT=3000/g,
    include: (file) => file.startsWith("apps/web/") || file === "package.json"
  },
  {
    message: "Internal architecture vocabulary is banned from product copy (say what it does for the user).",
    pattern: /operating graph|compatibility engine|purpose-limited|audit trail|network trucks/gi,
    include: (file) => file.startsWith("apps/web/") && !file.startsWith("apps/web/tests/")
  },
  {
    message: "Raw entitlement vocabulary must not render; use plan/feature language in the UI.",
    pattern: /[">]\s*Entitlements?\b/g,
    include: (file) => file.startsWith("apps/web/") && file.endsWith(".tsx")
  },
  {
    message: "Customer surfaces must not revive retired subscription sales, paid fleet access, or checkout language.",
    pattern: /\$499\/mo|Dispatch Pro is \$499 per month|Start subscription|Restart subscription|checkout is temporarily unavailable|Current trial access|active for new Network commitments|Network enrollment is sales-assisted|Enrollment and collection are enabled for this canary organization/gi,
    include: (file) => commercialCustomerSurfaces.has(file)
  },
  {
    message: "The customer subscription projection is historical-only and must not evaluate checkout or new-money authorization.",
    pattern: /canStartCheckout|subscriptionNewMoneyAllowed/g,
    include: (file) => file === "apps/web/lib/subscription-billing-data.ts"
  },
  {
    message: "Numeric match scores are banned; show fit labels with reasons.",
    pattern: /\b\d{1,3}\s*\/\s*100\b/g,
    include: (file) => file.startsWith("apps/web/") && (file.endsWith(".tsx") || file.endsWith(".ts"))
  },
  {
    message: "Cockpit identity comes from the session; hardcoded or client-supplied actors are banned in apps/web.",
    pattern: /V3_ACTORS|DEFAULT_ACTOR_USER_ID|DEFAULT_ORGANIZATION_ID|devActorUserId|LOGLOADS_ENABLE_DEMO_ACTORS|22222222-2222-4222-8222/g,
    include: (file) => file.startsWith("apps/web/") && !file.startsWith("apps/web/tests/")
  },
  {
    message: "Platform-admin authority must use the exact persistent allowlist helper; a raw profile role is not authorization.",
    pattern: /(?:actor\.profile|currentUser|profile|user)\.role\s*(?:===|!==)\s*["']admin["']/g,
    include: (file) => {
      const runtimeSource =
        file.startsWith("apps/web/") &&
        (file.endsWith(".ts") || file.endsWith(".tsx"))
      const testSource =
        file.startsWith("apps/web/tests/") ||
        /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)

      return runtimeSource && !testSource && file !== "apps/web/lib/platform-admin.ts"
    }
  }
]

// ---------------------------------------------------------------------------------------------------------------
// Legal review of November 2026 (docs/legal/2026-11-legal-review.md), P0 items 3, 4, 12 and 14. The samples each
// rule must catch and must pass are in tools/check-guardrails.test.mjs.
// ---------------------------------------------------------------------------------------------------------------

const isSource = (file) => /\.[cm]?[jt]sx?$/.test(file)

const isTestSource = (file) =>
  file.startsWith("apps/web/tests/") ||
  file.includes("/__tests__/") ||
  /(?:^|\/)(?:fixtures|test-helpers)\.[cm]?[jt]sx?$/.test(file) ||
  /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)

// Where words a customer can read are written: the web app, the shared components, the contracts (labels and
// disclosures) and the services (email and notification text). Tests quote banned phrases to assert they are absent.
const customerCopyRoots = ["apps/web/", "packages/ui/src/", "packages/contracts/src/", "packages/services/src/"]
const isCustomerCopy = (file) => isSource(file) && !isTestSource(file) && customerCopyRoots.some((root) => file.startsWith(root))

// The Terms state the legal position (§3.3 item 10, §8.1). Earlier Terms versions are kept word for word as the
// record of what people accepted.
const termsFiles = new Set(["apps/web/lib/legal/terms.ts", "apps/web/lib/legal-archive.ts"])

// Where the bare-word rule reads (§7.3 item 1). #344 covered the Marketplace V2 screens. #428 widened it to every file
// a customer can read words from: the pilot cockpits under components/v3, their data in apps/web/lib (credentials,
// verification records, plans, visibility labels), the contracts (review tags, recommendation reasons) and the
// services. The pilot cockpits are not retired: they are what production serves while Marketplace V2 is off, and 83
// route files under apps/web/app import them.
//
// Each exemption names the file and the reason. Remove the entry when the reason is gone.
const verificationLabelExemptions = new Map([
  [
    "packages/ui/src/icons/registry.ts",
    "The status.verified icon's default accessible name. Every use is aria-hidden today. The neutral icon that replaces it is #336, and #423 holds this file."
  ]
])
const isVerificationLabelSurface = (file) => isCustomerCopy(file) && !verificationLabelExemptions.has(file)

// The copy deck drafts the words before they reach code. Other documents quote the old strings on purpose.
const COPY_DECK = "docs/content/ux-copy-deck.md"

// What another business or a signed-out visitor sees. A form the business fills in about itself is not in here.
const isPublicMarketplaceComponent = (file) =>
  isSource(file) &&
  !isTestSource(file) &&
  (file.startsWith("packages/ui/src/marketplace/") || /^apps\/web\/components\/v2\/profile\/Public[^/]*$/.test(file))

const isRuntimeScript = (file) => isSource(file) && !isTestSource(file) && (file.startsWith("apps/") || file.startsWith("packages/"))

const isInquiryStatusSource = (file) =>
  isRuntimeScript(file) || (file.endsWith(".sql") && (file.startsWith("architecture/normalized-v2/") || file.startsWith("supabase/")))

const HAULING_NOUN = "(?:trucks?|loads?|haulers?|carriers?|drivers?|hauls?|capacity)"
const BARE_WORD = "(?:verified|trusted|approved|vetted|safe|certified|background[ -]checked)"
const BARE_LABEL =
  "(?:Verified|VERIFIED|Trusted|TRUSTED|Approved|APPROVED|Vetted|VETTED|Safe|SAFE|Certified|CERTIFIED|Background[ -][Cc]hecked|BACKGROUND[ -]CHECKED)"
const LABELLED_NOUN =
  "(?:business(?:es)?|haulers?|carriers?|landings?|posters?|fleets?|compan(?:y|ies)|profiles?|jobs?|trucks?|operators?|organi[sz]ations?|drivers?|members?|partners?|identity" +
  // #428: what the pilot cockpits label.
  "|networks?|work|loads?|hauls?|equipment|rigs?|units?|records?|credentials?|documents?)"
// The word alone, or with the thing it describes and at most one lower-case word between ("Trusted local carriers").
const BARE_LABEL_PHRASE = `${BARE_LABEL}(?:[ \\t]+(?:[a-z]+[ \\t]+)?${LABELLED_NOUN})?`
const OUTCOME_STATUS = "(?:accepted|awarded|assigned|booked|hired)"
const BARE_LABEL_MESSAGE =
  "Verified, Trusted, Approved, Vetted, Safe, Certified and Background checked are never a label on an organization, profile, job or truck (legal review §7.3 item 1). Use the full sentence from describeMarketplaceVerification."

// Package names, as regular-expression sources. `[^"']+` stands for the rest of a scoped or suffixed name.
const RECORDING_PACKAGE = [
  // Session replay.
  "@fullstory\\/[^\"']+",
  "fullstory",
  "logrocket",
  "logrocket-[^\"']+",
  "@logrocket\\/[^\"']+",
  "@hotjar\\/[^\"']+",
  "react-hotjar",
  "hotjar-[^\"']+",
  "rrweb",
  "rrweb-[^\"']+",
  "@rrweb\\/[^\"']+",
  "@microsoft\\/clarity",
  "clarity-js",
  "react-microsoft-clarity",
  "smartlook-client",
  "mouseflow-[^\"']+",
  "@mouseflow\\/[^\"']+",
  "@sentry\\/replay",
  "@sentry-internal\\/replay[^\"']*",
  "@openreplay\\/[^\"']+",
  "@highlight-run\\/[^\"']+",
  "highlight\\.run",
  // Chat widgets.
  "@intercom\\/[^\"']+",
  "react-use-intercom",
  "react-intercom",
  "crisp-sdk-web",
  "react-crisp",
  "react-drift",
  "@drift\\/[^\"']+",
  "tawkto-react",
  "@tawk\\.to\\/[^\"']+",
  "react-zendesk",
  "@zendesk\\/[^\"']+",
  "@livechat\\/[^\"']+",
  "react-livechat",
  "@hubspot\\/[^\"']+",
  "react-hubspot[^\"']*",
  "@front\\/chat[^\"']*",
  "react-tidio[^\"']*",
  "olark[^\"']*",
  // Advertising pixels, and the tag loaders that bring them in.
  "react-facebook-pixel",
  "facebook-pixel",
  "react-fb-pixel",
  "@types\\/facebook-pixel",
  "tiktok-pixel",
  "react-tiktok-pixel",
  "react-linkedin-insight",
  "react-twitter-conversion-tracker",
  "react-twitter-pixel",
  "react-snapchat-pixel",
  "react-pinterest-tag",
  "react-gtm-module",
  "@next\\/third-parties",
  "react-ga",
  "react-ga4",
  "@types\\/gtag\\.js"
].join("|")

// The hosts those vendors load from.
const RECORDING_HOST = [
  "connect\\.facebook\\.net",
  "facebook\\.com\\/tr\\b",
  "googletagmanager\\.com",
  "googleadservices\\.com",
  "doubleclick\\.net",
  "googlesyndication\\.com",
  "google-analytics\\.com",
  "snap\\.licdn\\.com",
  "px\\.ads\\.linkedin\\.com",
  "analytics\\.tiktok\\.com",
  "ads-twitter\\.com",
  "sc-static\\.net",
  "bat\\.bing\\.com",
  "ct\\.pinterest\\.com",
  "hotjar\\.com",
  "hotjar\\.io",
  "logrocket\\.(?:com|io)",
  "lr-ingest\\.(?:com|io)",
  "lr-in\\.com",
  "fullstory\\.com",
  "clarity\\.ms",
  "mouseflow\\.com",
  "smartlook\\.com",
  "openreplay\\.com",
  "intercom\\.io",
  "intercomcdn\\.com",
  "crisp\\.chat",
  "driftt\\.com",
  "tawk\\.to",
  "zdassets\\.com",
  "zopim\\.com",
  "hs-scripts\\.com",
  "usemessages\\.com",
  "livechatinc\\.com",
  "olark\\.com",
  "tidio\\.co",
  "freshchat\\.com"
].join("|")

const legalChecks = [
  {
    // §3.3 item 6 (R1). Saying LogLoads does the finding, providing, arranging, supplying, booking, dispatching or
    // guaranteeing is "holding out" as a broker. The landing posts and the hauler responds. A landing's own
    // "Find trucks" search has no LogLoads subject, so it passes. "Does not arrange" and "Not a LogLoads guarantee"
    // describe the conduct, and pass too.
    id: "broker-holding-out",
    message:
      "Customer copy must not say LogLoads finds, provides, arranges, supplies, books, dispatches or guarantees trucks, loads or haulers (legal review §3.3 item 6). Say the landing posts and the hauler responds.",
    pattern: new RegExp(
      "\\b(?:LogLoads|we|our (?:team|staff|platform|service|marketplace|dispatchers?))(?:['’]ll|\\s+will|\\s+can|\\s+also|\\s+always|\\s+now)*\\s+" +
        "(?:find|finds|found|provide|provides|provided|arrange|arranges|arranged|supply|supplies|supplied|book|books|booked|dispatch|dispatches|dispatched|guarantee|guarantees|guaranteed)\\s+" +
        `(?:(?!not\\b|no\\b|never\\b)[\\w'’$-]+\\s+){0,4}?${HAULING_NOUN}\\b` +
        `|(?<!\\b(?:no|not|never|without)\\s+)\\bguaranteed\\s+${HAULING_NOUN}\\b` +
        "|(?<!\\b(?:not|never|nor)\\s+)\\b(?:found|provided|arranged|supplied|booked|dispatched|guaranteed)\\s+(?:for\\s+you\\s+)?by\\s+LogLoads\\b",
      "gi"
    ),
    include: isCustomerCopy,
    skipComments: true
  },
  {
    // §3.3 item 6 and spec §11.5: a legal conclusion on a marketing or product screen promises an exemption.
    id: "broker-legal-conclusion",
    message:
      "Only the Terms may state that LogLoads is not a broker (legal review §3.3 items 6 and 10). Elsewhere, describe what LogLoads does.",
    pattern:
      /\bLogLoads\s+is(?:n['’]t|\s+not)\b[^.\n]{0,80}\bbrokers?\b|\bnot\s+a\s+(?:freight\s+|licensed\s+|transportation\s+|property\s+|load\s+)?broker\b/gi,
    include: (file) => isCustomerCopy(file) && !termsFiles.has(file),
    skipComments: true
  },
  {
    // §7.3 item 1 (R4). The label is always the full sentence, for example "Business identity reviewed by LogLoads
    // on Oct 14, 2026" or "Not yet reviewed". A whole string, or a whole JSX text, that is only the word (with or
    // without the thing it describes) is the bare label. Stored values such as "verified" are lower case and pass.
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(`(?:["'\`]|>)\\s*${BARE_LABEL_PHRASE}\\s*[.!✓✔]?\\s*(?:["'\`]|<)`, "g"),
    include: isVerificationLabelSurface,
    skipComments: true
  },
  {
    // The same word in any case where the code says it is a label, and the two endorsement phrasings. "Keep LogLoads
    // safe" (the Privacy Policy) describes what LogLoads does for itself and is not an endorsement.
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(
      `\\b(?:label|title|badge|alt|caption|tooltip|aria-label|ariaLabel)\\s*[:=]\\s*\\{?\\s*["'\`]\\s*${BARE_WORD}(?:\\s+${LABELLED_NOUN})?\\s*[.!]?\\s*["'\`]` +
        `|(?<!\\bkeep(?:s|ing)?\\s+)\\bLogLoads[- ]${BARE_WORD}\\b` +
        `|\\b${BARE_WORD}\\s+by\\s+LogLoads\\b`,
      "gi"
    ),
    include: isVerificationLabelSurface,
    skipComments: true
  },
  {
    // #428. The word after the thing it describes ("Organization verified", "Business identity verified") is the
    // same label, and so is the word in front of a bare date (`Verified ${date}`, "Approved on {day}"): neither says
    // who checked what.
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(
      `(?:["'\`]|>)\\s*(?:[A-Za-z]+[ \\t]+)?${LABELLED_NOUN}[ \\t]+${BARE_WORD}\\s*[.!]?\\s*(?:["'\`]|<)`,
      "gi"
    ),
    include: isVerificationLabelSurface,
    skipComments: true
  },
  {
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(`(?:\`|>)\\s*${BARE_LABEL}[ \\t]+(?:on[ \\t]+|since[ \\t]+)?(?:\\$\\{|\\{)`, "g"),
    include: isVerificationLabelSurface,
    skipComments: true
  },
  {
    // #428. The copy deck (Markdown) states the rule by quoting the banned word ('Never the bare word "Verified"'),
    // so a quotation right after "bare word" passes. Everything else that reads as a label is caught: an item in a
    // list of tabs, chips or columns, a quoted label, the word next to the thing it describes, and "Not verified".
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(
      `(?:\\*\\*|[,:])[ \\t]*${BARE_LABEL_PHRASE}[ \\t]*(?=,|\\.?[ \\t]*$)` +
        `|(?<!\\b(?:bare|banned)\\s+(?:word|words|label|labels)\\s+)["“][ \\t]*${BARE_LABEL_PHRASE}[ \\t]*[.!]?[ \\t]*["”]`,
      "gm"
    ),
    include: (file) => file === COPY_DECK
  },
  {
    id: "bare-verification-word",
    message: BARE_LABEL_MESSAGE,
    pattern: new RegExp(
      `\\b(?:verified|vetted|certified|trusted)\\s+${LABELLED_NOUN}\\b` +
        `|\\b${LABELLED_NOUN}\\s+(?:was\\s+|is\\s+|has\\s+been\\s+)?(?:not\\s+)?(?:verified|approved|vetted|certified)\\b` +
        `|["“]Not\\s+(?:verified|approved|vetted|certified)["”]`,
      "gi"
    ),
    include: (file) => file === COPY_DECK
  },
  {
    // A yes-or-no flag is how a generic "Verified" reaches a screen. A public component takes the verification
    // object and shows its sentence, its date and its state.
    id: "public-verified-flag",
    message: "A public marketplace component must take the verification object, not a bare verified flag (legal review §7.3 item 1).",
    pattern: /\b(?:is)?[Vv]erified\??\s*:\s*boolean\b|<[A-Z][\w.]*\b[^<>]*\s(?:is)?[Vv]erified(?:=|\s|\/|>)/g,
    include: isPublicMarketplaceComponent,
    skipComments: true
  },
  {
    // §10 Q1 (R8). "Forever" is a promise with no end date. The defined promise is: "Free for haulers and fleets.
    // Finding work, listing your trucks and messaging landings will not cost you anything."
    id: "free-forever",
    message:
      "\"Free forever\" must not appear on a customer surface (legal review §10 Q1). Use \"Free for haulers and fleets\" and the defined promise.",
    pattern: /\bfree[\s-]+forever\b|\bforever[\s-]+free\b|\bfree[\s-]+for[\s-]+life\b/gi,
    include: isCustomerCopy,
    skipComments: true
  },
  {
    // §6.5 (R6): wiretap claims follow third-party scripts that capture what people type. None is installed at all.
    id: "recording-vendor-package",
    message: "No session replay, chat widget or advertising pixel package may be installed (legal review §6.5, P0 item 12).",
    pattern: new RegExp(`["'](?:${RECORDING_PACKAGE})["']\\s*:`, "g"),
    include: (file) => file === "package.json" || file.endsWith("/package.json")
  },
  {
    id: "recording-vendor-script",
    message:
      "No session replay, chat widget or advertising pixel script may load, and session recording stays off (legal review §6.5, P0 item 12).",
    pattern: new RegExp(
      `(?:from\\s+|import\\(\\s*|require\\(\\s*)["'](?:${RECORDING_PACKAGE})(?:\\/[^"']*)?["']` +
        `|(?:${RECORDING_HOST})` +
        "|\\b(?:fbq|gtag|lintrk|twq|snaptr|pintrk)\\s*\\(" +
        "|\\bttq\\.(?:load|page|track)\\b" +
        "|\\bwindow\\.(?:Intercom|\\$crisp|drift|Tawk_API|zE|hj|FS|LogRocket|clarity|_hsq|dataLayer|fbq|gtag)(?![\\w$])" +
        "|\\b_hjSettings\\b" +
        "|\\breplay(?:Canvas)?Integration\\b|\\breplaysSessionSampleRate\\b|\\breplaysOnErrorSampleRate\\b|\\bSentry\\.Replay\\b" +
        "|\\bstartSessionRecording\\b" +
        "|\\bdisable_session_recording\\b[\"']?\\s*[:=](?!\\s*true\\s*(?:[,})\\n\\r]|$))",
      "g"
    ),
    include: isRuntimeScript,
    skipComments: true
  },
  {
    // §3.3 item 5 (R1). An inquiry is a conversation. A status that records the outcome of the hauling agreement
    // makes LogLoads the record of that agreement. The inquiry list is the one that holds "submitted" with "viewed"
    // or "replied", whatever it is named, in TypeScript or in SQL.
    id: "inquiry-outcome-status",
    message:
      "The inquiry status list must not gain accepted, awarded, assigned, booked or hired (legal review §3.3 item 5). Statuses describe the conversation only.",
    pattern: new RegExp(
      `[\\[(](?=[^\\])]*["']submitted["'])(?=[^\\])]*["'](?:viewed|replied)["'])(?=[^\\])]*["']${OUTCOME_STATUS}["'])[^\\])]*[\\])]`,
      "g"
    ),
    include: isInquiryStatusSource
  }
]

checks.push(...legalChecks)

// A file that must exist and must contain a pattern. The session-recording switch has to be true inside
// ANALYTICS_CAPTURE_POLICY itself: both PostHog entry points spread that object into their config.
const requiredChecks = [
  {
    id: "session-recording-policy",
    file: "apps/web/lib/analytics-pageview.ts",
    message: "ANALYTICS_CAPTURE_POLICY must keep disable_session_recording: true (legal review §6.5, P0 item 12).",
    pattern: /\bANALYTICS_CAPTURE_POLICY\s*=\s*Object\.freeze\(\{(?:(?!\n\}\))[\s\S])*?\bdisable_session_recording:\s*true\s*(?:,|\r?\n)/
  }
]

function extensionOf(path) {
  const index = path.lastIndexOf(".")
  return index === -1 ? "" : path.slice(index)
}

function walk(root, dir = root, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = statSync(path)

    if (stats.isDirectory()) {
      if (!ignoredDirs.has(entry)) {
        walk(root, path, files)
      }
      continue
    }

    const rel = relative(root, path).replaceAll("\\", "/")
    if (
      rel !== "tools/check-guardrails.mjs" &&
      // The rule tests hold a bad sample for every rule, on purpose.
      rel !== "tools/check-guardrails.test.mjs" &&
      !ignoredFiles.has(entry) &&
      textExtensions.has(extensionOf(entry)) &&
      !rel.endsWith(".tsbuildinfo")
    ) {
      files.push(rel)
    }
  }

  return files
}

// A line that is only a comment: `//`, `/*`, a ` * ` continuation, or a JSX `{/*`. The copy rules skip these, because
// a comment may quote the phrase it bans. A comment after code on the same line is still read.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\s*\/\*)/

function lineAt(source, index) {
  const start = source.lastIndexOf("\n", index - 1) + 1
  const end = source.indexOf("\n", index)
  return source.slice(start, end === -1 ? source.length : end)
}

/** Every rule that `source` breaks, as if it were the repository file `file` (forward slashes, from the root). */
export function scanSource(file, source) {
  const failures = []

  for (const check of checks) {
    if (check.include && !check.include(file)) {
      continue
    }

    for (const match of source.matchAll(check.pattern)) {
      if (check.skipComments && COMMENT_LINE.test(lineAt(source, match.index))) {
        continue
      }

      const line = source.slice(0, match.index).split("\n").length
      // Two patterns of one rule can match the same label; report the line once.
      if (check.id && failures.some((failure) => failure.id === check.id && failure.line === line)) {
        continue
      }
      failures.push({ file, id: check.id ?? null, line, message: check.message })
    }
  }

  for (const check of requiredChecks) {
    if (check.file === file && !check.pattern.test(source)) {
      failures.push({ file, id: check.id, line: 1, message: check.message })
    }
  }

  return failures
}

/** Every failure in the repository at `root`. */
export function checkGuardrails({ root = repoRoot } = {}) {
  const failures = []

  for (const file of walk(root)) {
    failures.push(...scanSource(file, readFileSync(join(root, file), "utf8")))
  }

  for (const check of requiredChecks) {
    if (!existsSync(join(root, check.file))) {
      failures.push({ file: check.file, id: check.id, line: 1, message: `${check.message} The file is missing.` })
    }
  }

  return failures
}

export const formatFailure = ({ file, id, line, message }) => `${file}:${line} ${id ? `[${id}] ` : ""}${message}`

function main(args) {
  const rootFlag = args.indexOf("--root")
  const root = rootFlag === -1 ? repoRoot : resolve(args[rootFlag + 1] ?? "")
  const failures = checkGuardrails({ root })

  if (failures.length > 0) {
    console.error("LogLoads guardrails failed:")
    for (const failure of failures) {
      console.error(`- ${formatFailure(failure)}`)
    }
    return 1
  }

  console.log("LogLoads guardrails passed.")
  return 0
}

// Run only as a command, never on import. Both paths are resolved first: through a junction or a symlink, argv[1]
// is the link while import.meta.url is the real path, and a plain comparison would skip main() and exit 0 without
// checking anything.
const realPath = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

if (process.argv[1] && realPath(process.argv[1]) === realPath(scriptPath)) {
  process.exitCode = main(process.argv.slice(2))
}
