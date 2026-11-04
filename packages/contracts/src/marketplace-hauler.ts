import { z } from "zod"

import type { MarketplaceVerification } from "./marketplace-v2"

/**
 * Marketplace V2: the hauling business's own profile (UX 02 §A3, §5.1; #125). Free forever, never a plan, never
 * required to search (spec §5.7, §10.20).
 *
 * Fields map to the normalized-v2 prototype exactly, and nothing is invented where it has no column:
 *
 *   businessName        organizations.display_name          public    owner only
 *   legalName           organizations.legal_name            private   owner only (changing it re-opens verification)
 *   homeBase            hauler_profiles.base_area_label     public    owner or manager; a town or ZIP, never an address
 *   serviceRadiusMiles  hauler_profiles.service_radius_miles public   owner or manager
 *   about               hauler_profiles.description         public    owner or manager
 *   listed              hauler_profiles.is_public           setting   owner or manager; recorded consent (F1)
 *   acceptsInvitations  hauler_profiles.accepts_targeted_invitations   setting   owner or manager; off by default (§1.4)
 *
 * The business type from setup ("Just me", "A hauling company") and a business phone or default contact route have
 * no column, so they are not stored here (the contact route is chosen on each inquiry).
 */

export const HAULER_BUSINESS_NAME_MAX_LENGTH = 160
export const HAULER_LEGAL_NAME_MAX_LENGTH = 200
export const HAULER_HOME_BASE_MAX_LENGTH = 80
/** `hauler_profiles.description` allows 4000; the form keeps an About to a readable length. */
export const HAULER_ABOUT_MAX_LENGTH = 2000
/** The radius choices from UX 02 §A5; the store accepts 5–500 miles. */
export const HAULER_SERVICE_RADIUS_CHOICES = [50, 100, 150, 250] as const
export const HAULER_SERVICE_RADIUS_MIN = 5
export const HAULER_SERVICE_RADIUS_MAX = 500

export type HaulerProfileField = "businessName" | "legalName" | "homeBase" | "serviceRadiusMiles" | "about" | "listed" | "acceptsInvitations"

export interface HaulerProfileIssue {
  field: HaulerProfileField
  message: string
}

// ---------------------------------------------------------------------------
// Home base: a town or a ZIP code (spec §5.7). Format only: placing it on the map needs the place list.
// ---------------------------------------------------------------------------

const ZIP = /^(\d{5})(?:-\d{4})?$/
/** Letters with spaces, periods, apostrophes and hyphens ("St. Helens", "Coeur d'Alene"), then an optional ", ST". */
const TOWN = /^([A-Za-z][A-Za-z .'-]*[A-Za-z.])(?:\s*,\s*([A-Za-z]{2}))?$/

export const HOME_BASE_FORMAT_MESSAGE = "Enter a town (Sweet Home, OR) or a 5-digit ZIP code. A street address is never needed."

export type HaulerHomeBaseResult = { ok: true; label: string; kind: "town" | "zip" } | { ok: false; message: string }

/**
 * A home base as the business types it: "Sweet Home, OR", "sweet home", "97386" or "97386-1234". The result is the
 * label shown to landing operators ("Sweet Home, OR", "97386"). Anything with a house number, or any other text, is
 * refused rather than guessed at. This checks the format only; whether a town is on the Find work place list is
 * decided where that list lives.
 */
export function parseHaulerHomeBase(input: string): HaulerHomeBaseResult {
  const text = input.replace(/\s+/g, " ").trim()

  if (text.length < 2 || text.length > HAULER_HOME_BASE_MAX_LENGTH) {
    return { message: HOME_BASE_FORMAT_MESSAGE, ok: false }
  }

  const zip = ZIP.exec(text)?.[1]

  if (zip) {
    return { kind: "zip", label: zip, ok: true }
  }

  const town = TOWN.exec(text)
  const townName = town?.[1]

  if (!town || !townName) {
    return { message: HOME_BASE_FORMAT_MESSAGE, ok: false }
  }

  // "sweet home" and "SWEET HOME" become "Sweet Home"; a name typed in mixed case ("Coeur d'Alene") is kept.
  const uniform = townName === townName.toLowerCase() || townName === townName.toUpperCase()
  const name = uniform
    ? townName.toLowerCase().split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    : townName
  const state = town[2]

  return { kind: "town", label: state ? `${name}, ${state.toUpperCase()}` : name, ok: true }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .max(max * 2)
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, tooLong))
    .transform((value) => (value === "" ? null : value))
}

