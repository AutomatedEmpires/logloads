import { createHash } from "node:crypto"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)
vi.mock("server-only", () => ({}))
vi.mock("@/components/v3/Shells", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/v3/Shells")>()
  const ReactModule = await import("react")

  return {
    ...original,
    AppShell: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "app-shell" }, children),
    PublicShell: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "public-shell" }, children)
  }
})

import { PERCENTAGE_V1_TERMS_VERSION } from "@logloads/contracts"

import ArchivedTermsPage, { metadata as archivedTermsMetadata } from "@/app/terms/2026-08-03/page"
import ArchivedNovemberTermsPage, { metadata as archivedNovemberTermsMetadata } from "@/app/terms/2026-11-02/page"
import TermsPage from "@/app/terms/page"
import { BillingPage, type ShellAccount } from "@/components/v3"

import { buildHostBillingView } from "./host-billing-data"
import { legalDocuments } from "./legal"
import {
  TERMS_2026_08_03_PATH,
  TERMS_2026_11_02_PATH,
  termsOfService20260803,
  termsOfService20261102
} from "./legal-archive"

/** React's text escaping, so verbatim legal text can be found in rendered markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

// Copied from apps/web/lib/v3-shared.ts at a50b325 (unchanged since #78,
// 9209c79, 2026-08-03). These are the sections commit 816ef25 removed from the
// current Terms; the archive must keep them word for word.
const RETIRED_SECTIONS = [
  {
    title: "Host platform fee",
    body: "For each completed load, the host owes LogLoads a platform fee equal to 5% of the driver pay the host stated for that load. The fee is added to the host's cost and is never deducted from driver pay or carrier compensation. LogLoads bills its own fees monthly in arrears to the host's payment method.",
    points: [
      "A $500 load means $500 paid directly to the driver plus a $25 LogLoads fee",
      "There is no charge to post, subscription, monthly minimum, tier, allowance, or overage rate",
      "Cancelled, unaccepted, or uncompleted work does not create a platform fee"
    ]
  },
  {
    title: "Agreement and payment method",
    body: "Before publishing live work, an authorized host representative must accept the current percentage agreement and attach a valid payment method. Attaching a card or accepting the agreement does not itself create a charge.",
    points: [
      "The accepted terms freeze the fee rate, currency, and billing cadence",
      "Itemized invoices identify the completed loads that produced each fee",
      "Billing disputes use audited corrections rather than deleting historical records"
    ]
  }
] as const
const RETIRED_SECTION_TITLES: readonly string[] = RETIRED_SECTIONS.map((section) => section.title)

// SHA-256 of JSON.stringify(legalPages.terms) at a50b325. An archived version
// is a record: if this changes, the archive no longer shows what was accepted.
const TERMS_2026_08_03_CONTENT_SHA256 =
  "8af0d38d0be3fb7fb0f082db4272b9d8716caeadf02550b142536b7418e0e491"

// SHA-256 of JSON.stringify(legalPages.terms) at 7448e3e, the last commit that published this text at /terms
// (#329 replaced it). Computed from `git show 7448e3e:apps/web/lib/v3-shared.ts`, not from the archive itself.
const TERMS_2026_11_02_CONTENT_SHA256 =
  "50172e9533a0fd725dd108030332d943aac2a34886df3f6565c963f00a4f8611"

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

describe("Terms of Service archived for agreements accepted under them (LE-13)", () => {
  it("keeps the August 3, 2026 Terms byte-for-byte at a stable URL", () => {
    const { content } = termsOfService20260803

    expect(termsOfService20260803.path).toBe("/terms/2026-08-03")
    expect(TERMS_2026_08_03_PATH).toBe("/terms/2026-08-03")
    expect(termsOfService20260803.agreementVersions).toEqual([PERCENTAGE_V1_TERMS_VERSION])
    expect(content.effectiveDate).toBe("August 3, 2026")
    expect(content).not.toHaveProperty("changeNotice")
    expect(sha256(content)).toBe(TERMS_2026_08_03_CONTENT_SHA256)
    expect(content.sections.map((section) => section.title)).toEqual([
      "What LogLoads is",
      "Host platform fee",
      "Agreement and payment method",
      "Your responsibilities",
      "No guarantees",
      "Independent businesses and limits on liability",
      "Accounts and enforcement"
    ])
    for (const retired of RETIRED_SECTIONS) {
      expect(content.sections.find((section) => section.title === retired.title)).toEqual(retired)
    }
  })

  it("keeps the Terms as changed on November 2, 2026 byte-for-byte, beside the August 3 version", () => {
    const { content: august } = termsOfService20260803
    const { content: november } = termsOfService20261102

    expect(termsOfService20261102.path).toBe("/terms/2026-11-02")
    expect(TERMS_2026_11_02_PATH).toBe("/terms/2026-11-02")
    // Nobody accepted this text through a host fee agreement; sign-up accepted "the Terms" while it was current.
    expect(termsOfService20261102.agreementVersions).toEqual([])
    expect(termsOfService20261102.supersededOnIso).toBe(legalDocuments.terms.effectiveDateIso)
    expect(termsOfService20261102.supersededOn).toBe(legalDocuments.terms.effectiveDate)
    expect(sha256(november)).toBe(TERMS_2026_11_02_CONTENT_SHA256)

    // What the November 2 change was: the August 3 text minus its two fee sections, under a dated notice.
    expect(november.slug).toBe(august.slug)
    expect(november.title).toBe(august.title)
    expect(november.intro).toBe(august.intro)
    expect(november.effectiveDate).toBe(august.effectiveDate)
    expect(november.sections).toEqual(
      august.sections.filter((section) => !RETIRED_SECTION_TITLES.includes(section.title))
    )
    expect(november.changeNotice).toMatchObject({
      date: "November 2, 2026",
      dateTime: "2026-11-02",
      link: { href: TERMS_2026_08_03_PATH }
    })
  })

  it("renders the archived page with the verbatim fee sections, a superseded label, and noindex", () => {
    const html = renderToStaticMarkup(<ArchivedTermsPage />)
    const { content } = termsOfService20260803

    expect(html).toContain(
      "<h1>Terms of Service — archived version effective August 3, 2026</h1>"
    )
    expect(html).toContain(
      "<strong>Superseded — kept for agreements accepted under this version</strong>"
    )
    expect(html).toContain('<time dateTime="2026-11-02">November 2, 2026</time>')
    expect(html).toContain(
      "Host agreements recorded as version percentage-v1-2026-08-03 refer to this text."
    )
    expect(html).toContain('<a href="/terms">Read the current Terms of Service</a>')
    expect(html).toContain('<p class="legal-effective">Effective August 3, 2026</p>')
    expect(html).toContain(escapeHtml(content.intro))
    expect(html).toContain(
      escapeHtml(
        "LogLoads coordinates timber hauling work. Hosts pay LogLoads a 5% platform fee on top of the driver pay stated for each completed load. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation."
      )
    )
    for (const section of content.sections) {
      expect(html).toContain(`<h2>${escapeHtml(section.title)}</h2>`)
      expect(html).toContain(`<p>${escapeHtml(section.body)}</p>`)
      for (const point of section.points) {
        expect(html).toContain(`<li>${escapeHtml(point)}</li>`)
      }
    }
    expect(archivedTermsMetadata.robots).toEqual({ follow: true, index: false })
    expect(String(archivedTermsMetadata.title)).toContain("archived version effective August 3, 2026")
  })

  it("renders the November 2 Terms as they were published, with their change notice, a superseded label, and noindex", () => {
    const html = renderToStaticMarkup(<ArchivedNovemberTermsPage />)
    const { content } = termsOfService20261102

    expect(html).toContain(
      "<h1>Terms of Service — archived version as changed on November 2, 2026</h1>"
    )
    expect(html).toContain(
      "The text below is the LogLoads Terms of Service as changed on November 2, 2026, published unchanged."
    )
    expect(html).toContain(
      "<strong>Superseded — kept for agreements accepted under this version</strong>"
    )
    expect(html).toContain('<time dateTime="2026-11-18">November 18, 2026</time>')
    // No host fee agreement refers to this text, so the page names none.
    expect(html).not.toContain("Host agreements recorded as version")
    expect(html).toContain('<a href="/terms">Read the current Terms of Service</a>')
    // The change notice it carried, verbatim, still pointing at the August 3 archive.
    expect(html).toContain(
      '<strong>Change notice · <time dateTime="2026-11-02">November 2, 2026</time></strong>'
    )
    expect(html).toContain(
      'For agreements accepted under the earlier version, read the <a href="/terms/2026-08-03">archived Terms of Service effective August 3, 2026</a>.'
    )
    expect(html).toContain('<p class="legal-effective">Effective August 3, 2026</p>')
    expect(html).toContain(escapeHtml(content.intro))
    expect(html).toContain(
      escapeHtml(
        "LogLoads coordinates timber hauling work. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation."
      )
    )
    for (const section of content.sections) {
      expect(html).toContain(`<h2>${escapeHtml(section.title)}</h2>`)
      expect(html).toContain(`<p>${escapeHtml(section.body as string)}</p>`)
      for (const point of section.points ?? []) {
        expect(html).toContain(`<li>${escapeHtml(point)}</li>`)
      }
    }
    for (const title of RETIRED_SECTION_TITLES) {
      expect(html).not.toContain(`<h2>${title}</h2>`)
    }
    expect(archivedNovemberTermsMetadata.robots).toEqual({ follow: true, index: false })
    expect(String(archivedNovemberTermsMetadata.title)).toContain(
      "archived version as changed on November 2, 2026"
    )
  })

  it("keeps the fee sections off the current Terms and links both archives from a dated change notice", () => {
    const html = renderToStaticMarkup(<TermsPage />)

    for (const title of RETIRED_SECTION_TITLES) {
      expect(html).not.toContain(`<h2>${title}</h2>`)
    }
    expect(html).not.toMatch(/\d\s?%|monthly in arrears|percentage agreement/i)
    // The only dollar figure is the liability floor that counsel sets (§10 Q2), in the clause and its counsel note.
    expect(new Set(html.match(/\$\s?\d+/g))).toEqual(new Set(["$100"]))
    expect(html).toContain('<aside aria-label="Change notice" class="legal-notice">')
    expect(html).toContain(
      '<strong>Change notice · <time dateTime="2026-11-18">November 18, 2026</time></strong>'
    )
    expect(html).toContain(
      'Earlier versions stay readable, starting with the <a href="/terms/2026-11-02">Terms of Service as changed on November 2, 2026</a>.'
    )
    expect(html).toContain('href="/terms/2026-08-03"')
  })

  it("offers no in-app acceptance and links a historical agreement to the archived Terms", () => {
    const hostBilling = buildHostBillingView(
      {
        hostBillingProfiles: [],
        hostInvoices: [],
        loadPostings: [],
        organizationBillingAccounts: [
          {
            activationState: "percentage_active",
            billingModel: "percentage_v1",
            organizationId: "33333333-3333-4333-8333-333333333331",
            percentageTermsSnapshot: {
              acceptedAt: "2026-08-03T00:00:00.000Z",
              acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION
            },
            subscriptionId: null
          }
        ],
        platformFeeEvents: []
      },
      "33333333-3333-4333-8333-333333333331",
      "2026-07-15T12:00:00.000Z",
      { canManageBilling: true }
    )

    // The percentage fee is retired: the view has no acceptance control at all.
    expect(hostBilling.percentageAgreement).not.toHaveProperty("canAccept")

    const html = renderToStaticMarkup(
      <BillingPage
        account={{} as ShellAccount}
        billing={{ plans: [], usage: [] }}
        canManageBilling
        hostBilling={hostBilling}
        hostSubscriptionBilling={null}
        role="host"
      />
    )

    expect(html).not.toContain("I am authorized to accept")
    expect(html).not.toContain("Accept 5% host agreement")
    // The agreement this host accepted still links the Terms that version
    // accepted, archived at a stable URL, not whatever /terms says today (LE-13).
    expect(html).toContain(
      'kept as a record under the <a href="/terms/2026-08-03">LogLoads Terms effective August 3, 2026</a>'
    )
    expect(html).not.toContain('href="/terms"')
  })
})
