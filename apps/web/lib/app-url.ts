export interface PublicAppUrlEnvironment {
  NEXT_PUBLIC_APP_URL?: string
  VERCEL_URL?: string
}

function originFromUrl(value: string, requireHttps: boolean): string {
  const parsed = new URL(value)

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("The public app URL must use HTTP or HTTPS")
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error("The Vercel deployment URL must use HTTPS")
  }

  return parsed.origin
}

export function resolvePublicAppUrl(
  environment?: PublicAppUrlEnvironment
): string {
  const resolvedEnvironment = environment ?? {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_URL: process.env.VERCEL_URL
  }
  const configured = resolvedEnvironment.NEXT_PUBLIC_APP_URL?.trim()

  if (configured) {
    return originFromUrl(configured, false)
  }

  const vercelUrl = resolvedEnvironment.VERCEL_URL?.trim()

  if (vercelUrl) {
    const absoluteVercelUrl = /^https?:\/\//i.test(vercelUrl)
      ? vercelUrl
      : `https://${vercelUrl}`

    return originFromUrl(absoluteVercelUrl, true)
  }

  return "http://localhost:3002"
}
