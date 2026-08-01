import { afterEach, describe, expect, it, vi } from "vitest"

const supabaseAdapter = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  uploadToSignedUrl: vi.fn()
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseAdapter.createClient
}))

import {
  fetchWithTimeout,
  type SignedUploadResponse,
  uploadSignedFile
} from "./signed-upload-client"

const signature: SignedUploadResponse = {
  anonKey: "publishable-test-key",
  bucket: "logloads-private-media",
  path: "logloads/trip-documents/trip-1/uploads/object-1",
  provider: "supabase",
  publicId: "logloads/trip-documents/trip-1/uploads/object-1",
  supabaseUrl: "https://logloads-test.supabase.co",
  token: "single-object-token"
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("signed Supabase upload client", () => {
  it("uses only the server-issued single-object token", async () => {
    supabaseAdapter.from.mockReturnValue({
      uploadToSignedUrl: supabaseAdapter.uploadToSignedUrl
    })
    supabaseAdapter.createClient.mockReturnValue({
      storage: { from: supabaseAdapter.from }
    })
    supabaseAdapter.uploadToSignedUrl.mockResolvedValue({
      data: { path: signature.path },
      error: null
    })
    const file = new File(["photo"], "photo.png", { type: "image/png" })

    await expect(uploadSignedFile(signature, file)).resolves.toBe(
      signature.publicId
    )
    expect(supabaseAdapter.createClient).toHaveBeenCalledWith(
      signature.supabaseUrl,
      signature.anonKey,
      expect.objectContaining({
        auth: { autoRefreshToken: false, persistSession: false }
      })
    )
    expect(supabaseAdapter.from).toHaveBeenCalledWith(signature.bucket)
    expect(supabaseAdapter.uploadToSignedUrl).toHaveBeenCalledWith(
      signature.path,
      signature.token,
      file,
      { contentType: "image/png" }
    )
  })

  it("surfaces the provider upload refusal", async () => {
    supabaseAdapter.from.mockReturnValue({
      uploadToSignedUrl: supabaseAdapter.uploadToSignedUrl
    })
    supabaseAdapter.createClient.mockReturnValue({
      storage: { from: supabaseAdapter.from }
    })
    supabaseAdapter.uploadToSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "Object already exists" }
    })

    await expect(
      uploadSignedFile(
        signature,
        new File(["photo"], "photo.png", { type: "image/png" })
      )
    ).rejects.toThrow("Object already exists")
  })
})

describe("upload timeout", () => {
  it("aborts a stalled request with field-safe retry guidance", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
      })
    )

    const response = fetchWithTimeout(
      "https://logloads-test.supabase.co/storage/upload",
      {},
      50
    )
    const rejection = expect(response).rejects.toThrow(
      "The upload took too long. Check your connection and try again."
    )

    await vi.advanceTimersByTimeAsync(50)
    await rejection
  })

  it("preserves a caller abort instead of rewriting it as a timeout", async () => {
    const caller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted by caller", "AbortError")),
            { once: true }
          )
        })
      })
    )

    const response = fetchWithTimeout(
      "https://logloads-test.supabase.co/storage/upload",
      { signal: caller.signal },
      1_000
    )
    caller.abort()

    await expect(response).rejects.toMatchObject({ name: "AbortError" })
  })
})
