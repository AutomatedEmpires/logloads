import "server-only"

import { v2 as cloudinary } from "cloudinary"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { tripDocumentSchema, type MediaReference, type TripDocument } from "@logloads/contracts"
import {
  getDriverMediaTarget,
  getTripDocumentTarget,
  type DriverMediaTarget,
  type TripDocumentAccess,
  type TripDocumentTarget
} from "@logloads/services"

import { ApiError } from "./api-actor"
import type { SessionActor } from "./session"

export const MEDIA_KINDS = ["profile", "truck", "trailer"] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

interface CloudinaryEnvironment {
  apiKey: string
  apiSecret: string
  cloudName: string
}

export type MediaTarget = DriverMediaTarget

function environment(): CloudinaryEnvironment {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError("File uploads are not activated for this environment", 503)
  }

  cloudinary.config({ api_key: apiKey, api_secret: apiSecret, cloud_name: cloudName, secure: true })
  return { apiKey, apiSecret, cloudName }
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
    const message = error instanceof Error ? error.message : "The photo target could not be resolved"
    const status = message.includes("member") || message.includes("own driver") ? 403 : 409

    throw new ApiError(message, status)
  }
}

/**
 * Resolves the trip's document namespace, or refuses. Authorization is the
 * service's rule (participation in the trip, plus the action the access level
 * names) — this only maps the refusal onto an HTTP status.
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
    const message = error instanceof Error ? error.message : "The trip could not be resolved"
    const status = message.includes("not a participant") || message.includes("cannot") ? 403 : 404

    throw new ApiError(message, status)
  }
}

/**
 * Signs an upload into one namespace, in one of three formats. The prefix bounds
 * where a caller may write; `allowed_formats` bounds what, so a participant who
 * drives the signature directly cannot park arbitrary bytes in an account shared
 * with every other product. Cloudinary reports a JPEG as `jpg`, so the list
 * carries no `jpeg`. `max_file_size` is not an upload parameter, and Cloudinary
 * omits parameters it does not know from its own string-to-sign — signing one
 * fails every upload with 401 Invalid Signature. Size is still rechecked on
 * read-back before writing a record.
 */
export function signedUpload(target: { publicIdPrefix: string }) {
  const config = environment()
  const timestamp = Math.floor(Date.now() / 1000)
  const publicId = `${target.publicIdPrefix}/uploads/${crypto.randomUUID()}`
  const parameters = {
    allowed_formats: "jpg,png,webp",
    overwrite: "false",
    public_id: publicId,
    timestamp,
    type: "authenticated"
  }

  return {
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    parameters,
    signature: cloudinary.utils.api_sign_request(parameters, config.apiSecret),
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`
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
  environment()
  const asset = await cloudinary.api.resource(publicId, { resource_type: "image", type: "authenticated" })
  const format = String(asset.format ?? "").toLowerCase()

  if (!["jpg", "jpeg", "png", "webp"].includes(format)) {
    throw new ApiError("Use a JPG, PNG, or WebP photo", 422)
  }

  if (!asset.bytes || asset.bytes > 10_000_000) {
    throw new ApiError("Photos must be 10 MB or smaller", 422)
  }

  return {
    bytes: asset.bytes,
    format: format as MediaReference["format"],
    height: asset.height,
    provider: "cloudinary",
    publicId: asset.public_id,
    // When the asset was stored, per the provider that stored it — not when we
    // got around to reading it back. Trip documents sort on this, and a retried
    // attach would otherwise date a ticket to the retry rather than the scale.
    uploadedAt: assetCreatedAt(asset.created_at),
    version: asset.version,
    width: asset.width
  }
}

export function signedDeliveryUrl(photo: MediaReference): string {
  environment()

  return cloudinary.url(photo.publicId, {
    crop: "limit",
    fetch_format: "auto",
    format: photo.format,
    height: 900,
    quality: "auto",
    secure: true,
    sign_url: true,
    type: "authenticated",
    version: photo.version,
    width: 900
  })
}

/**
 * Delivers a trip document as uploaded — no downscale, no re-encode, no
 * quality heuristic. A profile photo can be resized to fit a card; a scale
 * ticket is evidence, and the number the whole settlement turns on is printed
 * small. A derivative that dropped a digit would still look like a document.
 */
export function signedDocumentUrl(media: MediaReference): string {
  environment()

  return cloudinary.url(media.publicId, {
    format: media.format,
    secure: true,
    sign_url: true,
    type: "authenticated",
    version: media.version
  })
}