/** What the profile form saves. The store boundary re-parses it, so a caller cannot skip a rule. */
export const haulerProfileInputSchema = z.object({
  about: optionalText(HAULER_ABOUT_MAX_LENGTH, `Keep About to ${HAULER_ABOUT_MAX_LENGTH} characters or fewer`),
  acceptsInvitations: z.boolean(),
  businessName: z
    .string()
    .max(HAULER_BUSINESS_NAME_MAX_LENGTH * 2)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(2, "Enter your business name")
        .max(HAULER_BUSINESS_NAME_MAX_LENGTH, `Keep the business name to ${HAULER_BUSINESS_NAME_MAX_LENGTH} characters or fewer`)
    ),
  homeBase: z
    .string()
    .max(HAULER_HOME_BASE_MAX_LENGTH * 2)
    .transform((value, context) => {
      if (value.trim() === "") return null
      const parsed = parseHaulerHomeBase(value)
      if (!parsed.ok) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message })
        return z.NEVER
      }
      return parsed.label
    }),
  legalName: optionalText(HAULER_LEGAL_NAME_MAX_LENGTH, `Keep the legal name to ${HAULER_LEGAL_NAME_MAX_LENGTH} characters or fewer`),
  listed: z.boolean(),
  serviceRadiusMiles: z
    .number({ invalid_type_error: "Choose how far you travel for work" })
    .int("Choose how far you travel for work")
    .min(HAULER_SERVICE_RADIUS_MIN, `Choose a distance from ${HAULER_SERVICE_RADIUS_MIN} to ${HAULER_SERVICE_RADIUS_MAX} miles`)
    .max(HAULER_SERVICE_RADIUS_MAX, `Choose a distance from ${HAULER_SERVICE_RADIUS_MIN} to ${HAULER_SERVICE_RADIUS_MAX} miles`)
    .nullable()
})

export type HaulerProfileInput = z.output<typeof haulerProfileInputSchema>

/** The profile form's raw values, exactly as posted (checkboxes as booleans). */
export interface HaulerProfileFormValues {
  businessName: string
  legalName: string
  homeBase: string
  serviceRadiusMiles: string
  about: string
  listed: boolean
  acceptsInvitations: boolean
}

export const EMPTY_HAULER_PROFILE_FORM: HaulerProfileFormValues = Object.freeze({
  about: "",
  acceptsInvitations: false,
  businessName: "",
  homeBase: "",
  legalName: "",
  listed: false,
  serviceRadiusMiles: ""
})

const PROFILE_FIELDS: readonly HaulerProfileField[] = ["businessName", "homeBase", "serviceRadiusMiles", "about", "listed", "legalName", "acceptsInvitations"]

/** Server-side validation of the profile form, one message per field, in screen order. */
export function validateHaulerProfileForm(
  values: HaulerProfileFormValues
): { ok: true; input: HaulerProfileInput } | { ok: false; issues: HaulerProfileIssue[] } {
  const radius = values.serviceRadiusMiles.trim()
  const parsed = haulerProfileInputSchema.safeParse({
    ...values,
    serviceRadiusMiles: radius === "" ? null : /^\d{1,4}$/.test(radius) ? Number(radius) : Number.NaN
  })

  if (parsed.success) {
    return { input: parsed.data, ok: true }
  }

  const byField = new Map<HaulerProfileField, string>()

  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as HaulerProfileField
    if (PROFILE_FIELDS.includes(field) && !byField.has(field)) {
      byField.set(field, field === "serviceRadiusMiles" && issue.code === "invalid_type" ? "Choose how far you travel for work" : issue.message)
    }
  }

  return { issues: PROFILE_FIELDS.flatMap((field) => (byField.has(field) ? [{ field, message: byField.get(field) as string }] : [])), ok: false }
}

/** The form's values for a saved profile. */
export function haulerProfileFormValues(profile: HaulerProfileView): HaulerProfileFormValues {
  return {
    about: profile.about ?? "",
    acceptsInvitations: profile.acceptsInvitations,
    businessName: profile.businessName,
    homeBase: profile.homeBase ?? "",
    legalName: profile.legalName ?? "",
    listed: profile.listed,
    serviceRadiusMiles: profile.serviceRadiusMiles === null ? "" : String(profile.serviceRadiusMiles)
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** The viewer's own hauling business profile, private fields included. Only ever shown to the business's members. */
export interface HaulerProfileView {
  organizationId: string
  businessName: string
  homeBase: string | null
  serviceRadiusMiles: number | null
  about: string | null
  /** Explicit consent to appear to every landing operator; when false a landing sees the profile only after an inquiry. */
  listed: boolean
  legalName: string | null
  /** Consent to targeted invitations from landings (off by default). */
  acceptsInvitations: boolean
  verification: MarketplaceVerification | null
  /** Owner or manager: the profile fields and settings. */
  canEditProfile: boolean
  /** Owner only: the business name and legal name. */
  canEditIdentity: boolean
  /** The last saved change to the profile; `null` when never saved. */
  updatedAt: string | null
}

/** One line of the equipment summary ("2 × Log truck + Pole trailer"), self-reported by the business. */
export interface HaulerEquipmentSummaryLine {
  label: string
  units: number
}

/**
 * What a landing operator sees. Built only by `publicHaulerProfile` (packages/services), which copies exactly these
 * fields, so a private field can never reach a public page by being added to the private view.
 */
export interface HaulerPublicProfileView {
  organizationId: string
  businessName: string
  homeBase: string | null
  serviceRadiusMiles: number | null
  about: string | null
  equipment: HaulerEquipmentSummaryLine[]
  verification: MarketplaceVerification | null
}

export const HAULER_PUBLIC_PROFILE_KEYS = Object.freeze([
  "about",
  "businessName",
  "equipment",
  "homeBase",
  "organizationId",
  "serviceRadiusMiles",
  "verification"
] as const satisfies ReadonlyArray<keyof HaulerPublicProfileView>)
