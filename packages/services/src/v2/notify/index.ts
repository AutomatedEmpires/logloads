/**
 * notify (#253, #405): email rules. Resend may be called only for an address on the test-recipient list.
 * A commercial template cannot render without its footer. The text is built here, at send time, from facts
 * the worker just read. Nothing in this module reads the environment or the network.
 *
 * #405: the suppression list holds an HMAC of the address under a dedicated key (never a plain digest, and never the
 * session secret), and nothing is sent while that list cannot be checked. Names are cleaned of control characters and
 * of anything that looks like a phone number, an email address or a web link before they reach a subject or a body.
 * The urgency rule judges the fixed wording of a subject, not the names put into it.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

import {
  MARKETPLACE_EMAIL_TEMPLATE_CLASSES,
  RECONFIRM_STALE_DAYS,
  TEAM_INVITATION_SEND_CAP,
  type MarketplaceEmailAction,
  type MarketplaceEmailClass,
  type MarketplaceEmailFacts,
  type MarketplaceEmailFooter,
  type MarketplaceEmailTemplate
} from "@logloads/contracts"

export const RECONFIRM_STOP_SENTENCE =
  `If you stop these reminders, the listing goes stale and drops out of Find Work after ${RECONFIRM_STALE_DAYS} days.`

const URGENCY = /\b(?:urgent|hurry|act now|limited time|last chance)\b/i
const RE_PREFIX = /^\s*re\s*:/i
/** Email addresses, phone numbers and web links (the one-tap link's rule): a name that has one is not printed. */
const CONTACT = /@|(?:https?:\/\/|www\.)|(?:\+?\d[\d\s().-]{7,}\d)/i
const NAME_MAX = 80
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_SLOT = "{name}"

export type EmailSuppressReason =
  | "address"
  | "commercial-footer"
  | "invitation-cap"
  | "links"
  | "promotion"
  | "subject"
  | "suppressed"
  | "suppression-key"
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

/** The shortest key the address HMAC and the suppression link accept. */
export const EMAIL_SUPPRESSION_KEY_MIN_LENGTH = 32

const ADDRESS_PURPOSE = "logloads.email-address.v1"
const SUPPRESSION_PURPOSE = "logloads.email-suppression.v2"
const SUPPRESSION_TTL_SECONDS = 90 * 24 * 60 * 60

/** C0 and C1 controls, and the Unicode line and paragraph separators. Checked by code point, not by a regex. */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}

function hasControl(text: string): boolean {
  for (const char of text) {
    if (isControl(char.codePointAt(0) ?? 0)) return true
  }

  return false
}

function withoutControls(text: string): string {
  let out = ""

  for (const char of text) out += isControl(char.codePointAt(0) ?? 0) ? " " : char

  return out
}

/** A key is usable when it is long enough and has no surrounding whitespace. */
export function suppressionKeyUsable(key: string | null | undefined): key is string {
  return typeof key === "string" && key.length >= EMAIL_SUPPRESSION_KEY_MIN_LENGTH && key.trim() === key
}

/**
 * The suppression list's form of an address: HMAC-SHA-256 of the lower-cased address under the dedicated key. It does
 * not reverse against an address list without the key. Throws when the key is unusable.
 */
export function emailSuppressionHash(address: string, key: string): string {
  if (!suppressionKeyUsable(key)) throw new Error("The suppression key is not usable.")

  return createHmac("sha256", key).update(ADDRESS_PURPOSE).update("\u0000").update(normalizeAddress(address)).digest("hex")
}

/**
 * A link for an address that has no account. The token carries the keyed address hash and an expiry, never the
 * address. The same address, key and expiry always give the same token, so a re-sent email has the same body.
 */
export function signSuppressionToken(address: string, key: string, expiresAt: Date, now: Date): string {
  if (!suppressionKeyUsable(key)) throw new Error("The suppression link cannot be signed.")

  const exp = Math.floor(expiresAt.getTime() / 1000)
  const nowSeconds = Math.floor(now.getTime() / 1000)

  if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + SUPPRESSION_TTL_SECONDS) {
    throw new Error("The suppression link cannot be signed.")
  }

  const payload = Buffer.from(JSON.stringify({ e: exp, h: emailSuppressionHash(address, key), v: 2 }), "utf8")

  return `${payload.toString("base64url")}.${suppressionMac(key, payload).toString("base64url")}`
}

