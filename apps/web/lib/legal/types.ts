/**
 * Shapes for LogLoads' legal pages (#329).
 *
 * A current document is versioned text: change any word and you publish a new version, with a new version id and
 * effective date, because acceptance records (#338) point at a version id, not at "the current Terms".
 */

export interface LegalLink {
  href: string
  label: string
}

/** A dated notice that a legal page changed, shown above its sections. */
export interface LegalChangeNotice {
  date: string
  /** ISO form of `date`, for the `<time>` element. */
  dateTime: string
  body: string
  /** Where the replaced text can still be read. */
  link: {
    lead: string
    href: string
    label: string
  }
}

export interface LegalSection {
  title: string
  /** One paragraph, or several in reading order. */
  body: string | readonly string[]
  points?: readonly string[]
  /** A paragraph that follows the points. */
  closing?: string
  /** Related pages, listed after the text. */
  links?: readonly LegalLink[]
  /**
   * A point the #293 legal review says licensed counsel must confirm. It is shown on the page, labelled
   * "For counsel", so the draft never reads as settled.
   */
  counsel?: string
}

export interface LegalPageContent {
  slug: string
  title: string
  intro: string
  effectiveDate: string
  changeNotice?: LegalChangeNotice
  sections: readonly LegalSection[]
}

export const LEGAL_DOCUMENT_IDS = ["terms", "privacy", "posting-rules", "acceptable-use", "sms-terms"] as const
export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number]

export interface LegalDocument extends LegalPageContent {
  /** The document id, which is also its path: `/${slug}`. */
  slug: LegalDocumentId
  /** `${slug}-${effectiveDateIso}`; what an acceptance record stores. */
  versionId: string
  /** Machine-readable form of `effectiveDate`. */
  effectiveDateIso: string
  /**
   * Every current document is agent-written from the #293 review and stays a draft for counsel until a licensed
   * attorney signs it off. There is deliberately no other value yet: marking a document reviewed is a code change
   * that someone has to make on purpose.
   */
  review: "draft-for-counsel"
  /** The search and link-preview description. */
  description: string
}

/** One row a legal document registry (#338) can register. */
export interface LegalDocumentVersion {
  documentId: LegalDocumentId
  versionId: string
  /** ISO date. */
  effectiveDate: string
  path: string
}
