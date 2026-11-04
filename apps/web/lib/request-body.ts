import { ApiError } from "./api-actor"

/**
 * The largest JSON body an API write route reads (HF-02, #187).
 *
 * Generous on purpose: the largest legitimate body is a load posting or an
 * operational notice, a few kilobytes, and every stored text field already has
 * its own cap (a notice body is at most 4,000 characters). The cap only stops a
 * caller from making the server buffer an arbitrarily large body before the
 * route has even looked at it.
 */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024

const BODY_TOO_LARGE_MESSAGE = "The request body is too large."

/**
 * Exactly what `request.json()` resolves to, so a route that switches to the
 * bounded reader keeps its existing types. Validation stays where it was: each
 * route and service still parses the fields it reads.
 */
type JsonBody = Awaited<ReturnType<Request["json"]>>

function bodyTooLarge(): ApiError {
  return new ApiError(BODY_TOO_LARGE_MESSAGE, 413)
}

/**
 * The body as text, refused with `413` once it passes `limitBytes`. The limit is
 * enforced while reading, so a chunked body without a Content-Length cannot
 * buffer past it either.
 */
async function readBoundedText(request: Request, limitBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"))

  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw bodyTooLarge()
  }

  if (!request.body) {
    return ""
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    received += value.byteLength

    if (received > limitBytes) {
      await reader.cancel().catch(() => undefined)
      throw bodyTooLarge()
    }

    chunks.push(value)
  }

  const merged = new Uint8Array(received)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(merged)
}

/**
 * `request.json()` with a size cap. A body over the cap is a `413`; a body that
 * is not JSON still throws the `SyntaxError` the shared error mapper answers
 * with `400`, exactly as `request.json()` did.
 */
export async function readJsonBody(
  request: Request,
  limitBytes = JSON_BODY_LIMIT_BYTES
): Promise<JsonBody> {
  return JSON.parse(await readBoundedText(request, limitBytes))
}

/**
 * For routes whose body is optional: an empty or unreadable body is `{}`, as
 * `request.json().catch(() => ({}))` gave. A body over the cap is still refused.
 */
export async function readOptionalJsonBody(
  request: Request,
  limitBytes = JSON_BODY_LIMIT_BYTES
): Promise<JsonBody> {
  try {
    return await readJsonBody(request, limitBytes)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    return {}
  }
}
