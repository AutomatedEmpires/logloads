import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { EMPTY_HAULER_PROFILE_FORM, haulerProfileInputSchema, validateHaulerProfileForm } from "@logloads/contracts"
import { HAULER_PROFILE_EDIT_REFUSED } from "@logloads/services"
import { describe, expect, it, vi } from "vitest"

/**
 * #343, legal review §6.5 ("Public hauler listings") and SQL-DEC F1: hauler profile routes carry `noindex` and are in
 * no sitemap, and whether a profile is listed stays the hauler's own choice, reversible in one save. The schema side
 * of F1 (private by default, consent recorded by a trigger, only an owner or manager) is proven in
 * architecture/normalized-v2/13_v2_phase3_tests.sql; this proves the application side.
 */

vi.mock("server-only", () => ({}))
// The V2 layout's own dependencies: only its exported metadata is read here.
vi.mock("next/navigation", () => ({ notFound: vi.fn() }))
vi.mock("@/components/v2/V2AppShell", () => ({ V2AppShell: () => null }))
vi.mock("@/lib/marketplace-v2/business-switcher", () => ({ resolveV2Shell: vi.fn() }))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/inquiries", () => ({ v2InquiryNavCounts: vi.fn() }))
vi.mock("@/app/v2/_fonts/ibm-plex", () => ({ plexFaceDeclarations: "" }))
vi.mock("@logloads/ui/tokens.css", () => ({}))
// The sitemap's public loads: one, so its load pages are part of what is checked.
vi.mock("@/lib/v3", () => ({ getPublicLoads: async () => [{ reference: "LL-1001", title: "Saw logs to Sweet Home" }] }))

import { metadata as v2Metadata } from "@/app/v2/layout"
import robots from "@/app/robots"
import sitemap from "@/app/sitemap"

import { normalizedHaulerProfileMethods } from "../normalized-hauler"
import { MARKETPLACE_QUERIES } from "../normalized-queries"
import { MarketplaceRefusalError } from "../port"

const WEB_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/

function sources(directory: string): Array<{ name: string; text: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [{ name: relative(WEB_ROOT, path).split(sep).join("/"), text: readFileSync(path, "utf8") }] : []
  })
}

const APP = sources(join(WEB_ROOT, "app"))
/** A page that shows a hauling business's profile: its own editor or the view a landing sees. */
const SHOWS_HAULER_PROFILE = /PublicHaulerProfile|HaulerProfileForm|publicHaulerProfile|\.haulerProfile\(/

describe("hauler profile routes carry noindex", () => {
  const profilePages = APP.filter((file) => /\/page\.tsx$/.test(file.name) && SHOWS_HAULER_PROFILE.test(file.text))

  it("finds the V2 profile pages, and every one is under the V2 layout", () => {
    expect(profilePages.map((file) => file.name)).toContain("app/v2/hauler/profile/page.tsx")
    expect(profilePages.filter((file) => !file.name.startsWith("app/v2/")).map((file) => file.name)).toEqual([])
  })

  it("the V2 layout tells search engines not to index or follow any V2 page", () => {
    expect(v2Metadata.robots).toEqual({ follow: false, index: false })
  })

  it("no V2 page or layout lets a search engine in: every robots setting there is noindex, nofollow", () => {
    const v2 = APP.filter((file) => file.name.startsWith("app/v2/"))
    const settings = v2.flatMap((file) => [...file.text.matchAll(/\brobots\s*:\s*([^}]*\})/g)].map((match) => ({ name: file.name, value: match[1]?.replace(/\s+/g, " ") })))

    expect(settings.length).toBeGreaterThan(0)
    expect(settings.filter((setting) => setting.value !== "{ follow: false, index: false }")).toEqual([])
    expect(v2.filter((file) => /\b(?:index|follow)\s*:\s*true\b/.test(file.text)).map((file) => file.name)).toEqual([])
  })

  it("the profile pages set no metadata of their own, so they keep the layout's", () => {
    expect(profilePages.filter((file) => /\bgenerateMetadata\b|export const metadata/.test(file.text)).map((file) => file.name)).toEqual([])
  })
})

describe("hauler profile routes are in no sitemap", () => {
  it("lists no V2 page, no profile, directory or truck page, and no legacy cockpit", async () => {
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname)

    expect(paths).toContain("/")
    expect(paths.some((path) => path.startsWith("/loads/"))).toBe(true)
    expect(paths.filter((path) => /^\/v2(?:\/|$)|\/hauler|\/haulers|\/trucks|\/profile|^\/driver|^\/fleet/.test(path))).toEqual([])
  })

  it("asks crawlers to stay out of the signed-in legacy hauler cockpits", () => {
    const rules = [robots().rules].flat()
    const disallowed = rules.flatMap((rule) => [rule?.disallow ?? []].flat())

    expect(disallowed).toEqual(expect.arrayContaining(["/driver", "/fleet"]))
  })
})

