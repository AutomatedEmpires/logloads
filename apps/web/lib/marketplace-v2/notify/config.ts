import { parseTestRecipients } from "@logloads/services"

import { resolvePublicAppUrl } from "../../app-url"

interface EmailEnv {
  LOGLOADS_EMAIL_FROM?: string
  LOGLOADS_EMAIL_SUPPRESSION_KEY?: string
  LOGLOADS_EMAIL_TEST_RECIPIENTS?: string
  LOGLOADS_LEGAL_NAME?: string
  LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL?: string
  LOGLOADS_POSTAL_ADDRESS?: string
  NEXT_PUBLIC_APP_URL?: string
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  RESEND_WEBHOOK_SECRET?: string
  VERCEL_URL?: string
}

export interface EmailDeliveryConfig {
  /** Test recipients. An empty list means nobody is a test recipient, so nothing is sent. */
  allowlist: readonly string[]
  apiKey: string
  from: string
  legalName: string
  /** The https origin links point at, or null when the app has no https origin (local development). */
  origin: string | null
  postalAddress: string
  /** The dedicated HMAC key for the suppression list and the no-account link. Never the session secret. */
  suppressionKey: string
  /** The provider webhook's signing secret (Svix `whsec_...`). */
  webhookSecret: string
  /** A login role that can become only service_role, for the worker's calls. */
  workerDatabaseUrl: string
}

function httpsOrigin(env: EmailEnv): string | null {
  try {
    const origin = resolvePublicAppUrl({ NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL, VERCEL_URL: env.VERCEL_URL })

    return origin.startsWith("https://") ? origin : null
  } catch {
    return null
  }
}

/**
 * What an operator sets before any email can leave. Values are read here and handed to the worker; nothing logs them.
 * An empty allowlist means nobody is a test recipient.
 */
export function emailDeliveryConfig(given?: EmailEnv): EmailDeliveryConfig {
  const env: EmailEnv = given ?? (process.env as EmailEnv)

  return {
    allowlist: parseTestRecipients(env.LOGLOADS_EMAIL_TEST_RECIPIENTS),
    apiKey: env.RESEND_API_KEY?.trim() ?? "",
    from: env.RESEND_FROM?.trim() || env.LOGLOADS_EMAIL_FROM?.trim() || "",
    legalName: env.LOGLOADS_LEGAL_NAME?.trim() ?? "",
    origin: httpsOrigin(env),
    postalAddress: env.LOGLOADS_POSTAL_ADDRESS?.trim() ?? "",
    suppressionKey: env.LOGLOADS_EMAIL_SUPPRESSION_KEY ?? "",
    webhookSecret: env.RESEND_WEBHOOK_SECRET?.trim() ?? "",
    workerDatabaseUrl: env.LOGLOADS_NORMALIZED_EMAIL_WORKER_DATABASE_URL?.trim() ?? ""
  }
}
