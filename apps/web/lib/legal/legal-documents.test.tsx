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
    PublicShell: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "public-shell" }, children)
  }
})

import {
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS,
  MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS,
  MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS,
  marketplacePublishAttestations
} from "@logloads/contracts"

import AcceptableUsePage, { metadata as acceptableUseMetadata } from "@/app/acceptable-use/page"
import MarketplaceRulesPage from "@/app/marketplace-rules/page"
import PostingRulesPage, { metadata as postingRulesMetadata } from "@/app/posting-rules/page"
import PrivacyPage, { metadata as privacyMetadata } from "@/app/privacy/page"
import SmsTermsPage, { metadata as smsTermsMetadata } from "@/app/sms-terms/page"
import TermsPage, { metadata as termsMetadata } from "@/app/terms/page"

import {
  CURRENT_LEGAL_VERSIONS,
  LEGAL_DOCUMENT_IDS,
  legalDocuments,
  type LegalDocument,
  type LegalDocumentId,
  type LegalSection
} from "."

/** React's text escaping, so legal text can be found verbatim in rendered markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

function paragraphs(section: LegalSection): readonly string[] {
  return typeof section.body === "string" ? [section.body] : section.body
}

/** Everything a reader sees in a section, as one string. */
function sectionText(section: LegalSection): string {
  return [
    section.title,
    ...paragraphs(section),
    ...(section.points ?? []),
    section.closing ?? "",
    ...(section.links ?? []).map((link) => link.label),
    section.counsel ?? ""
  ].join(" ")
}

function documentText(document: LegalDocument): string {
  return [document.title, document.intro, document.description, document.changeNotice?.body ?? "", ...document.sections.map(sectionText)].join(" ")
}

function section(document: LegalDocument, title: string): LegalSection {
  const found = document.sections.find((candidate) => candidate.title === title)

  if (!found) throw new Error(`${document.slug} has no section "${title}"`)

  return found
}

const pages: Record<LegalDocumentId, { metadata: { title?: unknown; description?: unknown }; render: () => React.ReactElement }> = {
  "acceptable-use": { metadata: acceptableUseMetadata, render: () => <AcceptableUsePage /> },
  "posting-rules": { metadata: postingRulesMetadata, render: () => <PostingRulesPage /> },
  privacy: { metadata: privacyMetadata, render: () => <PrivacyPage /> },
  "sms-terms": { metadata: smsTermsMetadata, render: () => <SmsTermsPage /> },
  terms: { metadata: termsMetadata, render: () => <TermsPage /> }
}

// Wording that would present a draft as approved by a lawyer (#329: never present the text as counsel-approved).
const COUNSEL_APPROVAL_CLAIM =
  /(?:approved|reviewed|checked|vetted|cleared|signed off|drafted|written) by (?:a |an |our |the |licensed |qualified )*(?:counsel|attorneys?|lawyers?|legal team)|counsel[- ]approved|attorney[- ]approved|legally (?:approved|reviewed)/i

// Retired product vocabulary (legal review §8.0 items 1–2, §3.3 item 6). "dispatcher" is allowed only in the
// Terms' own statement of what LogLoads is not.
const RETIRED_MODEL =
  /\bassign(?:ment|ed)s?\b|coordination terms|paid directly by the host|platform[- ]fees?|Commit through LogLoads|off the record|continued use|coordinat|\bdispatch(?!er)|\btrips?\b|trip events?|route pack|settlement|per completed load|completed-load|\d\s?%|free forever/i

const TERMS_SECTIONS = [
  "1. Who we are and what LogLoads is",
  "2. What LogLoads is not",
  "3. Who can use LogLoads",
  "4. Accepting these Terms and changes to them",
  "5. Posting jobs",
  "6. Rules for haulers and fleets",
  "7. Your own deals",
  "8. Messages, invitations and contact details",
  "9. Verification marks and freshness labels",
  "10. Sponsored placement",
  "11. Plans and billing",
  "12. Acceptable use",
  "13. Your content and our licence",
  "14. Copyright complaints",
  "15. Reports, moderation, suspension and appeals",
  "16. Disclaimers",
  "17. Limit of liability",
  "18. Indemnity",
  "19. Governing law, venue and disputes",
  "20. Electronic communications",
  "21. Ending the agreement",
  "22. Earlier versions",
  "23. General"
]

