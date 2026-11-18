/**
 * notify (#253): email rules. Resend may be called only for an address on the test-recipient list.
 * A commercial template cannot render without its footer. The text is built here, at send time, from facts
 * the worker just read. Nothing in this module reads the environment or the network.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import {
  MARKETPLACE_EMAIL_TEMPLATE_CLASSES,
  RECONFIRM_STALE_DAYS,
  TEAM_INVITATION_SEND_CAP,
  type MarketplaceEmailClass,
  type MarketplaceEmailFacts,
  type MarketplaceEmailFooter,
  type MarketplaceEmailTemplate
} from "@logloads/contracts"

export const RECONFIRM_STOP_SENTENCE =
  `If you stop these reminders, the listing goes stale and drops out of Find Work after ${RECONFIRM_STALE_DAYS} days.`

const URGENCY = /\b(?:urgent|hurry|act now|limited time|last chance)\b/i
const RE_PREFIX = /^\s*re\s*:/i

export type EmailSuppressReason =
  | "address"
  | "commercial-footer"
  | "invitation-cap"
  | "promotion"
  | "subject"
  | "suppressed"
  | "test-recipient"
  | "unsubscribe"

export interface EmailSendMessage {
  to: string
  subject: string
  text: string
  listUnsubscribe: string
  listUnsubscribePost: "List-Unsubscribe=One-Click"
}

export type EmailDeliveryPlan =
  | { action: "suppress"; reason: EmailSuppressReason }
  | { action: "send"; message: EmailSendMessage }

const SUPPRESSION_PURPOSE = "logloads.email-suppression.v1"
const SUPPRESSION_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * A link for an address that has no account. The token carries the address hash and an expiry, never the address.
 * The mac uses a distinct purpose, so it is not a session cookie even when the session secret signs it.
 */
export function signSuppressionToken(address: string, secret: string, expiresAt: Date, now: Date): string {
  if (secret.trim().length < 16 || secret !== secret.trim()) throw new Error("The suppression link cannot be signed.")

  const exp = Math.floor(expiresAt.getTime() / 1000)
  const nowSeconds = Math.floor(now.getTime() / 1000)

  if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + SUPPRESSION_TTL_SECONDS) {
    throw new Error("The suppression link cannot be signed.")
  }

  const payload = Buffer.from(JSON.stringify({ e: exp, h: emailSuppressionHash(address), v: 1 }), "utf8")

  return `${payload.toString("base64url")}.${suppressionMac(secret, payload).toString("base64url")}`
}

/** The hash the token names, or null when the token is tampered, expired or not ours. */
export function readSuppressionToken(token: string, secret: string, now: Date): string | null {
  if (secret.trim().length < 16) return null

  const parts = token.split(".")

  if (parts.length !== 2 || !parts[0] || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return null
  }

  const payload = Buffer.from(parts[0], "base64url")
  const given = Buffer.from(parts[1], "base64url")
  const expected = suppressionMac(secret, payload)
  const candidate = given.length === expected.length ? given : Buffer.alloc(expected.length)

  if (!timingSafeEqual(expected, candidate) || given.length !== expected.length) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(payload.toString("utf8"))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>

  if (record.v !== 1 || typeof record.e !== "number" || typeof record.h !== "string" || !/^[0-9a-f]{64}$/.test(record.h)) return null
  if (record.e <= Math.floor(now.getTime() / 1000)) return null

  return record.h
}

function suppressionMac(secret: string, payload: Buffer): Buffer {
  return createHmac("sha256", secret).update(SUPPRESSION_PURPOSE).update(payload).digest()
}

export function emailClass(template: MarketplaceEmailTemplate): MarketplaceEmailClass {
  return MARKETPLACE_EMAIL_TEMPLATE_CLASSES[template]
}

/** Lower-case the address and hash it. The list stores the hash, never the address. */
export function emailSuppressionHash(address: string): string {
  return createHash("sha256").update(normalizeAddress(address)).digest("hex")
}

/** Comma-separated allowlist. Blank entries are dropped. An empty list allows nobody. */
export function parseTestRecipients(list: string | null | undefined): string[] {
  if (!list) return []

  const seen = new Set<string>()

  for (const part of list.split(",")) {
    const address = normalizeAddress(part)

    if (address.includes("@")) seen.add(address)
  }

  return [...seen]
}

