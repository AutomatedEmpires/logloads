import "server-only"

import { v2 as cloudinary } from "cloudinary"
import type { LogLoadsDatabaseState } from "@logloads/db"
import type { MediaReference } from "@logloads/contracts"
import { getDriverMediaTarget, type DriverMediaTarget } from "@logloads/services"

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
    throw new ApiError("Photo uploads are not activated for this environment", 503)
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

export function signedUpload(target: MediaTarget) {
  const config = environment()
  const timestamp = Math.floor(Date.now() / 1000)
  const publicId = `${target.publicIdPrefix}/uploads/${crypto.randomUUID()}`
  const parameters = {
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
    uploadedAt: new Date().toISOString(),
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
