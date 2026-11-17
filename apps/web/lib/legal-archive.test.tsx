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
import TermsPage from "@/app/terms/page"
import { BillingPage, type ShellAccount } from "@/components/v3"

import { buildHostBillingView } from "./host-billing-data"
import { TERMS_2026_08_03_PATH, termsOfService20260803 } from "./legal-archive"
import { legalPages } from "./v3-shared"

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

describe("Terms of Service archived for agreements accepted under them (LE-13)", () => {
  it("keeps the August 3, 2026 Terms byte-for-byte at a stable URL", () => {
    const { content } = termsOfService20260803

    expect(termsOfService20260803.path).toBe("/terms/2026-08-03")
    expect(TERMS_2026_08_03_PATH).toBe("/terms/2026-08-03")
    expect(termsOfService20260803.agreementVersions).toEqual([PERCENTAGE_V1_TERMS_VERSION])
    expect(content.effectiveDate).toBe("August 3, 2026")
    expect(content).not.toHaveProperty("changeNotice")
    expect(createHash("sha256").update(JSON.stringify(content)).digest("hex")).toBe(
      TERMS_2026_08_03_CONTENT_SHA256
    )
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

  it("differs from the current Terms only by the two retired fee sections", () => {
    const { content: archived } = termsOfService20260803
    const current = legalPages["terms"]!

    expect(current.slug).toBe(archived.slug)
    expect(current.title).toBe(archived.title)
    expect(current.intro).toBe(archived.intro)
    expect(current.effectiveDate).toBe(archived.effectiveDate)
    expect(current.sections).toEqual(
      archived.sections.filter((section) => !RETIRED_SECTION_TITLES.includes(section.title))
    )
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

  it("keeps the fee sections off the current Terms and links the archive from a dated change notice", () => {
    const html = renderToStaticMarkup(<TermsPage />)

    for (const title of RETIRED_SECTION_TITLES) {
      expect(html).not.toContain(`<h2>${title}</h2>`)
    }
    expect(html).not.toMatch(/\d\s?%|\$\s?\d|monthly in arrears|percentage agreement/i)
    expect(html).toContain('<aside aria-label="Change notice" class="legal-notice">')
    expect(html).toContain(
      '<strong>Change notice · <time dateTime="2026-11-02">November 2, 2026</time></strong>'
    )
    expect(html).toContain(
      "sections were removed from these Terms because the per-load fee model was retired."
    )
    expect(html).toContain(
      'For agreements accepted under the earlier version, read the <a href="/terms/2026-08-03">archived Terms of Service effective August 3, 2026</a>.'
    )
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
