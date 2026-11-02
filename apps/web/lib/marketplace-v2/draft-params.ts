import { validateMarketplaceJobDraft, type MarketplaceDraftIssue, type MarketplaceJobDraft } from "@logloads/contracts"

/**
 * The V2 authoring form round-trips its draft through the URL (GET form → preview → edit), so no draft
 * is stored anywhere until a real publish exists. Job text is public by design and sensitive access
 * patterns are rejected by validation, so nothing private is placed in the URL.
 */

export const DRAFT_TEXT_FIELDS = [
  "landingId", "title", "product", "description", "payUnit", "payAmount", "payNote", "trucksRequested", "trucksPerDay",
  "startsOn", "durationDays", "estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad", "destinationLabel",
  "estOneWayMiles", "publicRoadNotes"
] as const

export type DraftTextField = (typeof DRAFT_TEXT_FIELDS)[number]

export interface DraftFormValues {
  text: Partial<Record<DraftTextField, string>>
  equipment: string[]
}

type QueryRecord = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export function draftValuesFromQuery(query: QueryRecord): DraftFormValues {
  const text: Partial<Record<DraftTextField, string>> = {}

  for (const name of DRAFT_TEXT_FIELDS) {
    const value = first(query[name]).slice(0, 6000)
    if (value) text[name] = value
  }

  const raw = query.equipment
  const equipment = (Array.isArray(raw) ? raw : raw ? raw.split(",") : []).map((code) => code.trim()).filter(Boolean).slice(0, 11)

  return { equipment, text }
}

export function hasDraftValues(values: DraftFormValues): boolean {
  return values.equipment.length > 0 || Object.keys(values.text).length > 0
}

export function validateDraftValues(values: DraftFormValues):
  | { ok: true; draft: MarketplaceJobDraft }
  | { ok: false; issues: MarketplaceDraftIssue[] } {
  return validateMarketplaceJobDraft({ ...values.text, equipment: values.equipment })
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
