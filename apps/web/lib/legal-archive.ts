import type { LegalPageContent } from "./v3-shared"

/**
 * Superseded legal text that people accepted, kept readable at a stable URL
 * (#108, lead-engineer decision LE-13).
 *
 * An archived version is a record, not copy: never edit its text, and never
 * move or reuse its path, because recorded agreements point at it. When the
 * current Terms change again, archive the outgoing version beside this one.
 */
export interface ArchivedLegalVersion {
  /** Stable public path of this exact text. */
  path: string
  /**
   * In-app agreement versions whose acceptance refers to this text. Kept as a
   * literal so client code does not import the contracts package; a unit test
   * pins it to `PERCENTAGE_V1_TERMS_VERSION`.
   */
  agreementVersions: readonly string[]
  /** The date the current Terms replaced this text (the change-notice date). */
  supersededOn: string
  /** Machine-readable form of `supersededOn`. */
  supersededOnIso: string
  /**
   * The legal pages' "Product boundary" summary as it was rendered with this
   * version (`components/v3/PublicPages.tsx` at a50b325). It is not part of the
   * Terms body, but it appeared on the page that was accepted.
   */
  boundarySummary: string
  /** The Terms exactly as published, copied from `apps/web/lib/v3-shared.ts` at a50b325. */
  content: LegalPageContent
}

export const TERMS_2026_08_03_PATH = "/terms/2026-08-03"

/**
 * The Terms of Service effective August 3, 2026, unchanged from #78 (9209c79)
 * through a50b325. This is the text the `percentage-v1-2026-08-03` host
 * agreement linked to as "the current LogLoads Terms".
 */
export const termsOfService20260803: ArchivedLegalVersion = {
  path: TERMS_2026_08_03_PATH,
  agreementVersions: ["percentage-v1-2026-08-03"],
  supersededOn: "November 2, 2026",
  supersededOnIso: "2026-11-02",
  boundarySummary:
    "LogLoads coordinates timber hauling work. Hosts pay LogLoads a 5% platform fee on top of the driver pay stated for each completed load. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.",
  content: {
    slug: "terms",
    title: "Terms of Service",
    intro: "These Terms of Service govern your use of LogLoads. By creating an account or using the service, you agree to them.",
    effectiveDate: "August 3, 2026",
    sections: [
      { title: "What LogLoads is", body: "LogLoads provides software for discovering, coordinating, and recording timber hauling work. LogLoads does not carry freight or receive, escrow, deduct from, or distribute transportation compensation.", points: ["Participants remain responsible for their own regulatory compliance", "Assignments record the coordination terms both sides accepted", "The legally identified carrier, owner-operator, or private-fleet payee is paid directly by the host"] },
      { title: "Host platform fee", body: "For each completed load, the host owes LogLoads a platform fee equal to 5% of the driver pay the host stated for that load. The fee is added to the host's cost and is never deducted from driver pay or carrier compensation. LogLoads bills its own fees monthly in arrears to the host's payment method.", points: ["A $500 load means $500 paid directly to the driver plus a $25 LogLoads fee", "There is no charge to post, subscription, monthly minimum, tier, allowance, or overage rate", "Cancelled, unaccepted, or uncompleted work does not create a platform fee"] },
      { title: "Agreement and payment method", body: "Before publishing live work, an authorized host representative must accept the current percentage agreement and attach a valid payment method. Attaching a card or accepting the agreement does not itself create a charge.", points: ["The accepted terms freeze the fee rate, currency, and billing cadence", "Itemized invoices identify the completed loads that produced each fee", "Billing disputes use audited corrections rather than deleting historical records"] },
      { title: "Your responsibilities", body: "You are responsible for the accuracy of what you publish and for operating safely and lawfully: weight compliance, cargo securement, insurance, permits, operating authority, and road use.", points: ["Do not publish capacity or work that does not exist", "Do not misuse access instructions released to you", "Keep your equipment, insurance, and account details current"] },
      { title: "No guarantees", body: "LogLoads does not guarantee the quality or conduct of any carrier or host, the legality or condition of any route, the accuracy of posted weights, destination acceptance, or that you will be paid for work arranged through coordination on the platform.", points: ["Use your professional judgment on every haul", "Verify field conditions before committing equipment", "Raise problems early through messages, notices, or reports"] },
      { title: "Independent businesses and limits on liability", body: "Every participant is an independent business. Nothing on LogLoads creates an employment, agency, joint-venture, or partnership relationship between you and LogLoads or between you and another participant. Disputes about hauls, payment, damage, or delay are between the participants; we can provide the assignment record but we are not a party to the haul. To the fullest extent the law allows, LogLoads' total liability for any claim related to the service is limited to the platform fees you paid us in the twelve months before the claim, and we are not liable for indirect, incidental, or consequential losses, including lost loads, lost revenue, equipment damage, or downtime.", points: ["Participants contract with each other, not with LogLoads", "Assignment records are available to both sides of a dispute", "Liability is capped at twelve months of LogLoads platform fees"] },
      { title: "Accounts and enforcement", body: "We may suspend or close accounts that violate these terms, the Marketplace Rules, or the Acceptable Use Policy. We may update these terms; continued use after an update is acceptance of the revised terms.", points: ["Material changes are announced in the product", "You may close your account at any time", "Some records are retained after closure as described in the Privacy Policy"] }
    ]
  }
}
