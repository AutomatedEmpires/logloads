import { DomainRefusalError } from "@logloads/services"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  mutateState: vi.fn(),
  requireApiActor: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-actor")>()

  return {
    ...actual,
    requireApiActor: mocks.requireApiActor
  }
})
vi.mock("@/lib/services", () => ({
  mutateState: mocks.mutateState
}))

import { POST as approveAssignment } from "../app/api/assignments/[assignmentId]/approve/route"
import { POST as requestAssignment } from "../app/api/assignments/request/route"

const ACTOR = "11111111-1111-4111-8111-111111111111"
const ASSIGNMENT = "ffffffff-ffff-4fff-8fff-fffffffffff1"
const LOAD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
const ORGANIZATION = "33333333-3333-4333-8333-333333333331"

function jsonRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`https://logloads.test${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

async function expectSanitizedConflict(response: Response): Promise<void> {
  expect(response.status).toBe(409)
  const body = (await response.json()) as { error: string }

  expect(body.error).toBe(
    "This request conflicts with current records or policy. Refresh and correct the request before retrying."
  )
  expect(body.error).not.toContain(LOAD)
  expect(body.error).not.toContain(ASSIGNMENT)
  expect(body.error).not.toContain(ORGANIZATION)
}

describe("assignment API domain refusals", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    mocks.requireApiActor.mockResolvedValue({
      actor: {},
      actorUserId: ACTOR,
      organizationId: ORGANIZATION
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns a sanitized 409 when a load is closed or hidden", async () => {
    mocks.mutateState.mockRejectedValue(
      new DomainRefusalError(
        `Load posting ${LOAD} is not visible to organization ${ORGANIZATION}`
      )
    )

    const response = await requestAssignment(
      jsonRequest("/api/assignments/request", {
        driverProfileId: "44444444-4444-4444-8444-444444444441",
        loadPostingId: LOAD,
        organizationId: ORGANIZATION,
        trailerProfileId: "88888888-8888-4888-8888-888888888881",
        truckProfileId: "77777777-7777-4777-8777-777777777771",
        truckSlotId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
      })
    )

    await expectSanitizedConflict(response)
  })

  it("returns a sanitized 409 when approval fails the credential gate", async () => {
    mocks.mutateState.mockRejectedValue(
      new DomainRefusalError(
        `Assignment ${ASSIGNMENT} cannot clear trailer credentials for load ${LOAD}`
      )
    )

    const response = await approveAssignment(
      jsonRequest(`/api/assignments/${ASSIGNMENT}/approve`, {
        organizationId: ORGANIZATION
      }),
      { params: Promise.resolve({ assignmentId: ASSIGNMENT }) }
    )

    await expectSanitizedConflict(response)
  })
})