describe("current legal documents (#329, legal review §8)", () => {
  it("gives every document a version id and an effective date that #338 can register", () => {
    expect([...LEGAL_DOCUMENT_IDS].sort()).toEqual(["acceptable-use", "posting-rules", "privacy", "sms-terms", "terms"])

    for (const id of LEGAL_DOCUMENT_IDS) {
      const document = legalDocuments[id]
      const shownDate = new Date(`${document.effectiveDateIso}T00:00:00Z`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric"
      })

      expect(document.slug).toBe(id)
      expect(document.effectiveDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(document.effectiveDate).toBe(shownDate)
      expect(document.versionId).toBe(`${id}-${document.effectiveDateIso}`)
      expect(document.review).toBe("draft-for-counsel")
      expect(document.description.length).toBeGreaterThan(40)
    }

    expect(CURRENT_LEGAL_VERSIONS).toEqual(
      LEGAL_DOCUMENT_IDS.map((id) => ({
        documentId: id,
        effectiveDate: legalDocuments[id].effectiveDateIso,
        path: `/${id}`,
        versionId: legalDocuments[id].versionId
      }))
    )
    expect(new Set(CURRENT_LEGAL_VERSIONS.map((version) => version.versionId)).size).toBe(LEGAL_DOCUMENT_IDS.length)
  })

  it.each(LEGAL_DOCUMENT_IDS)("renders /%s as a dated, versioned draft for counsel, never as approved", (id) => {
    const document = legalDocuments[id]
    const html = renderToStaticMarkup(pages[id].render())

    expect(html).toContain(`<h1>${escapeHtml(document.title)}</h1>`)
    expect(html).toContain(
      `Effective <time dateTime="${document.effectiveDateIso}">${document.effectiveDate}</time> · <span class="legal-version">Version ${document.versionId}</span>`
    )
    expect(html).toContain('<aside aria-label="Draft status" class="legal-notice">')
    expect(html).toContain("<strong>Draft for counsel review</strong>")
    expect(html).toContain("A licensed attorney has not reviewed it yet")
    expect(html).not.toMatch(COUNSEL_APPROVAL_CLAIM)
    expect(documentText(document)).not.toMatch(COUNSEL_APPROVAL_CLAIM)
    // The old shared "Product boundary" box said LogLoads "coordinates timber hauling work" on every legal page.
    expect(html).not.toContain("Product boundary")

    for (const entry of document.sections) {
      expect(html).toContain(`<h2>${escapeHtml(entry.title)}</h2>`)
      for (const paragraph of paragraphs(entry)) {
        expect(html).toContain(`<p>${escapeHtml(paragraph)}</p>`)
      }
      for (const point of entry.points ?? []) {
        expect(html).toContain(`<li>${escapeHtml(point)}</li>`)
      }
      if (entry.closing) {
        // After the list, in reading order.
        expect(html).toContain(`</ul><p>${escapeHtml(entry.closing)}</p>`)
      }
      for (const link of entry.links ?? []) {
        expect(html).toContain(`href="${link.href}"`)
      }
      if (entry.counsel) {
        expect(html).toContain(
          `<p class="legal-counsel"><strong>For counsel:</strong> ${escapeHtml(entry.counsel)}</p>`
        )
      }
    }

    expect(pages[id].metadata.title).toBe(document.title)
    expect(pages[id].metadata.description).toBe(document.description)
  })

  it.each(LEGAL_DOCUMENT_IDS)("keeps the retired dispatch and fee vocabulary out of /%s", (id) => {
    const document = legalDocuments[id]
    const text = documentText(document)

    if (id === "terms") {
      expect(text.replace("motor carrier, broker, freight forwarder or dispatcher", "")).not.toMatch(RETIRED_MODEL)
    } else {
      expect(text).not.toMatch(RETIRED_MODEL)
    }
  })

  it("replaces the page descriptions that promised coordination and driver location", () => {
    expect(String(termsMetadata.description)).not.toMatch(/safe timber hauling coordination|driver pay|coordinat/i)
    expect(String(privacyMetadata.description)).not.toMatch(/driver location|location/i)
  })
})

