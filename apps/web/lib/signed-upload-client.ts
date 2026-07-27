"use client"

import { createClient } from "@supabase/supabase-js"

export type SignedUploadResponse =
  | {
      apiKey: string
      parameters: Record<string, string | number>
      provider: "cloudinary"
      publicId: string
      signature: string
      uploadUrl: string
    }
  | {
      anonKey: string
      bucket: string
      path: string
      provider: "supabase"
      publicId: string
      supabaseUrl: string
      token: string
    }

const NETWORK_TIMEOUT_MS = 45_000

/**
 * Keeps a stalled signing or storage request from leaving a driver's phone in a
 * permanent pending state. Preserve an upstream abort signal while applying the
 * same ceiling to every provider.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = NETWORK_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (init.signal?.aborted) {
    abortFromCaller()
  } else {
    init.signal?.addEventListener("abort", abortFromCaller, { once: true })
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new Error("The upload took too long. Check your connection and try again.")
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
    init.signal?.removeEventListener("abort", abortFromCaller)
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * Uploads directly to the provider using a server-issued, single-object token.
 * The caller only receives the resulting opaque object id; storage credentials
 * and durable write permission never reach the browser.
 */
export async function uploadSignedFile(
  signature: SignedUploadResponse,
  file: File
): Promise<string> {
  if (signature.provider === "supabase") {
    const client = createClient(signature.supabaseUrl, signature.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout }
    })
    const { error } = await client.storage
      .from(signature.bucket)
      .uploadToSignedUrl(signature.path, signature.token, file, {
        contentType: file.type
      })

    if (error) {
      throw new Error(error.message || "The file could not be uploaded.")
    }

    return signature.publicId
  }

  const uploadBody = new FormData()
  uploadBody.append("file", file)
  uploadBody.append("api_key", signature.apiKey)
  uploadBody.append("signature", signature.signature)

  for (const [key, value] of Object.entries(signature.parameters)) {
    uploadBody.append(key, String(value))
  }

  const providerResponse = await fetchWithTimeout(signature.uploadUrl, {
    body: uploadBody,
    method: "POST"
  })
  const asset = await readJson<{ error?: { message?: string }; public_id?: string }>(
    providerResponse
  )

  if (!providerResponse.ok || !asset?.public_id) {
    throw new Error(asset?.error?.message ?? "The file could not be uploaded.")
  }

  return asset.public_id
}
