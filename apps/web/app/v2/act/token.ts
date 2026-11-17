import "server-only"

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { ONE_TAP_ACTIONS, ONE_TAP_STATEMENT_VERSION, ONE_TAP_TTL_SECONDS, type OneTapAction } from "./statements"

/** Domain separation so this mac cannot be replayed as a session cookie or an unsubscribe link. Not a secret. */
export const ONE_TAP_PURPOSE = "logloads.one-tap.v1"

const CANNOT_MINT = "The one-tap link could not be created."
const uuid = z.string().uuid()
const PART = /^[A-Za-z0-9_-]+$/
/** A ready reply is one short message, not a letter, so the link stays a link. */
const MAX_BODY = 400
/** Email addresses, phone numbers and web links never ride on the page. */
const CONTACT = /@|(?:https?:\/\/|www\.)|(?:\+?\d[\d\s().-]{7,}\d)/i

function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code <= 31 || code === 127 || code === 38 || code === 60 || code === 62) return true
  }

  return false
}

export interface OneTapLink {
  action: OneTapAction
  expiresAt: number
  interestId: string | null
  jobId: string | null
  organizationId: string
  replyBody: string | null
  replyId: string | null
  statementVersion: string
  tokenId: string
  userId: string
}

export type OneTapRead = { ok: true; link: OneTapLink } | { ok: false; reason: "invalid" | "expired" }

export interface OneTapMint {
  action: OneTapAction
  interestId?: string | null
  jobId?: string | null
  organizationId: string
  replyBody?: string | null
  userId: string
}

export interface OneTapMintOptions {
  expiresAt?: Date
  replyId?: string
  tokenId?: string
}

function fail(): never {
  throw new Error(CANNOT_MINT)
}

function usableSecret(secret: string): boolean {
  return secret.length >= 16 && secret.trim() === secret
}

/**
 * The signing key. A dedicated secret wins. Otherwise the session secret is used with {@link ONE_TAP_PURPOSE},
 * so a link mac is not a session cookie. Production without either secret fails closed.
 */
export function oneTapSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const dedicated = env.LOGLOADS_ONE_TAP_SECRET?.trim() ?? ""
  const session = env.LOGLOADS_SESSION_SECRET?.trim() ?? ""
  const secret = dedicated.length >= 16 ? dedicated : session.length >= 16 ? session : ""

  if (secret) return secret
  if (env.NODE_ENV === "production") return null
  return "logloads-development-one-tap-secret"
}

function mac(secret: string, payload: Buffer): Buffer {
  return createHmac("sha256", secret).update(ONE_TAP_PURPOSE).update(payload).digest()
}

function macMatches(secret: string, payload: Buffer, given: Buffer): boolean {
  const expected = mac(secret, payload)
  const candidate = given.length === expected.length ? given : Buffer.alloc(expected.length)

  return timingSafeEqual(expected, candidate) && given.length === expected.length
}

function cleanBody(body: string | null | undefined, required: boolean): string | null {
  const text = body?.trim() ?? ""

  if (!text) {
    if (required) fail()
    return null
  }

  if (text.length > MAX_BODY || CONTACT.test(text) || hasControl(text)) fail()
  return text
}

function canonical(link: OneTapLink): string {
  return JSON.stringify({
    a: link.action,
    b: link.replyBody ?? "",
    e: link.expiresAt,
    i: link.interestId ?? "",
    j: link.jobId ?? "",
    o: link.organizationId,
    r: link.replyId ?? "",
    s: link.statementVersion,
    t: link.tokenId,
    u: link.userId,
    v: 1
  })
}