describe("Terms of Service (legal review §8.1)", () => {
  const terms = legalDocuments.terms

  it("follows the 23-section outline", () => {
    expect(terms.sections.map((entry) => entry.title)).toEqual(TERMS_SECTIONS)
  })

  it("says what LogLoads is not, and that each user carries its own authority and insurance (§3.3 item 10)", () => {
    const text = sectionText(section(terms, "2. What LogLoads is not"))

    expect(text).toContain(
      "LogLoads is not a motor carrier, broker, freight forwarder or dispatcher, and it is not the employer or agent of any user."
    )
    expect(text).toContain(
      "LogLoads does not arrange transportation, select carriers, negotiate for either side, set rates, handle freight money or become a party to any hauling agreement."
    )
    expect(text).toContain("Each user is responsible for its own operating authority, insurance, permits, licences")
    expect(section(terms, "2. What LogLoads is not").counsel).toMatch(/transportation attorney/i)
  })

  it("is accepted by an unticked box, with 30 days' notice and a new acceptance for a material change", () => {
    const text = sectionText(section(terms, "4. Accepting these Terms and changes to them"))

    expect(text).toContain("The box is never ticked for you.")
    expect(text).toContain("version id and an effective date")
    expect(text).toContain("by email and in LogLoads at least 30 days before it takes effect")
    expect(text).toContain("the next time you sign in")
    expect(text).toContain("Using LogLoads without accepting a new version does not count as accepting it.")
    expect(JSON.stringify(terms)).not.toMatch(/continued use/i)
  })

  it("incorporates the Posting Rules and links them", () => {
    const posting = section(terms, "5. Posting jobs")

    expect(posting.links).toEqual([{ href: "/posting-rules", label: "Read the Posting Rules" }])
    expect(sectionText(posting)).toContain("the Posting Rules are part of these Terms")
    expect(sectionText(posting)).toContain("jobs recruiting employee drivers")
  })

  it("limits contact details, invitations and staff reads of messages (sections 8 and 12, §6.5)", () => {
    const messages = sectionText(section(terms, "8. Messages, invitations and contact details"))
    const acceptableUse = sectionText(section(terms, "12. Acceptable use"))

    expect(messages).toContain("only to discuss the job in question")
    expect(messages).toContain("Do not collect, scrape, copy, sell or republish other users' contact details")
    expect(messages).toContain("only after the landing replies to that hauler's interest, and only if the landing has chosen to share it")
    expect(messages).toContain("Targeted invitations go only to haulers who have chosen to receive them, and the landing chooses every hauler it invites.")
    expect(messages).toContain("Authorized LogLoads staff can read messages when a report, a fraud or abuse check, or the law requires it. Each such read is logged.")
    expect(acceptableUse).toMatch(/bots, scrapers or other automated tools/)
    expect(acceptableUse).toMatch(/limit, a hold or a suspension/)
  })

  it("states what a verification mark does not cover (§7.3 item 9)", () => {
    const marks = section(terms, "9. Verification marks and freshness labels")

    expect(sectionText(marks)).toContain(
      "LogLoads does not check insurance, operating authority, licences, safety records, equipment condition or anyone's ability to do the work."
    )
    expect(sectionText(marks)).toContain("A profile without a mark has simply not been reviewed yet.")
    expect(marks.counsel).toBeTruthy()
  })

  it("names the copyright route and leaves the agent's designation to counsel (section 14)", () => {
    const copyright = section(terms, "14. Copyright complaints")

    expect(sectionText(copyright)).toContain("copyright agent")
    expect(sectionText(copyright)).toContain("17 U.S.C. 512(c)(3)")
    expect(sectionText(copyright)).toContain("repeatedly infringe")
    expect(copyright.counsel).toMatch(/Copyright Office/)
  })

  it("caps liability at the greater of 12 months of fees or a floor counsel sets, and types no other dollar amount", () => {
    const liability = section(terms, "17. Limit of liability")

    expect(sectionText(liability)).toContain(
      "is limited to the greater of the amount you paid LogLoads in the 12 months before the claim arose and $100"
    )
    expect(liability.counsel).toMatch(/floor/)
    expect(liability.counsel).toMatch(/carve-outs/)
    for (const entry of terms.sections.filter((candidate) => candidate !== liability)) {
      expect(sectionText(entry), entry.title).not.toMatch(/\$\s?\d/)
    }
  })

  it("leaves the governing law and any arbitration to counsel", () => {
    const disputes = section(terms, "19. Governing law, venue and disputes")

    expect(sectionText(disputes)).toContain("have not been chosen yet")
    expect(disputes.counsel).toMatch(/arbitration/)
  })

  it("replaces the August 3, 2026 Terms, accrues nothing new under them, and keeps both earlier versions readable", () => {
    const earlier = section(terms, "22. Earlier versions")

    expect(sectionText(earlier)).toContain(
      "These Terms replace the Terms of Service effective August 3, 2026, including the version changed on November 2, 2026, from November 18, 2026."
    )
    expect(sectionText(earlier)).toContain("Nothing new accrues under an earlier version after that date")
    expect(earlier.links).toEqual([
      { href: "/terms/2026-11-02", label: "Terms of Service as changed on November 2, 2026" },
      { href: "/terms/2026-08-03", label: "Terms of Service effective August 3, 2026" }
    ])
    expect(terms.changeNotice).toMatchObject({ date: "November 18, 2026", dateTime: "2026-11-18" })
    expect(earlier.counsel).toBeTruthy()
  })

  it("promises haulers their core features stay free, in the defined words, not free forever (§10 Q1)", () => {
    const billing = sectionText(section(terms, "11. Plans and billing"))

    expect(billing).toContain("Billing is not open.")
    expect(billing).toContain("For haulers and fleets, finding work, listing trucks and messaging landings will not cost anything.")
    expect(section(terms, "11. Plans and billing").counsel).toMatch(/billing terms/)
  })
})