/** The keyed hash the token names, or null when the token is tampered, expired, of another key or not ours. */
export function readSuppressionToken(token: string, key: string, now: Date): string | null {
  if (!suppressionKeyUsable(key)) return null

  const parts = token.split(".")

  if (parts.length !== 2 || !parts[0] || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return null
  }

  const payload = Buffer.from(parts[0], "base64url")
  const given = Buffer.from(parts[1], "base64url")
  const expected = suppressionMac(key, payload)
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

  if (record.v !== 2 || typeof record.e !== "number" || typeof record.h !== "string" || !/^[0-9a-f]{64}$/.test(record.h)) return null
  if (record.e <= Math.floor(now.getTime() / 1000)) return null

  return record.h
}

function suppressionMac(key: string, payload: Buffer): Buffer {
  return createHmac("sha256", key).update(SUPPRESSION_PURPOSE).update(payload).digest()
}

/** The Resend Idempotency-Key for every send of one notice: stable across claims, retries and lease expiry. */
export function notificationIdempotencyKey(notificationId: string): string {
  if (!UUID.test(notificationId)) throw new Error("A notice id is a uuid.")

  return `logloads-notice/${notificationId.toLowerCase()}`
}

/**
 * A version-4-shaped uuid derived from a secret and a label. The worker uses it for one-tap token and reply ids, so
 * composing the same notice twice gives the same links.
 */
