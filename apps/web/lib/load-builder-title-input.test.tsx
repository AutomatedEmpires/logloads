import { LOAD_POSTING_TITLE_MAX_LENGTH } from "@logloads/contracts"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { OpportunityBuilder } from "@/components/v3/HostActions"
import type { HostPublishingOptions } from "@/lib/host-data"

/** A host with the records publishing needs, so the builder opens on its first step. */
const OPTIONS: HostPublishingOptions = {
  accessVocabulary: [],
  billingActivationState: null,
  billingModel: null,
  billingProfileStatus: null,
  currentPercentageAgreementActive: false,
  dispatcher: { email: null, id: "dispatcher-fixture-1", name: "Fixture Dispatcher", phone: "555-0100" },
  equipmentVocabulary: [],
  landings: [{ id: "landing-fixture-1", label: "Fixture landing", roadCondition: "good" }],
  loadTypes: ["saw_logs"],
  rates: [{ detail: null, id: "rate-fixture-1", label: "Fixture rate" }],
  routes: [
    {
      distanceMiles: 20,
      id: "route-fixture-1",
      label: "Fixture lane",
      landingId: "landing-fixture-1",
      millId: "mill-fixture-1",
      millLabel: "Fixture mill",
      roadCondition: "good",
      runTimeMinutes: 45
    }
  ],
  subscriptionPlanCode: null
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** #187: the browser stops the work title at the length the server accepts. */
describe("load builder work title", () => {
  it("caps the input at the posting title limit", () => {
    vi.stubGlobal("React", React)

    const markup = renderToStaticMarkup(React.createElement(OpportunityBuilder, { options: OPTIONS }))
    const titleInput = /<input[^>]*placeholder="e\.g\. Blue River saw-log morning block"[^>]*>/.exec(markup)?.[0]

    expect(titleInput).toBeDefined()
    expect(titleInput).toMatch(new RegExp(`maxLength="${LOAD_POSTING_TITLE_MAX_LENGTH}"`, "i"))
  })
})
