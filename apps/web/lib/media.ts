import "server-only"

import { createClient } from "@supabase/supabase-js"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { tripDocumentSchema, type MediaReference, type TripDocument } from "@logloads/contracts"
import { imageSize } from "image-size"
import {
  DomainRefusalError,
  getDriverMediaTarget,
  getTripDocumentTarget,
  type DriverMediaTarget,
  type TripDocumentAccess,
  type TripDocumentTarget
} from "@logloads/services"

import { ApiError } from "./api-actor"
import { dedicatedSupabaseMediaConfiguration } from "./media-config"
import type { SessionActor } from "./session"

export const MEDIA_KINDS = ["profile", "truck", "trailer"] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export type MediaTarget = DriverMediaTarget

const MEDIA_UNAVAILABLE_MESSAGE = "File uploads are not activated for this environment"
const MAX_MEDIA_BYTES = 10_000_000
const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

function environment() {
  const config = dedicatedSupabaseMediaConfiguration(process.env)

  if (!config) {
    throw new ApiError(MEDIA_UNAVAILABLE_MESSAGE, 503)
  }

  return config
}

function supabaseStorage() {
  const config = environment()
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  return { client, config }
}

export function parseMediaKind(value: unknown): MediaKind {
  if (typeof value !== "string" || !MEDIA_KINDS.includes(value as MediaKind)) {
    throw new ApiError("Choose a supported photo type", 422)
  }

  return value as MediaKind
}

/**
 * A request body as an object, or a refusal. `null` and `7` are both valid JSON,
 * so reading a field straight off `request.json()` throws a TypeError that
 * surfaces as a raw 400 instead of the 422 the route meant to give.
 */
export function parseJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("The request body must be a JSON object", 422)
  }

  return body as Record<string, unknown>
}

/**
 * Validated, never cast, and read from the domain schema rather than copied —
 * a hand-kept list would silently reject a proof type the domain later adds.
 * The type decides whether a document answers the completion evidence gate, so
 * a caller must not be able to invent one either.
 */
export function parseTripDocumentType(value: unknown): TripDocument["type"] {
  const parsed = tripDocumentSchema.shape.type.safeParse(value)

  if (!parsed.success) {
    throw new ApiError("Choose a supported proof type", 422)
  }

  return parsed.data
}

export function mediaTarget(
  state: LogLoadsDatabaseState,
  actor: SessionActor,
  organizationId: string,
  kind: MediaKind
): MediaTarget {
  if (!actor.driverProfileId) {
    throw new ApiError("Add a driver profile before uploading photos", 409)
  }

  try {
    return getDriverMediaTarget(state, {
      actorUserId: actor.profile.id,
      driverProfileId: actor.driverProfileId,
      kind,
      organizationId
    })
  } catch (error) {
    if (error instanceof DomainRefusalError) {
      throw error
    }

    throw new Error("The photo target could not be resolved", { cause: error })
  }
}

/**
 * Resolves the trip's document namespace, or refuses. Authorization is the
 * service's rule (participation in the trip, plus the action the access level
 * names). Typed refusals pass through to the one sanitized HTTP mapper.
 */
export function tripDocumentTarget(
  state: LogLoadsDatabaseState,
  actor: SessionActor,
  organizationId: string,
  tripId: string,
  access: TripDocumentAccess
): TripDocumentTarget {
  try {
    return getTripDocumentTarget(state, { actorUserId: actor.profile.id, organizationId, tripId }, access)
  } catch (error) {
    if (error instanceof DomainRefusalError) {
      throw error
    }

    throw new Error("The trip could not be resolved", { cause: error })
  }
}

/**
 * Signs one upload into the caller's exact namespace. Bucket policy is checked
 * before issuing the single-object token so a public, oversized, or broadened
 * bucket fails closed.
 */
export async function signedUpload(target: { publicIdPrefix: string }) {
  const { client, config } = supabaseStorage()
  const bucket = await client.storage.getBucket(config.bucket)
  const allowedMimeTypes = [...(bucket.data?.allowed_mime_types ?? [])].sort()

  if (
    bucket.error ||
    !bucket.data ||
    bucket.data.public ||
    !bucket.data.file_size_limit ||
    bucket.data.file_size_limit > MAX_MEDIA_BYTES ||
    JSON.stringify(allowedMimeTypes) !==
      JSON.stringify([...MEDIA_MIME_TYPES].sort())
  ) {
    throw new ApiError(MEDIA_UNAVAILABLE_MESSAGE, 503)
  }

  const publicId = `${target.publicIdPrefix}/uploads/${crypto.randomUUID()}`
  const { data, error } = await client.storage
    .from(config.bucket)
    .createSignedUploadUrl(publicId, { upsert: false })

  if (error || !data?.token) {
    throw new ApiError(MEDIA_UNAVAILABLE_MESSAGE, 503)
  }

  return {
    anonKey: config.anonKey,
    bucket: config.bucket,
    path: publicId,
    provider: "supabase" as const,
    publicId,
    supabaseUrl: config.url,
    token: data.token
  }
}

