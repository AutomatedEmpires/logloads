import { describe, expect, it } from "vitest"

import { V2_PREVIEW_NOTE, V2_PREVIEW_TAG, V2_PRIVACY_REQUEST_PATH, V2_SWITCH_PATH, v2AccountMenuFor } from "./account-menu"

const NOTE = { body: V2_PREVIEW_NOTE.body, title: V2_PREVIEW_NOTE.title }
const PRIVACY_LINK = { href: V2_PRIVACY_REQUEST_PATH, id: "privacy-request", label: "Make a privacy request" }

describe("v2AccountMenuFor (#124 criterion 7)", () => {
  it("gives a member the person, Switch business, Make a privacy request and the preview notice", () => {
    expect(v2AccountMenuFor({ kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } }, "/v2/work")).toEqual({
      links: [{ href: V2_SWITCH_PATH, id: "switch", label: "Switch business" }, PRIVACY_LINK],
      note: NOTE,
      person: { email: "jamie@example.test", name: "Jamie Pine" },
      tag: V2_PREVIEW_TAG
    })
  })

  it("links the privacy request page (#424) by a plain path that carries nothing about the person", () => {
    expect(V2_PRIVACY_REQUEST_PATH).toBe("/v2/privacy-request")

    const links = v2AccountMenuFor({ kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } }, "/v2/work?q=pine").links ?? []

    expect(links.find((link) => link.id === "privacy-request")).toEqual(PRIVACY_LINK)
    for (const link of links) expect(link.href).not.toMatch(/jamie|example\.test|[?#]/i)
  })

  it("offers the privacy request only to a person: a visitor or a sign-in without a profile has nothing in the app to ask about", () => {
    expect(v2AccountMenuFor({ kind: "visitor" }, "/v2/work").links?.map((link) => link.id)).toEqual(["sign-in"])
    expect(v2AccountMenuFor({ kind: "signed-in", person: null }, "/v2/work").links).toBeUndefined()
  })

  it("omits a missing email rather than showing an empty line", () => {
    expect(v2AccountMenuFor({ kind: "signed-in", person: { name: "Jamie Pine" } }, null).person).toEqual({ name: "Jamie Pine" })
  })

  it("gives a sign-in without a LogLoads profile the notice only (the app adds sign-out)", () => {
    expect(v2AccountMenuFor({ kind: "signed-in", person: null }, "/v2/switch")).toEqual({ note: NOTE, tag: V2_PREVIEW_TAG })
  })

  it("gives a visitor Sign in back to the current V2 page, and the notice", () => {
    expect(v2AccountMenuFor({ kind: "visitor" }, "/v2/work/job 1")).toEqual({
      links: [{ href: "/sign-in?next=%2Fv2%2Fwork%2Fjob%201", id: "sign-in", label: "Sign in" }],
      note: NOTE,
      tag: V2_PREVIEW_TAG
    })
    expect(v2AccountMenuFor({ kind: "visitor" }, null).links).toEqual([{ href: "/sign-in", id: "sign-in", label: "Sign in" }])
    expect(v2AccountMenuFor({ kind: "visitor" }, "/v2-other").links?.[0]?.href).toBe("/sign-in")
  })

  it("says plainly that the preview dispatches, records and charges nothing", () => {
    expect(V2_PREVIEW_NOTE.title).toBe("Marketplace V2 development preview")
    expect(V2_PREVIEW_NOTE.body).toMatch(/nothing here dispatches trucks, records loads or charges a fee/)
  })
})