export function planEmailDelivery(input: {
  facts: MarketplaceEmailFacts
  address: string
  allowlist: readonly string[]
  suppressedHashes: readonly string[]
}): EmailDeliveryPlan {
  const address = normalizeAddress(input.address)

  if (!address.includes("@") || /\s/.test(address)) return { action: "suppress", reason: "address" }
  if (input.suppressedHashes.includes(emailSuppressionHash(address))) return { action: "suppress", reason: "suppressed" }
  if (!input.allowlist.map(normalizeAddress).includes(address)) return { action: "suppress", reason: "test-recipient" }
  if (input.facts.template === "team_invitation" && !withinInvitationCap(input.facts.invitationSendCount)) {
    return { action: "suppress", reason: "invitation-cap" }
  }
  if (input.facts.template === "reconfirm_reminder" && hasText(input.facts.promotion)) {
    return { action: "suppress", reason: "promotion" }
  }

  const rendered = render(input.facts)

  if (rendered === "footer") {
    return { action: "suppress", reason: emailClass(input.facts.template) === "commercial" ? "commercial-footer" : "unsubscribe" }
  }

  if (rendered === "subject") return { action: "suppress", reason: "subject" }

  return {
    action: "send",
    message: {
      listUnsubscribe: `<${rendered.unsubscribeUrl}>`,
      listUnsubscribePost: "List-Unsubscribe=One-Click",
      subject: rendered.subject,
      text: rendered.text,
      to: address
    }
  }
}

/**
 * The Find Trucks matcher stays off while its category is unsupported. Email delivery still runs.
 * Alerts are in the app or by email only; this function has no SMS path.
 */
export async function runNotificationPass(input: {
  truckAlertsSupported: boolean
  deliver: () => Promise<void>
  matchTruckAlerts: () => Promise<void>
}): Promise<void> {
  await input.deliver()

  if (input.truckAlertsSupported) await input.matchTruckAlerts()
}

function withinInvitationCap(sendCount: number | null): boolean {
  return sendCount !== null && Number.isInteger(sendCount) && sendCount >= 1 && sendCount <= TEAM_INVITATION_SEND_CAP
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim())
}

function footerReady(footer: MarketplaceEmailFooter | null, commercial: boolean): footer is MarketplaceEmailFooter {
  if (!footer) return false
  if (!hasText(footer.unsubscribeUrl) || !footer.unsubscribeUrl.trim().startsWith("https://")) return false
  if (!commercial) return true

  return hasText(footer.legalName) && hasText(footer.reason) && /\d/.test(footer.postalAddress)
}

function subjectFor(facts: MarketplaceEmailFacts): string {
  switch (facts.template) {
    case "team_invitation":
      return hasText(facts.organizationName)
        ? `${facts.organizationName?.trim()} invited you on LogLoads`
        : "You are invited to a business on LogLoads"
    case "inquiry_reply":
      return "A reply is waiting on LogLoads"
    case "job_alert":
      return "A job matches a search you saved"
    case "targeted_invitation":
      return hasText(facts.landingName)
        ? `${facts.landingName?.trim()} has a job on LogLoads`
        : "A landing has a job for you on LogLoads"
    case "reconfirm_reminder":
      return "Please reconfirm a job you posted"
  }
}

function bodyFor(facts: MarketplaceEmailFacts, footer: MarketplaceEmailFooter): string {
  const lines: string[] = []

  switch (facts.template) {
    case "team_invitation":
      lines.push("Someone at a business you work with asked LogLoads to send you this invitation.")
      lines.push("Use the link below if you do not want email about it again.")
      break
    case "inquiry_reply":
      lines.push("A reply is waiting in your LogLoads inquiries.")
      break
    case "job_alert":
      lines.push("A job matches a search you saved on LogLoads.")
      break
    case "targeted_invitation":
      lines.push("LogLoads is sending this.")
      lines.push(hasText(facts.landingName)
        ? `${facts.landingName?.trim()} asked LogLoads to tell you about one job.`
        : "A landing asked LogLoads to tell you about one job.")
      lines.push("Unsubscribing stops every invitation, not only this one.")
      break
    case "reconfirm_reminder":
      lines.push("A job you posted is due to be reconfirmed.")
      lines.push(RECONFIRM_STOP_SENTENCE)
      break
  }

  if (emailClass(facts.template) === "commercial") {
    lines.push("", footer.legalName.trim(), footer.postalAddress.trim(), footer.reason.trim())
  }

  lines.push("", footer.unsubscribeUrl.trim())

  return lines.join("\n")
}

function render(facts: MarketplaceEmailFacts): { subject: string; text: string; unsubscribeUrl: string } | "footer" | "subject" {
  const commercial = emailClass(facts.template) === "commercial"

  if (!footerReady(facts.footer, commercial) || !facts.footer) return "footer"

  const subject = subjectFor(facts)

  if (RE_PREFIX.test(subject) || URGENCY.test(subject)) return "subject"

  return { subject, text: bodyFor(facts, facts.footer), unsubscribeUrl: facts.footer.unsubscribeUrl.trim() }
}