/**
 * The provider's own stored-at time, falling back to now when it is missing or
 * unparseable. `mediaReferenceSchema` demands a real timestamp, so a malformed
 * one would reject an asset that genuinely exists — the read-back moment is a
 * close enough truth to keep a driver's proof attachable.
 */
function assetCreatedAt(createdAt: unknown): string {
  const parsed = typeof createdAt === "string" ? new Date(createdAt) : null

  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
}

export async function verifiedMediaReference(publicId: string): Promise<MediaReference> {
  const { client, config } = supabaseStorage()
  const parts = publicId.split("/")
  const filename = parts.pop() ?? ""
  const directory = parts.join("/")
  const listed = await client.storage
    .from(config.bucket)
    .list(directory, { limit: 10, search: filename })
  const stored = listed.data?.find((candidate) => candidate.name === filename)
  const storedBytes = Number(stored?.metadata?.size)

  if (listed.error || !stored || !Number.isFinite(storedBytes)) {
    throw new ApiError("The uploaded photo could not be read back", 422)
  }

  if (storedBytes <= 0 || storedBytes > MAX_MEDIA_BYTES) {
    throw new ApiError("Photos must be 10 MB or smaller", 422)
  }

  const { data, error } = await client.storage
    .from(config.bucket)
    .download(publicId)

  if (error || !data) {
    throw new ApiError("The uploaded photo could not be read back", 422)
  }

  const bytes = new Uint8Array(await data.arrayBuffer())

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new ApiError("Photos must be 10 MB or smaller", 422)
  }

  if (bytes.byteLength !== storedBytes) {
    throw new ApiError("The uploaded photo could not be verified completely", 422)
  }

  let dimensions: ReturnType<typeof imageSize>

  try {
    dimensions = imageSize(bytes)
  } catch {
    throw new ApiError("Use a JPG, PNG, or WebP photo", 422)
  }

  const format = String(dimensions.type ?? "").toLowerCase()

  if (
    !["jpg", "jpeg", "png", "webp"].includes(format) ||
    !dimensions.width ||
    !dimensions.height
  ) {
    throw new ApiError("Use a JPG, PNG, or WebP photo", 422)
  }

  const uploadedAt = assetCreatedAt(stored.created_at)

  return {
    bytes: bytes.byteLength,
    format: format as MediaReference["format"],
    height: dimensions.height,
    provider: "supabase",
    publicId,
    uploadedAt,
    version: Math.max(1, Math.floor(Date.parse(uploadedAt) / 1000)),
    width: dimensions.width
  }
}

export async function signedDeliveryUrl(photo: MediaReference): Promise<string> {
  if (photo.provider !== "supabase") {
    throw new ApiError("This legacy file is not available", 404)
  }

  const { client, config } = supabaseStorage()
  const { data, error } = await client.storage
    .from(config.bucket)
    .createSignedUrl(photo.publicId, 300)

  if (error || !data?.signedUrl) {
    throw new ApiError(MEDIA_UNAVAILABLE_MESSAGE, 503)
  }

  return data.signedUrl
}

/**
 * Delivers a trip document as uploaded — no downscale, no re-encode, no
 * quality heuristic. A profile photo can be resized to fit a card; a scale
 * ticket is evidence, and the number the whole settlement turns on is printed
 * small. A derivative that dropped a digit would still look like a document.
 */
export async function signedDocumentUrl(media: MediaReference): Promise<string> {
  if (media.provider !== "supabase") {
    throw new ApiError("This legacy file is not available", 404)
  }

  const { client, config } = supabaseStorage()
  const { data, error } = await client.storage
    .from(config.bucket)
    .createSignedUrl(media.publicId, 300)

  if (error || !data?.signedUrl) {
    throw new ApiError(MEDIA_UNAVAILABLE_MESSAGE, 503)
  }

  return data.signedUrl
}
