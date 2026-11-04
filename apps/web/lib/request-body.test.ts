import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-02 (#187): the API write routes read their JSON body through a size cap.
 * A body over the cap is refused with 413 before the route authenticates,
 * rate-limits or writes anything.
 */

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  mutateState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./services", () => ({ mutateState: mocks.mutateState }))

import { POST as approveCapacityRequest } from "@/app/api/assignments/[assignmentId]/approve/route"
import { POST as postLoad } from "@/app/api/loads/route"
import { POST as postNotice } from "@/app/api/notices/route"
import { POST as postTripEvent } from "@/app/api/trips/[tripId]/events/route"

import { ApiError } from "./api-actor"
import { JSON_BODY_LIMIT_BYTES, readJsonBody, readOptionalJsonBody } from "./request-body"

const ORGANIZATION_ID = "org-fixture-1"

function signedInAs(userId: string) {
  const organization = { archivedAt: null, id: ORGANIZATION_ID, verificationStatus: "verified" }

  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: organization,
    isPlatformAdmin: false,
    memberships: [{ organization }],
    profile: { id: userId },
    workspaceSelectionInvalid: false
  })
}

function jsonRequest(path: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://127.0.0.1:3002${path}`, {
    body,
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST"
  })
}

/** A body with no Content-Length, delivered in chunks, as a chunked upload is. */
function chunkedRequest(chunks: string[]): NextRequest {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }

      controller.close()
    }
  })

  return new NextRequest("http://127.0.0.1:3002/api/notices", {
    body: stream,
    duplex: "half",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  } as RequestInit & { duplex: "half" })
}

/** A valid notice whose body text pads the JSON to exactly `bytes`. */
function noticeOfSize(bytes: number): string {
  const shell = JSON.stringify({ body: "", severity: "watch", title: "Gate" })

  return JSON.stringify({ body: "x".repeat(bytes - shell.length), severity: "watch", title: "Gate" })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutateState.mockResolvedValue({ changed: true })
})

describe("readJsonBody", () => {
  it("parses a body at the cap", async () => {
    const body = noticeOfSize(JSON_BODY_LIMIT_BYTES)

    expect(new TextEncoder().encode(body).byteLength).toBe(JSON_BODY_LIMIT_BYTES)
    await expect(readJsonBody(jsonRequest("/api/notices", body))).resolves.toMatchObject({ title: "Gate" })
  })

  it("refuses a body one byte over the cap", async () => {
    await expect(
      readJsonBody(jsonRequest("/api/notices", noticeOfSize(JSON_BODY_LIMIT_BYTES + 1)))
    ).rejects.toMatchObject({ status: 413 })
  })

  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const request = jsonRequest("/api/notices", "{}", {
      "Content-Length": String(JSON_BODY_LIMIT_BYTES + 1)
    })

    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 })
    expect(request.bodyUsed).toBe(false)
  })

  it("refuses a chunked body as soon as it passes the cap", async () => {
    const chunk = "x".repeat(16 * 1024)

    await expect(readJsonBody(chunkedRequest(['{"body":"', chunk, chunk, chunk, chunk, chunk, '"}']))).rejects.toBeInstanceOf(
      ApiError
    )
  })

  it("keeps request.json()'s SyntaxError for a body that is not JSON, or is empty", async () => {
    await expect(readJsonBody(jsonRequest("/api/notices", "{not json"))).rejects.toBeInstanceOf(SyntaxError)
    await expect(readJsonBody(jsonRequest("/api/notices", ""))).rejects.toBeInstanceOf(SyntaxError)
  })

  it("reads an optional body as {} when it is empty or not JSON, and still refuses one over the cap", async () => {
    await expect(readOptionalJsonBody(jsonRequest("/api/notices", ""))).resolves.toEqual({})
    await expect(readOptionalJsonBody(jsonRequest("/api/notices", "{not json"))).resolves.toEqual({})
    await expect(
      readOptionalJsonBody(jsonRequest("/api/notices", noticeOfSize(JSON_BODY_LIMIT_BYTES + 1)))
    ).rejects.toMatchObject({ status: 413 })
  })
})

describe("API write routes cap the request body", () => {
  const oversized = noticeOfSize(JSON_BODY_LIMIT_BYTES + 1)

  it.each([
    ["POST /api/notices", () => postNotice(jsonRequest("/api/notices", oversized))],
    [
      "POST /api/trips/[tripId]/events",
      () =>
        postTripEvent(jsonRequest("/api/trips/trip-1/events", oversized), {
          params: Promise.resolve({ tripId: "trip-1" })
        })
    ],
    ["POST /api/loads", () => postLoad(jsonRequest("/api/loads", oversized))],
    [
      "POST /api/assignments/[assignmentId]/approve",
      () =>
        approveCapacityRequest(jsonRequest("/api/assignments/assignment-1/approve", oversized), {
          params: Promise.resolve({ assignmentId: "assignment-1" })
        })
    ]
  ])("%s answers 413 before it authenticates or writes", async (_route, send) => {
    signedInAs("user-body-cap")

    const response = await send()

    expect(response.status).toBe(413)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ error: "The request body is too large." })
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("still accepts an ordinary notice", async () => {
    signedInAs("user-body-cap-ordinary")

    const response = await postNotice(
      jsonRequest("/api/notices", JSON.stringify({ body: "Hold at the gate.", severity: "watch", title: "Gate" }))
    )

    expect(response.status).toBe(201)
    expect(mocks.mutateState).toHaveBeenCalledTimes(1)
  })

  it("still answers malformed JSON with the sanitized 400", async () => {
    signedInAs("user-body-cap-malformed")

    const response = await postNotice(jsonRequest("/api/notices", "{not json"))

    expect(response.status).toBe(400)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })
})
