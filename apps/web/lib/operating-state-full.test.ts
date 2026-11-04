import { OperatingStateTooLargeError } from "@logloads/db"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { OPERATING_STATE_FULL_MESSAGE } from "./operating-state-messages"
import { serializeError } from "./services"

/**
 * HF-02 (#187): when the snapshot writer refuses a write at the document size
 * limit, a cockpit action shows a fixed message and the sizes go to the log.
 */
describe("serializeError for a write refused at the size limit", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("gives the cockpit a fixed message and keeps the sizes in the server log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(serializeError(new OperatingStateTooLargeError(9_000_000, 8_388_608))).toEqual({
      error: OPERATING_STATE_FULL_MESSAGE
    })
    expect(log).toHaveBeenCalledWith("logloads: operating state write refused at the size limit", {
      byteLength: 9_000_000,
      limitBytes: 8_388_608
    })
  })

  it("still passes other errors' messages through", () => {
    expect(serializeError(new Error("Sign in to continue"))).toEqual({ error: "Sign in to continue" })
  })
})
