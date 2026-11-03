import {
  marketplaceJobPublicationIssues,
  validateMarketplaceJobDraft,
  type MarketplaceDraftIssue,
  type MarketplaceJobDraft
} from "@logloads/contracts"

/**
 * The V2 authoring form round-trips its draft through the URL (GET form → preview → edit), so no draft
 * is stored anywhere until a real publish exists. Job text is public by design and sensitive access
 * patterns are rejected by validation, so nothing private is placed in the URL.
 *
 * The publish attestations are deliberately NOT draft fields: they are ticked on the preview for one
 * publish request and never carried into an edit link or a redirect, so an edit is never a confirmation.
 */

export const DRAFT_TEXT_FIELDS = [
  "landingId", "title", "product", "productOther", "description", "payUnit", "payAmount", "payNote", "trucksRequested", "trucksPerDay",
  "startsOn", "endsOn", "durationDays", "ongoing", "estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad",
  "destinationLabel", "estOneWayMiles", "publicRoadNotes"
] as const

export type DraftTextField = (typeof DRAFT_TEXT_FIELDS)[number]

export interface DraftFormValues {
  text: Partial<Record<DraftTextField, string>>
  equipment: string[]
}

type QueryRecord = Record<string, string | string[] | undefined>

const MAX_TEXT = 6000
const MAX_EQUIPMENT = 11

export const LANDING_NOT_OWNED = "Choose one of your organization's landings"

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export function draftValuesFromQuery(query: QueryRecord): DraftFormValues {
  const text: Partial<Record<DraftTextField, string>> = {}

  for (const name of DRAFT_TEXT_FIELDS) {
    const value = first(query[name]).slice(0, MAX_TEXT)
    if (value) text[name] = value
  }

  const raw = query.equipment
  const equipment = (Array.isArray(raw) ? raw : raw ? raw.split(",") : []).map((code) => code.trim()).filter(Boolean).slice(0, MAX_EQUIPMENT)

  return { equipment, text }
}

/** The same draft fields from a submitted form (the publish action). Anything else in the form is ignored. */
export function draftValuesFromForm(formData: FormData): DraftFormValues {
  const text: Partial<Record<DraftTextField, string>> = {}

  for (const name of DRAFT_TEXT_FIELDS) {
    const value = formData.get(name)
    if (typeof value === "string" && value) text[name] = value.slice(0, MAX_TEXT)
  }

  const equipment = formData.getAll("equipment")
    .filter((code): code is string => typeof code === "string")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, MAX_EQUIPMENT)

  return { equipment, text }
}

export function hasDraftValues(values: DraftFormValues): boolean {
  return values.equipment.length > 0 || Object.keys(values.text).length > 0
}

/** The values as the input the contract validators take. */
export function draftInput(values: DraftFormValues): Record<string, unknown> {
  return { ...values.text, equipment: values.equipment }
}

export function validateDraftValues(values: DraftFormValues):
  | { ok: true; draft: MarketplaceJobDraft }
  | { ok: false; issues: MarketplaceDraftIssue[] } {
  return validateMarketplaceJobDraft(draftInput(values))
}

/**
 * Everything that stands between these values and publishing, except the attestation (which is given
 * on the preview, per request): the draft rules, the publishing rules, and that the landing is one of
 * the organization's own.
 */
export function draftPublishingIssues(values: DraftFormValues, ownLandings: ReadonlyArray<{ id: string }>): MarketplaceDraftIssue[] {
  const validation = validateDraftValues(values)

  if (!validation.ok) {
    return validation.issues
  }

  const landingIssues = ownLandings.some((landing) => landing.id === validation.draft.landingId)
    ? []
    : [{ field: "landingId", message: LANDING_NOT_OWNED }]

  return [...landingIssues, ...marketplaceJobPublicationIssues(validation.draft)]
}

/** URL query for an edit/preview link carrying the same draft. */
export function draftQueryString(values: DraftFormValues): string {
  const params = new URLSearchParams()

  for (const [name, value] of Object.entries(values.text)) {
    if (value) params.set(name, value)
  }

  for (const code of values.equipment) {
    params.append("equipment", code)
  }

  return params.toString()
}
