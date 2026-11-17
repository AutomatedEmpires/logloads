import { parseTestRecipients } from "@logloads/services"

interface EmailEnv {
  LOGLOADS_EMAIL_TEST_RECIPIENTS?: string
  LOGLOADS_LEGAL_NAME?: string
  LOGLOADS_POSTAL_ADDRESS?: string
  LOGLOADS_SESSION_SECRET?: string
}

/** What an operator sets before any email can leave. An empty allowlist means nobody is a test recipient. */
export function emailDeliveryConfig(given?: EmailEnv): {
  allowlist: readonly string[]
  legalName: string
  postalAddress: string
  secret: string
} {
  const env = given ?? process.env

  return {
    allowlist: parseTestRecipients(env.LOGLOADS_EMAIL_TEST_RECIPIENTS),
    legalName: env.LOGLOADS_LEGAL_NAME?.trim() ?? "",
    postalAddress: env.LOGLOADS_POSTAL_ADDRESS?.trim() ?? "",
    secret: env.LOGLOADS_SESSION_SECRET?.trim() ?? ""
  }
}
