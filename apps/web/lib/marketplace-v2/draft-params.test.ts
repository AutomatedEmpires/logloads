import { describe, expect, it } from "vitest"

import { draftQueryString, draftValuesFromQuery, hasDraftValues, validateDraftValues } from "./draft-params"

describe("V2 job draft URL round-trip", () => {
  const query = {
    equipment: ["log_truck", "pole_trailer"],
    ignored: "x",
    landingId: "66666666-6666-4666-8666-666666666666",
    payAmount: "525",
    payUnit: "per_load",
    title: "Oak saw logs",
    trucksRequested: "4"
  }

  it("keeps only known fields and survives preview → edit → preview unchanged", () => {
    const values = draftValuesFromQuery(query)
    expect(values.text).not.toHaveProperty("ignored")
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
})
