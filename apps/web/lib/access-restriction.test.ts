import { describe, expect, it } from "vitest"

import { accessRestrictionMessage } from "./access-restriction"

describe("restricted organization guidance", () => {
  it.each([
    ["organization_suspended", "North Pine is suspended.", "steps required for reinstatement"],
    ["organization_rejected", "North Pine is not approved.", "request a new review"]
  ] as const)("gives %s an accurate organization-level support path", (reason, title, nextStep) => {
    const message = accessRestrictionMessage(reason, "North Pine")
    const serialized = JSON.stringify(message)

    expect(message.title).toBe(title)
    expect(message.body).toContain("new operating actions are locked")
    expect(message.note).toContain("Contact LogLoads support")
    expect(message.note).toContain(nextStep)
    expect(serialized).not.toMatch(/message|thread/i)
  })

  it("keeps a membership pause distinct from an organization suspension", () => {
    const message = accessRestrictionMessage("suspended", "North Pine")

    expect(message.title).toBe("This workspace membership is suspended.")
    expect(message.body).toContain("paused this membership")
    expect(message.body).not.toContain("North Pine")
  })
})
