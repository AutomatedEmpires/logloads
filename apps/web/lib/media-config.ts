import "server-only"

export const DEDICATED_CLOUDINARY_TENANCY = "dedicated"

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export interface DedicatedCloudinaryConfiguration {
  apiKey: string
  apiSecret: string
  cloudName: string
}

function trimmedValue(value: string | undefined): string | null {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

/**
 * Reads the complete, explicitly attested media configuration without touching
 * the provider. The tenancy marker is intentionally exact: trimming or folding
 * its case would turn an operator typo into provider activation.
 */
export function dedicatedCloudinaryConfiguration(
  environment: RuntimeEnvironment
): DedicatedCloudinaryConfiguration | null {
  if (environment.LOGLOADS_CLOUDINARY_TENANCY !== DEDICATED_CLOUDINARY_TENANCY) {
    return null
  }

  const cloudName = trimmedValue(environment.CLOUDINARY_CLOUD_NAME)
  const apiKey = trimmedValue(environment.CLOUDINARY_API_KEY)
  const apiSecret = trimmedValue(environment.CLOUDINARY_API_SECRET)

  if (!cloudName || !apiKey || !apiSecret) {
    return null
  }

  return { apiKey, apiSecret, cloudName }
}

export function isDedicatedMediaConfigured(environment: RuntimeEnvironment): boolean {
  return dedicatedCloudinaryConfiguration(environment) !== null
}
