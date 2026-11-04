import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-07 (#187) at the route: the attach request names an upload, and only the
 * exact object minted for this trip reaches the storage read-back or the
 * service. The ownership check is the real one from lib/media.
 */

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
    }
  },
  attachTripDocument: vi.fn(),
  mutateState: vi.fn(),
  requireApiActor: vi.fn(),
  tripDocumentTarget: vi.fn(),
  verifiedMediaReference: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse: (error: unknown) =>
    error instanceof mocks.ApiError
      ? NextResponse.json({ error: error.message }, { status: error.status })
      : NextResponse.json({ error: "Unexpected error" }, { status: 500 }),
  requireApiActor: mocks.requireApiActor
}))
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  tripDocumentTarget: mocks.tripDocumentTarget,
  verifiedMediaReference: mocks.verifiedMediaReference
}))
vi.mock("@/lib/services", () => ({
  mutateState: mocks.mutateState,
  services: { state: {} }
}))

import { POST } from "../app/api/trips/[tripId]/documents/route"

const ACTOR = "11111111-1111-4111-8111-111111111111"
const ORGANIZATION = "33333333-3333-4333-8333-333333333331"
const TRIP = "55555555-5555-4555-8555-555555555551"
const PREFIX = `logloads/trip-documents/${TRIP}`
const UPLOAD_OBJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

function attach(publicId: unknown) {
  return POST(
    new NextRequest(`https://logloads.test/api/trips/${TRIP}/documents`, {
      body: JSON.stringify({ filename: "ticket.jpg", publicId, type: "scale_ticket" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ tripId: TRIP }) }
  )
}

describe("trip document attach route (HF-07)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireApiActor.mockResolvedValue({
      actor: { profile: { id: ACTOR } },
      actorUserId: ACTOR,
      organizationId: ORGANIZATION
    })
    mocks.tripDocumentTarget.mockReturnValue({ publicIdPrefix: PREFIX, tripId: TRIP })
    mocks.verifiedMediaReference.mockImplementation(async (publicId: string) => ({ publicId }))
    mocks.mutateState.mockImplementation(
      async (mutate: (draft: { attachTripDocument: typeof mocks.attachTripDocument }) => unknown) =>
        mutate({ attachTripDocument: mocks.attachTripDocument })
    )
    mocks.attachTripDocument.mockReturnValue({ document: { id: "document-1" } })
  })

  it("attaches the exact upload minted for this trip", async () => {
    const publicId = `${PREFIX}/uploads/${UPLOAD_OBJECT_ID}`
    const response = await attach(publicId)

    expect(response.status).toBe(201)
    expect(mocks.verifiedMediaReference).toHaveBeenCalledWith(publicId)
    expect(mocks.attachTripDocument).toHaveBeenCalledWith(
      expect.objectContaining({ media: { publicId }, tripId: TRIP })
    )
  })

  it.each([
    ["a sibling trip", `${PREFIX}0/uploads/${UPLOAD_OBJECT_ID}`],
    ["a dot-segment traversal", `${PREFIX}/uploads/../../other-trip/uploads/${UPLOAD_OBJECT_ID}`],
    ["an encoded traversal", `${PREFIX}/uploads/..%2F..%2Fother-trip%2Fuploads%2F${UPLOAD_OBJECT_ID}`],
    ["a nested path", `${PREFIX}/uploads/${UPLOAD_OBJECT_ID}/extra`],
    ["a name the server never mints", `${PREFIX}/uploads/ticket`]
  ])("refuses %s before reading storage or writing state", async (_label, publicId) => {
    const response = await attach(publicId)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "The uploaded document does not belong to this trip"
    })
    expect(mocks.verifiedMediaReference).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })
})