export function derivedUuid(secret: string, label: string): string {
  const bytes = createHmac("sha256", secret).update("logloads.derived-uuid.v1").update("\u0000").update(label).digest().subarray(0, 16)

  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = bytes.toString("hex")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function emailClass(template: MarketplaceEmailTemplate): MarketplaceEmailClass {
  return MARKETPLACE_EMAIL_TEMPLATE_CLASSES[template]
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

/** True when the address is on the test-recipient list. An empty list allows nobody. */
export function isTestRecipient(address: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeAddress(address)

  return normalized.includes("@") && allowlist.map(normalizeAddress).includes(normalized)
}

/**
 * A business, landing or job name as it may appear in an email: control characters become spaces, runs of space
 * collapse, and it is cut to 80 characters. A name that carries a phone number, an email address or a web link, or
 * that is empty, is null, and the template uses its nameless wording.
 */
export function cleanEmailName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  const text = Array.from(withoutControls(value).replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim()

  if (!text || CONTACT.test(text)) return null

  return text
}

/** The urgency and reply rules, applied to a subject's fixed wording. A name is `{name}` here. */
export function emailSubjectWordingAllowed(wording: string): boolean {
  return !RE_PREFIX.test(wording) && !URGENCY.test(wording.replaceAll(NAME_SLOT, " "))
}

export function planEmailDelivery(input: {
  facts: MarketplaceEmailFacts
  address: string
  allowlist: readonly string[]
  /** The durable list, read for this send: keyed hashes, and the key that made them. */
  suppression: { key: string; hashes: readonly string[] }
}): EmailDeliveryPlan {
  const address = normalizeAddress(input.address)

  if (!address.includes("@") || /\s/.test(address)) return { action: "suppress", reason: "address" }
  if (!suppressionKeyUsable(input.suppression.key)) return { action: "suppress", reason: "suppression-key" }
  if (input.suppression.hashes.includes(emailSuppressionHash(address, input.suppression.key))) return { action: "suppress", reason: "suppressed" }
  if (!isTestRecipient(address, input.allowlist)) return { action: "suppress", reason: "test-recipient" }
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
  if (rendered === "links") return { action: "suppress", reason: "links" }

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

/** An https link with no whitespace or control character in it, or null. */
function httpsLink(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  const url = value.trim()

  if (!url.startsWith("https://") || /\s/.test(url) || hasControl(url)) return null

  try {
    return new URL(url).protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function footerReady(footer: MarketplaceEmailFooter | null, commercial: boolean): footer is MarketplaceEmailFooter {
  if (!footer) return false
  if (!httpsLink(footer.unsubscribeUrl)) return false
  if (!commercial) return true

  return hasText(footer.legalName) && hasText(footer.reason) && /\d/.test(footer.postalAddress)
}

/** The subject's fixed wording, with `{name}` where a cleaned name goes, and the name itself. */
function subjectParts(facts: MarketplaceEmailFacts): { wording: string; name: string | null } {
  switch (facts.template) {
    case "team_invitation": {
      const name = cleanEmailName(facts.organizationName)
      return name ? { name, wording: `${NAME_SLOT} invited you on LogLoads` } : { name: null, wording: "You are invited to a business on LogLoads" }
    }
    case "inquiry_received": {
      const name = cleanEmailName(facts.organizationName)
      return name
        ? { name, wording: `${NAME_SLOT} sent interest in your job on LogLoads` }
        : { name: null, wording: "A hauler sent interest in your job on LogLoads" }
    }
    case "inquiry_reply":
      return { name: null, wording: "A reply is waiting on LogLoads" }
    case "job_alert":
      return { name: null, wording: "A job matches a search you saved" }
    case "targeted_invitation": {
      const name = cleanEmailName(facts.landingName)
      return name ? { name, wording: `${NAME_SLOT} has a job on LogLoads` } : { name: null, wording: "A landing has a job for you on LogLoads" }
    }
    case "reconfirm_reminder":
      return { name: null, wording: "Please reconfirm a job you posted" }
  }
}

function readyReplyLines(facts: MarketplaceEmailFacts): string[] {
  const lines: string[] = []

  for (const action of (facts.readyReplies ?? []).slice(0, 3) as readonly MarketplaceEmailAction[]) {
    const label = cleanEmailName(action.label)
    const url = httpsLink(action.url)

    if (label && url) lines.push(label, url)
  }

  return lines.length ? ["", "Reply with one tap. Opening a link changes nothing until you press Send reply.", ...lines] : []
}

function bodyFor(facts: MarketplaceEmailFacts, footer: MarketplaceEmailFooter, inquiryUrl: string | null): string {
  const lines: string[] = []

  switch (facts.template) {
    case "team_invitation":
      lines.push("Someone at a business you work with asked LogLoads to send you this invitation.")
      lines.push("Use the link below if you do not want email about it again.")
      break
    case "inquiry_received": {
      const hauler = cleanEmailName(facts.organizationName)
      const title = cleanEmailName(facts.jobTitle)
      const who = hauler ?? "A hauling business"

      lines.push(title ? `${who} sent interest in your job: ${title}.` : `${who} sent interest in your job.`)
      lines.push(...readyReplyLines(facts))
      break
    }
    case "inquiry_reply":
      lines.push("A reply is waiting in your LogLoads inquiries.")
      break
    case "job_alert":
      lines.push("A job matches a search you saved on LogLoads.")
      break
    case "targeted_invitation": {
      const landing = cleanEmailName(facts.landingName)

      lines.push("LogLoads is sending this.")
      lines.push(landing ? `${landing} asked LogLoads to tell you about one job.` : "A landing asked LogLoads to tell you about one job.")
      lines.push("Unsubscribing stops every invitation, not only this one.")
      break
    }
    case "reconfirm_reminder":
      lines.push("A job you posted is due to be reconfirmed.")
      lines.push(RECONFIRM_STOP_SENTENCE)
      break
  }

  if (inquiryUrl) lines.push("", "Open the inquiry:", inquiryUrl)

  if (emailClass(facts.template) === "commercial") {
    lines.push("", footer.legalName.trim(), footer.postalAddress.trim(), footer.reason.trim())
  }

  lines.push("", footer.unsubscribeUrl.trim())

  return lines.join("\n")
}

function render(facts: MarketplaceEmailFacts): { subject: string; text: string; unsubscribeUrl: string } | "footer" | "links" | "subject" {
  const commercial = emailClass(facts.template) === "commercial"

  if (!footerReady(facts.footer, commercial) || !facts.footer) return "footer"

  const inquiryUrl = facts.template === "inquiry_received" || facts.template === "inquiry_reply" ? httpsLink(facts.inquiryUrl) : null

  if (facts.template === "inquiry_received" && !inquiryUrl) return "links"

  const parts = subjectParts(facts)
  const subject = parts.name ? parts.wording.replace(NAME_SLOT, parts.name) : parts.wording

  if (!emailSubjectWordingAllowed(parts.wording) || RE_PREFIX.test(subject)) return "subject"

  return { subject, text: bodyFor(facts, facts.footer, inquiryUrl), unsubscribeUrl: facts.footer.unsubscribeUrl.trim() }
}