describe("listing a profile stays the hauler's choice, and is reversible (F1)", () => {
  const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
  const viewer = { organizationId: ORG, userId: "55555555-dddd-4ddd-8ddd-555555555555" }

  it("starts unlisted, and the form never assumes a choice", () => {
    expect(EMPTY_HAULER_PROFILE_FORM.listed).toBe(false)
    expect(validateHaulerProfileForm({ ...EMPTY_HAULER_PROFILE_FORM, businessName: "Ridgeline Hauling" })).toMatchObject({ input: { listed: false }, ok: true })

    // No default: a save that does not say whether to list is refused, never read as consent.
    const chosen = { ...EMPTY_HAULER_PROFILE_FORM, businessName: "Ridgeline Hauling", serviceRadiusMiles: null }
    const withoutChoice: Record<string, unknown> = { ...chosen }
    delete withoutChoice.listed
    expect(haulerProfileInputSchema.safeParse(chosen).success).toBe(true)
    expect(haulerProfileInputSchema.safeParse(withoutChoice).error?.issues.map((issue) => issue.path.join("."))).toEqual(["listed"])
  })

  /** A hauler profile row in the store, changed only by `hauler_profile_update`, as the schema allows. */
  function fakeStore(canEditProfile: boolean) {
    const row = {
      accepts_targeted_invitations: false,
      base_area_label: null,
      can_edit_identity: canEditProfile,
      can_edit_profile: canEditProfile,
      description: null,
      display_name: "Ridgeline Hauling",
      is_public: false,
      legal_name: null,
      org_id: ORG,
      service_radius_miles: null,
      updated_at: null,
      verification_status: "unverified",
      verified_at: null
    }
    const query = vi.fn(async (name: string, values: unknown[]) => {
      if (name === "hauler_profile") return [{ ...row }]
      if (name === "hauler_profile_update") {
        row.is_public = values[4] as boolean
        return [{ org_id: ORG }]
      }
      throw new Error(`unexpected statement ${name}`)
    })
    const calls = { call: vi.fn(), query }
    const methods = normalizedHaulerProfileMethods(
      async (_viewer, work) => work(calls as never),
      async (_account, work) => work(calls as never)
    )

    return { methods, query, row }
  }

  const save = (listed: boolean) => ({ ...EMPTY_HAULER_PROFILE_FORM, acceptsInvitations: false, businessName: "Ridgeline Hauling", homeBasePoint: null, listed, serviceRadiusMiles: null })

  it("stores exactly what the hauler chose, and unlisting is one save", async () => {
    const store = fakeStore(true)

    expect((await store.methods.saveHaulerProfile(viewer, save(true))).listed).toBe(true)
    expect(store.query).toHaveBeenCalledWith("hauler_profile_update", expect.arrayContaining([ORG]))
    expect(store.query.mock.calls.find(([name]) => name === "hauler_profile_update")?.[1]?.[4]).toBe(true)

    expect((await store.methods.saveHaulerProfile(viewer, save(false))).listed).toBe(false)
    expect(store.row.is_public).toBe(false)
  })

  it("refuses a member who may not change the profile before anything is written", async () => {
    const store = fakeStore(false)

    await expect(store.methods.saveHaulerProfile(viewer, save(true))).rejects.toEqual(new MarketplaceRefusalError(HAULER_PROFILE_EDIT_REFUSED, "42501"))
    expect(store.query.mock.calls.map(([name]) => name)).toEqual(["hauler_profile"])
    expect(store.row.is_public).toBe(false)
  })

  it("has one write of the listing anywhere in V2: the hauler's own value, for an owner or manager", () => {
    const writers = [...APP, ...sources(join(WEB_ROOT, "lib")), ...sources(join(WEB_ROOT, "components"))].filter((file) => /(?<![.\w])is_public\s*=(?!=)/.test(file.text))

    expect(writers.map((file) => file.name)).toEqual(["lib/marketplace-v2/normalized-queries.ts"])

    const update = MARKETPLACE_QUERIES.hauler_profile_update.text
    expect(update).toMatch(/is_public = \$5::text::boolean/)
    expect(update).toContain("has_org_role(org_id, array['owner', 'manager']::text[])")
    expect(Object.entries(MARKETPLACE_QUERIES).filter(([, spec]) => /(?<![.\w])is_public\s*=(?!=)/.test(spec.text)).map(([name]) => name)).toEqual(["hauler_profile_update"])
  })
})