describe("Privacy Policy (legal review §6.2, §8.2)", () => {
  const privacy = legalDocuments.privacy
  const text = documentText(privacy)

  it("drops what the product no longer does", () => {
    expect(text).not.toMatch(/trip events?|driver location|route instructions|fee records|platform-fee|fee collections/i)
    expect(text).not.toMatch(/Stripe processes host payment methods/i)
  })

  it("splits the billing records into the ended program and a billing that is not open", () => {
    const earlier = sectionText(section(privacy, "Earlier programs"))

    expect(earlier).toContain("Until November 2, 2026")
    expect(earlier).toContain("That program has ended.")
    expect(earlier).toContain("Billing is not open now.")
    expect(earlier).toContain("Stripe will process the payments")
    expect(section(privacy, "Earlier programs").counsel).toMatch(/retention/i)
  })

  it("covers what the product does today: public listings, staff reads, verification evidence, maps, weather and texts", () => {
    expect(sectionText(section(privacy, "What is public and what stays private"))).toContain(
      "Shown to other users, and to anyone with a link to it: a hauler profile its business chooses to publish"
    )
    expect(sectionText(section(privacy, "Staff access to messages"))).toContain("Each such read is logged.")
    expect(sectionText(section(privacy, "What we collect"))).toContain("Verification evidence")
    expect(sectionText(section(privacy, "Text messages"))).toContain("LogLoads does not send text messages yet.")

    const providers = sectionText(section(privacy, "Our providers"))

    for (const provider of ["Clerk", "Supabase", "Vercel", "Resend", "PostHog", "Sentry", "CARTO", "OpenStreetMap", "Open-Meteo", "Stripe"]) {
      expect(providers).toContain(provider)
    }
    expect(providers).toContain("Your browser loads map tiles straight from CARTO, so CARTO receives your IP address and the map area you view.")
    expect(section(privacy, "Our providers").counsel).toBeTruthy()
  })

  it("carries the carrier SMS sentence and the email-address notice word for word (§8.2 items 7 and 10)", () => {
    expect(sectionText(section(privacy, "Text messages"))).toContain(
      "Mobile numbers and SMS consent are not shared with third parties for their marketing."
    )
    expect(sectionText(section(privacy, "Email addresses are not for sale"))).toContain(
      "LogLoads will not give, sell or otherwise transfer the email addresses it holds to any other party for that party to send, or help others send, email."
    )
    expect(sectionText(section(privacy, "Who we share information with"))).toContain(
      "We do not sell personal information, and we do not share it for cross-context advertising."
    )
  })

  it("states the retention schedule from §6.4, with the periods counsel confirms marked", () => {
    const retention = section(privacy, "How long we keep information")
    const retentionText = sectionText(retention)

    expect(retentionText).toContain(
      `Verification documents: ${MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS} days after the review decision.`
    )
    for (const period of ["30 days after you ask us to delete it", "24 months", "plus 90 days", "plus 12 months", "13 months", "5 years after the last text", "plus 4 years", "plus 6 years", "3 years", "25 months", "12 months", "35 days"]) {
      expect(retentionText).toContain(period)
    }
    expect(retention.counsel).toMatch(/6 years/)
  })

  it("gives the request path, the 45-day answer, adults only, and the share-link and cache warning", () => {
    const rights = sectionText(section(privacy, "Your choices and rights"))

    expect(rights).toContain("support@logloads.com")
    expect(rights).toContain("within 45 days")
    expect(rights).toContain("Do Not Track and Global Privacy Control")
    expect(sectionText(section(privacy, "Children"))).toContain("18 or older")
    expect(sectionText(section(privacy, "What is public and what stays private"))).toContain(
      "a search engine may still show a cached copy for a while"
    )
  })
})

