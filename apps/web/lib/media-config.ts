import "server-only"

/**
 * LogLoads stores new private media only in its own Supabase project.
 *
 * Cloudinary names remain parseable in historical records, but no Cloudinary
 * runtime configuration is accepted here. This negative fence prevents a stale
 * machine or deployment variable from silently reviving the retired provider.
 */

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export interface DedicatedSupabaseMediaConfiguration {
  anonKey: string
  bucket: string
  serviceRoleKey: string
  url: string
}

function trimmedValue(value: string | undefined): string | null {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

function hasForbiddenCloudinaryConfiguration(
  environment: RuntimeEnvironment
): boolean {
  return Object.entries(environment).some(
    ([name, value]) =>
      (
        name.startsWith("CLOUDINARY_") ||
        name.startsWith("LOGLOADS_CLOUDINARY_")
      ) &&
      trimmedValue(value) !== null
  )
}

export function dedicatedSupabaseMediaConfiguration(
  environment: RuntimeEnvironment
): DedicatedSupabaseMediaConfiguration | null {
  if (hasForbiddenCloudinaryConfiguration(environment)) {
    return null
  }

  if (environment.LOGLOADS_MEDIA_STORAGE?.trim().toLowerCase() !== "supabase") {
    return null
  }

  const url = trimmedValue(environment.SUPABASE_URL)
  const serviceRoleKey = trimmedValue(environment.SUPABASE_SERVICE_ROLE_KEY)
  const anonKey =
    trimmedValue(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    trimmedValue(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const bucket = trimmedValue(environment.LOGLOADS_MEDIA_BUCKET)
  const expectedProjectRef = trimmedValue(
    environment.LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF
  )

  if (!url || !serviceRoleKey || !anonKey || !bucket || !expectedProjectRef) {
    return null
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(bucket)) {
    return null
  }

  try {
    const parsed = new URL(url)
    const configuredProjectRef = parsed.hostname.split(".")[0]

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".supabase.co") ||
      configuredProjectRef !== expectedProjectRef
    ) {
      return null
    }
  } catch {
    return null
  }

  return {
    anonKey,
    bucket,
    serviceRoleKey,
    url: url.replace(/\/$/, "")
  }
}

export function isDedicatedMediaConfigured(
  environment: RuntimeEnvironment
): boolean {
  return dedicatedSupabaseMediaConfiguration(environment) !== null
}
