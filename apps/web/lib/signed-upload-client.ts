"use client"

import { createClient } from "@supabase/supabase-js"

export interface SignedUploadResponse {
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
  const timeout = globalThis.setTimeout(() => {
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
    globalThis.clearTimeout(timeout)
    init.signal?.removeEventListener("abort", abortFromCaller)
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
