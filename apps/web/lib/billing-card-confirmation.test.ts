import { describe, expect, it } from "vitest"

import {
  cardConfirmsPaymentMethod,
  confirmedPaymentMethodId
} from "./billing-card-confirmation"

describe("card replacement confirmation", () => {
  it("waits for the exact payment method confirmed by the setup intent", () => {
    expect(confirmedPaymentMethodId("pm_replacement")).toBe("pm_replacement")
    expect(confirmedPaymentMethodId({ id: "pm_expanded" })).toBe("pm_expanded")
    expect(confirmedPaymentMethodId({ id: "" })).toBeNull()
    expect(confirmedPaymentMethodId(null)).toBeNull()

    expect(
      cardConfirmsPaymentMethod(
        { paymentMethodId: "pm_existing", status: "attached" },
        "pm_replacement"
      )
    ).toBe(false)
    expect(
      cardConfirmsPaymentMethod(
        { paymentMethodId: "pm_replacement", status: "pending" },
        "pm_replacement"
      )
    ).toBe(false)
    expect(
      cardConfirmsPaymentMethod(
        { paymentMethodId: "pm_replacement", status: "attached" },
        "pm_replacement"
      )
    ).toBe(true)
  })
})
