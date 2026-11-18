import type { Metadata } from "next"

import { acceptableUsePolicy } from "./acceptable-use"
import { postingRules } from "./posting-rules"
import { privacyPolicy } from "./privacy"
import { smsTerms } from "./sms-terms"
import { termsOfService } from "./terms"
import {
  LEGAL_DOCUMENT_IDS,
  type LegalDocument,
  type LegalDocumentId,
  type LegalDocumentVersion
} from "./types"

export * from "./types"

/**
 * LogLoads' current legal documents (#329), one per public page at `/${slug}`. The text moved here from
 * `legalPages` in `lib/v3-shared.ts`. Superseded text people accepted lives in `lib/legal-archive.ts`.
 */
export const legalDocuments: Readonly<Record<LegalDocumentId, LegalDocument>> = Object.freeze({
  "acceptable-use": acceptableUsePolicy,
  "posting-rules": postingRules,
  privacy: privacyPolicy,
  "sms-terms": smsTerms,
  terms: termsOfService
})

/**
 * The version of each current document, for the legal document registry and acceptance records of #338. An
 * acceptance stores a `versionId` from this list, never "the current Terms".
 */
export const CURRENT_LEGAL_VERSIONS: readonly LegalDocumentVersion[] = Object.freeze(
  LEGAL_DOCUMENT_IDS.map((id) => ({
    documentId: id,
    effectiveDate: legalDocuments[id].effectiveDateIso,
    path: `/${id}`,
    versionId: legalDocuments[id].versionId
  }))
)

/** The page metadata for a current legal document. */
export function legalMetadata(document: LegalDocument): Metadata {
  return { description: document.description, title: document.title }
}

/** True when any section carries a point that licensed counsel must still confirm. */
export function hasCounselNotes(document: LegalDocument): boolean {
  return document.sections.some((section) => Boolean(section.counsel))
}