describe("Posting Rules (legal review §8.1 section 5, §9.4)", () => {
  const rules = legalDocuments["posting-rules"]
  const text = documentText(rules)

  it("requires real, current jobs of the poster's own, with pay and its basis, and timber hauling only", () => {
    expect(text).toContain("Every job must be real, current and your own")
    expect(text).toContain("No bait jobs")
    expect(text).toContain("No duplicate jobs")
    expect(text).toContain("Every job must say what it pays and on what basis")
    expect(text).toContain("Post only timber-hauling work")
  })

  it("excludes recruiting employee (W-2) drivers until that is reviewed (P0 item 16)", () => {
    const employees = sectionText(section(rules, "No employee driver jobs"))

    expect(employees).toContain("Do not post a job to hire an employee driver, such as a W-2 driver position, or for any other employment.")
    expect(employees).toContain("until the law on employment advertising has been reviewed for LogLoads")
  })

  it("incorporates the exact publish attestation (ATT-2) and the reconfirm statement", () => {
    const confirm = section(rules, "Confirm what you publish")

    expect(confirm.points).toEqual(marketplacePublishAttestations("[landing name]").map((attestation) => attestation.label))
    expect(sectionText(confirm)).toContain("Publishing is subject to these Posting Rules.")
    expect(sectionText(section(rules, "Reconfirm on schedule"))).toContain(`“${MARKETPLACE_AVAILABILITY_ATTESTATION.label}”`)
  })

  it("states the reconfirmation schedule the store enforces", () => {
    const schedule = sectionText(section(rules, "Reconfirm on schedule"))

    expect(schedule).toContain(`on day ${MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS} after your last confirmation`)
    expect(schedule).toContain(`From day ${MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS}`)
    expect(schedule).toContain(`After ${MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS} days without a confirmation`)
  })
})

describe("SMS Terms (legal review §4.4 item 8, §8.1)", () => {
  const sms = legalDocuments["sms-terms"]
  const text = documentText(sms)

  it("names the program, the frequency, the rates line, STOP and HELP, carrier liability and a support contact", () => {
    expect(text).toContain("The program is LogLoads Alerts")
    expect(text).toContain("Message frequency varies")
    expect(text).toContain("Msg & data rates may apply.")
    for (const word of ["STOP", "QUIT", "END", "REVOKE", "OPT OUT", "CANCEL", "UNSUBSCRIBE"]) {
      expect(text).toContain(word)
    }
    expect(text).toContain("Reply HELP for help.")
    expect(text).toContain("Mobile carriers are not liable for delayed or undelivered messages.")
    expect(text).toContain("support@logloads.com")
    expect(text).toContain("Mobile numbers and SMS consent are not shared with third parties for their marketing.")
    expect(text).toContain("agreeing is not a condition of using LogLoads")
    expect(text).toContain("LogLoads does not send text messages yet.")
  })

  it("leaves the consent wording and state duties to counsel before the first text", () => {
    expect(sms.sections.some((entry) => /consent wording/.test(entry.counsel ?? ""))).toBe(true)
  })
})

describe("/marketplace-rules", () => {
  it("redirects permanently to the Posting Rules that replace it", () => {
    let thrown: unknown

    try {
      MarketplaceRulesPage()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/posting-rules;308;/)
  })
})
