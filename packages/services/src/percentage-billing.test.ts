import { PERCENTAGE_V1_TERMS_VERSION } from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"

describe("retired percentage agreement", () => {
  it("refuses every new acceptance and leaves stored accounts unchanged", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const before = structuredClone(services.state.organizationBillingAccounts)

    expect(() =>
      services.acceptPercentageBillingAgreement({
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        actorUserId: HOST_OWNER,
        organizationId: HOST
      })
    ).toThrow(DomainRefusalError)
    expect(services.state.organizationBillingAccounts).toEqual(before)
  })
})
