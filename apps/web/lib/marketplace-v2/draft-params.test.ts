import { describe, expect, it } from "vitest"

import {
  draftPublishingIssues,
  draftQueryString,
  draftValuesFromForm,
  draftValuesFromQuery,
  hasDraftValues,
  LANDING_NOT_OWNED,
  validateDraftValues
} from "./draft-params"

const OWN_LANDING = { id: "66666666-6666-4666-8666-666666666666" }
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"

describe("V2 job draft URL round-trip", () => {
  const query = {
    equipment: ["log_truck", "pole_trailer"],
    ignored: "x",
    landingId: OWN_LANDING.id,
    payAmount: "525",
    payUnit: "per_load",
    title: "Oak saw logs",
    trucksRequested: "4"
  }

  it("keeps only known fields and survives preview → edit → preview unchanged", () => {
    const values = draftValuesFromQuery({ ...query, endsOn: "2026-11-20", ongoing: "1" })
    expect(values.text).not.toHaveProperty("ignored")
    expect(values.text).toMatchObject({ endsOn: "2026-11-20", ongoing: "1" })
    const again = draftValuesFromQuery(Object.fromEntries(
      [...new URLSearchParams(draftQueryString(values)).entries()].reduce((map, [key, value]) => {
        map.set(key, map.has(key) ? [...[map.get(key)!].flat(), value] : value)
        return map
      }, new Map<string, string | string[]>())
    ))
    expect(again).toEqual(values)
  })

  it("accepts the comma-joined equipment the publish action sends back", () => {
    expect(draftValuesFromQuery({ equipment: "log_truck,self_loader" }).equipment).toEqual(["log_truck", "self_loader"])
  })

  it("treats an empty query as a blank form and validates a filled one", () => {
    expect(hasDraftValues(draftValuesFromQuery({}))).toBe(false)
    expect(validateDraftValues(draftValuesFromQuery(query)).ok).toBe(true)
  })

  it("never carries an attestation or a confirmation time: an edit is never a confirmation", () => {
    const values = draftValuesFromQuery({
      ...query,
      availabilityAttestation: "confirmed",
      confirmedAt: "2026-11-02T00:00:00.000Z",
      lastConfirmedAt: "2026-11-02T00:00:00.000Z"
    })
    expect(values.text).not.toHaveProperty("availabilityAttestation")
    expect(values.text).not.toHaveProperty("lastConfirmedAt")
    expect(values.text).not.toHaveProperty("confirmedAt")
    expect(draftQueryString(values)).not.toMatch(/availabilityAttestation|onfirmedAt/)
  })
})

describe("draft values from the publish form", () => {
  it("reads the same draft fields as the URL and ignores identity, attestation and timestamps", () => {
    const formData = new FormData()
    for (const [name, value] of Object.entries({
      availabilityAttestation: "confirmed",
      landingId: OWN_LANDING.id,
      lastConfirmedAt: "2020-01-01T00:00:00.000Z",
      organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      payAmount: "525",
      payUnit: "per_load",
      title: "Oak saw logs",
      trucksRequested: "4",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })) formData.set(name, value)
    formData.append("equipment", "log_truck")
    formData.append("equipment", " pole_trailer ")

    expect(draftValuesFromForm(formData)).toEqual({
      equipment: ["log_truck", "pole_trailer"],
      text: { landingId: OWN_LANDING.id, payAmount: "525", payUnit: "per_load", title: "Oak saw logs", trucksRequested: "4" }
    })
  })
})

describe("issues shown on the edit form", () => {
  const complete = {
    durationDays: "10",
    equipment: ["log_truck"],
    landingId: OWN_LANDING.id,
    payAmount: "525",
    payUnit: "per_load",
    product: "Saw logs",
    startsOn: "2026-11-10",
    title: "Oak saw logs",
    trucksRequested: "4"
  }
  const fieldsFor = (query: Record<string, string | string[]>) =>
    draftPublishingIssues(draftValuesFromQuery(query), [OWN_LANDING]).map((issue) => issue.field)

  it("shows none for a complete draft on the organization's own landing", () => {
    expect(fieldsFor(complete)).toEqual([])
  })

  it("flags a landing that is not one of the organization's own (cross-organization)", () => {
    expect(draftPublishingIssues(draftValuesFromQuery({ ...complete, landingId: OTHER_LANDING_ID }), [OWN_LANDING]))
      .toEqual([{ field: "landingId", message: LANDING_NOT_OWNED }])
  })

  it("flags missing pay, product and timing", () => {
    expect(fieldsFor({ ...complete, payAmount: "", payUnit: "" })).toEqual(["payUnit"])
    expect(fieldsFor({ ...complete, durationDays: "", product: "", startsOn: "" })).toEqual(["product", "startsOn", "workPeriod"])
  })
})