function assertBound(link: OneTapLink): void {
  if (!uuid.safeParse(link.userId).success || !uuid.safeParse(link.organizationId).success) fail()
  if (!uuid.safeParse(link.tokenId).success) fail()
  if (link.statementVersion !== ONE_TAP_STATEMENT_VERSION) fail()
  if (!(ONE_TAP_ACTIONS as readonly string[]).includes(link.action)) fail()

  const job = link.action !== "confirm_availability"
  const inquiry = link.action === "reply" || link.action === "decline"

  if (job) {
    if (!link.jobId || !uuid.safeParse(link.jobId).success) fail()
  } else if (link.jobId) {
    fail()
  }

  if (inquiry) {
    if (!link.interestId || !uuid.safeParse(link.interestId).success) fail()
  } else if (link.interestId) {
    fail()
  }

  if (link.action === "reply") {
    if (!link.replyBody || !link.replyId || !uuid.safeParse(link.replyId).success) fail()
  } else if (link.replyId) {
    fail()
  }

  if (link.action !== "reply" && link.action !== "decline" && link.replyBody) fail()
}

/**
 * A link for one person, one business and one action. Job actions are bound to one listing.
 * Availability is bound to the hauling business. The link expires within 72 hours and carries no address,
 * phone number or web link.
 */
export function signOneTapLink(mint: OneTapMint, secret: string, now: Date, options: OneTapMintOptions = {}): string {
  if (!usableSecret(secret) || Number.isNaN(now.getTime())) fail()

  const link: OneTapLink = {
    action: mint.action,
    expiresAt: 0,
    interestId: mint.interestId ?? null,
    jobId: mint.jobId ?? null,
    organizationId: mint.organizationId,
    replyBody: cleanBody(mint.replyBody, mint.action === "reply"),
    replyId: mint.action === "reply" ? options.replyId ?? randomUUID() : null,
    statementVersion: ONE_TAP_STATEMENT_VERSION,
    tokenId: options.tokenId ?? randomUUID(),
    userId: mint.userId
  }
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + ONE_TAP_TTL_SECONDS * 1000)
  const exp = Math.floor(expiresAt.getTime() / 1000)
  const nowSeconds = Math.floor(now.getTime() / 1000)

  link.expiresAt = exp
  assertBound(link)
  if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + ONE_TAP_TTL_SECONDS) fail()

  const payload = Buffer.from(canonical(link), "utf8")

  return `${payload.toString("base64url")}.${mac(secret, payload).toString("base64url")}`
}

function invalid(): OneTapRead {
  return { ok: false, reason: "invalid" }
}

function blank(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

/** Checks the signature before the expiry, so a tampered expired link is invalid, not expired. */
export function readOneTapLink(token: string, secret: string, now: Date): OneTapRead {
  if (!usableSecret(secret) || Number.isNaN(now.getTime()) || token.length < 3 || token.length > 2048) return invalid()

  const parts = token.split(".")

  if (parts.length !== 2 || !parts[0] || !parts[1] || !PART.test(parts[0]) || !PART.test(parts[1])) return invalid()

  const payload = Buffer.from(parts[0], "base64url")
  const given = Buffer.from(parts[1], "base64url")

  if (!macMatches(secret, payload, given)) return invalid()

  let parsed: unknown

  try {
    parsed = JSON.parse(payload.toString("utf8"))
  } catch {
    return invalid()
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid()

  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  const expected = ["a", "b", "e", "i", "j", "o", "r", "s", "t", "u", "v"]

  if (keys.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) return invalid()
  if (record.v !== 1 || typeof record.e !== "number" || !Number.isSafeInteger(record.e)) return invalid()
  if (typeof record.a !== "string" || typeof record.s !== "string") return invalid()

  const link: OneTapLink = {
    action: record.a as OneTapAction,
    expiresAt: record.e,
    interestId: blank(record.i),
    jobId: blank(record.j),
    organizationId: String(record.o),
    replyBody: blank(record.b),
    replyId: blank(record.r),
    statementVersion: record.s,
    tokenId: String(record.t),
    userId: String(record.u)
  }

  try {
    assertBound(link)
  } catch {
    return invalid()
  }

  if (link.expiresAt <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: "expired" }
  return { ok: true, link }
}

export function oneTapPagePath(token: string): string {
  return `/v2/act/${token}`
}

export function oneTapPressPath(token: string): string {
  return `/v2/act/${token}/press`
}
