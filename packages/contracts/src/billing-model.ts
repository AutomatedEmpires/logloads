import { z } from "zod"

/**
 * The LogLoads platform fee, as arithmetic and nothing else.
 *
 * WHAT IS BEING CHARGED. A host posts a load and states what it pays the driver.
 * LogLoads charges the HOST a percentage of that stated driver pay, ON TOP of it,
 * and only once the load is completed. The driver is paid exactly the number the
 * host stated; nothing in this module, and nothing built on it, may ever return
 * `driverPay - fee`. That is why `hostChargeBreakdown` hands back all three
 * figures together: a surface that wants to show "the fee" gets the driver's
 * untouched number in the same object, so there is no path where a fee looks like
 * a deduction.
 *
 * WHY IT IS PURE. Every value comes in as an argument. The same functions answer
 * for the accrual mutation (which writes the ledger), the host's invoice (which
 * bills it) and the posting form (which quotes it before anything is charged).
 * There must never be a second implementation: a quote that disagrees with the
 * bill is a lie told to the host, and a fee recomputed at read time is a bill that
 * silently restates itself when the rate changes.
 *
 * WHY IT IS IN CONTRACTS, NOT IN A SERVICE. These are the rules the product is
 * held to, so they are readable, exported, and individually tested. A rule that
 * lives as a private helper inside a service is a rule that changes without
 * anybody noticing.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It never touches state, Stripe, or a
 * clock. It holds no notion of holding, escrowing, routing or paying out driver
 * funds, because LogLoads does not do that: driver money moves host → driver
 * directly and off-platform, and only its status is ever recorded here.
 */

// ── The rate ──────────────────────────────────────────────────────────────────

/**
 * The only currency grandfathered `legacy_percentage` work may accept, accrue,
 * or collect. LogLoads performs no FX conversion on those obligations.
 *
 * This policy belongs beside the legacy fee contract so every boundary shares
 * one decision instead of independently assuming that Stripe charges are USD.
 */
export const LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY = "USD"

/**
 * Basis points per whole. 500 bps = 5%, 10_000 bps = 100%.
 *
 * Exported so the schema bound, the arithmetic guard and any future rate share one
 * definition instead of three hand-typed 10_000s.
 */
export const FEE_BPS_SCALE = 10_000

/**
 * The founder-decided platform fee: a flat 5% of stated driver pay, charged to the
 * host on top, on completed loads only. There is no monthly minimum and no charge
 * to post; drivers pay nothing, ever.
 *
 * Flat rather than tiered on purpose: load *count* is a host-controlled field in
 * this product (a host decides how many slots a series has), so any count-based
 * tier is gameable by construction, and a graduated tier re-rates every other load
 * in a period the moment one load is voided.
 *
 * This constant is the CURRENT rate. It is never the rate of a load that already
 * happened — every accrual freezes its own `feeBps`, so changing this number
 * cannot re-rate history.
 */
export const PLATFORM_FEE_BPS = 500

/**
 * The fee rate an accepted assignment actually authorized.
 *
 * A number alone is not authority to accrue or collect money. Historical
 * snapshots can retain a proposed rate after collection was disabled, and the
 * canonical state is provider data that may be malformed. Every billing
 * boundary therefore shares this one fail-closed predicate: the collection
 * state must be authoritative and the rate must be an exact, bounded integer.
 */
export function frozenPlatformFeeBps(termsSnapshot: unknown): number | null {
  if (
    !termsSnapshot ||
    typeof termsSnapshot !== "object" ||
    Array.isArray(termsSnapshot)
  ) {
    return null
  }

  const hostFee = (termsSnapshot as Record<string, unknown>).hostFee

  if (!hostFee || typeof hostFee !== "object" || Array.isArray(hostFee)) {
    return null
  }

  const acceptedHostFee = hostFee as Record<string, unknown>
  const rateBps = acceptedHostFee.rateBps

  if (acceptedHostFee.collectionState !== "accrues_monthly_in_arrears") {
    return null
  }

  return (
    typeof rateBps === "number" &&
    Number.isSafeInteger(rateBps) &&
    rateBps >= 0 &&
    rateBps <= FEE_BPS_SCALE
  )
    ? rateBps
    : null
}

// ── Ledger states ─────────────────────────────────────────────────────────────

/**
 * The life of one accrued fee.
 *
 * `voided` exists instead of a delete: the row is the evidence that a charge was
 * raised and withdrawn, and money the host was told about must stay auditable.
 */
export const platformFeeEventStatusSchema = z.enum(["accrued", "invoiced", "voided"])

/** A monthly bill. Mirrors the Stripe invoice states LogLoads actually uses. */
export const hostInvoiceStatusSchema = z.enum([
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void"
])

/**
 * Whether a legacy_percentage host has a card on file. `attached` gates new
 * legacy work whose frozen terms will accrue the percentage fee. Subscription
 * publishing is free and uses its own agreement/payment state; a missing legacy
 * card must never become a universal publishing block.
 */
export const hostBillingProfileStatusSchema = z.enum(["none", "attached", "failed"])

export type PlatformFeeEventStatus = z.infer<typeof platformFeeEventStatusSchema>
export type HostInvoiceStatus = z.infer<typeof hostInvoiceStatusSchema>
export type HostBillingProfileStatus = z.infer<typeof hostBillingProfileStatusSchema>

// ── Fee arithmetic ────────────────────────────────────────────────────────────

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative whole number of cents, received ${String(value)}`
    )
  }
}

function assertFeeBps(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > FEE_BPS_SCALE) {
    throw new Error(
      `feeBps must be a whole number between 0 and ${FEE_BPS_SCALE}, received ${String(value)}`
    )
  }
}

/**
 * The fee on one completed load, in whole cents.
 *
 * ROUNDING RULE: half-up. `feeCents = floor(driverPayCents * feeBps / 10_000)`,
 * plus one cent when the discarded remainder is half a cent or more. On an exact
 * half-cent the host pays the extra cent — stated here so nobody has to infer it,
 * and so the direction is a decision rather than an accident of whichever
 * language primitive got used. 5% of $525.00 is 2625c exactly; 5% of $99.99 is
 * 499.95c and bills as 500c.
 *
 * The arithmetic is integer-only. `remainder` and `scaled - remainder` are exact,
 * and an exact multiple of 10_000 divided by 10_000 is exact, so no float rounding
 * can move a cent. Money is never a float in this system.
 *
 * Bad input is refused rather than coerced: a fractional or negative pay figure
 * reaching a fee calculation means something upstream is broken, and quietly
 * rounding it would bill a host for a number nobody ever agreed to.
 */
export function computePlatformFeeCents(driverPayCents: number, feeBps: number): number {
  assertCents(driverPayCents, "driverPayCents")
  assertFeeBps(feeBps)

  const scaled = driverPayCents * feeBps

  if (!Number.isSafeInteger(scaled)) {
    throw new Error(
      `driverPayCents ${driverPayCents} at ${feeBps} bps exceeds exact integer arithmetic`
    )
  }

  const remainder = scaled % FEE_BPS_SCALE
  const whole = (scaled - remainder) / FEE_BPS_SCALE

  // remainder * 2 >= scale is "remainder >= half a cent" without dividing.
  return remainder * 2 >= FEE_BPS_SCALE ? whole + 1 : whole
}

export interface HostChargeBreakdown {
  /** Exactly what the host stated the load pays the driver. Never reduced here. */
  driverPayCents: number
  /** What LogLoads charges the host, on top. */
  platformFeeCents: number
  /** driverPayCents + platformFeeCents. The host's total cost of the load. */
  hostTotalCents: number
}

/**
 * The three numbers every host-facing surface must show together.
 *
 * One helper rather than per-surface arithmetic, so the pay figure, the fee and
 * the total can never disagree between the posting form, the load detail and the
 * invoice. `hostTotalCents` is an addition — there is deliberately no "net pay"
 * field for a surface to reach for, because no such number exists in this model.
 *
 * `feeBps` is required, with no default. A historical load must be explained with
 * the rate frozen on its own fee event; defaulting to the current rate here is
 * exactly how a surface would quietly re-rate last quarter's bill.
 */
export function hostChargeBreakdown(driverPayCents: number, feeBps: number): HostChargeBreakdown {
  const platformFeeCents = computePlatformFeeCents(driverPayCents, feeBps)

  return {
    driverPayCents,
    hostTotalCents: driverPayCents + platformFeeCents,
    platformFeeCents
  }
}

/**
 * What a fee in each state contributes to a bill.
 *
 * An exhaustive record, not an `includes` check: adding a state to
 * `platformFeeEventStatusSchema` will not compile until somebody decides whether
 * a host owes money for it.
 */
const FEE_STATUS_IS_BILLABLE: Record<PlatformFeeEventStatus, boolean> = {
  accrued: true,
  invoiced: true,
  voided: false
}

/** The fields `invoiceSubtotalCents` reads. A stored fee event satisfies it. */
export interface PlatformFeeLedgerEntry {
  feeCents: number
  status: PlatformFeeEventStatus
}

/**
 * What a set of fee events adds up to, in whole cents.
 *
 * A voided fee contributes nothing. `invoiced` still counts, because the subtotal
 * of the invoice those events are attached to must not fall to zero the moment
 * they are attached to it.
 */
export function invoiceSubtotalCents(events: readonly PlatformFeeLedgerEntry[]): number {
  let subtotal = 0

  for (const event of events) {
    if (!FEE_STATUS_IS_BILLABLE[event.status]) {
      continue
    }

    assertCents(event.feeCents, "feeCents")
    subtotal += event.feeCents
  }

  return subtotal
}

// ── Billing period ────────────────────────────────────────────────────────────

export interface InvoicePeriod {
  /** First instant of the UTC calendar month. Inclusive. */
  periodStart: string
  /** First instant of the NEXT UTC calendar month. Exclusive. */
  periodEnd: string
}

/**
 * The billing period an instant falls in: one UTC calendar month, half-open.
 *
 * Half-open (inclusive start, exclusive end) so consecutive periods neither
 * overlap nor leave a gap. An inclusive end would have to name the last
 * representable instant of the month, and every writer would pick a different one.
 *
 * UTC, not the host's local zone: fee events are stamped in UTC, and a
 * local-midnight boundary would move a completed load into a different bill
 * depending on where the reader is sitting.
 */
export function invoicePeriodFor(instant: string): InvoicePeriod {
  const at = new Date(instant)

  if (Number.isNaN(at.getTime())) {
    throw new Error(`invoicePeriodFor needs a parsable instant, received ${JSON.stringify(instant)}`)
  }

  const year = at.getUTCFullYear()
  const month = at.getUTCMonth()

  // Date.UTC normalizes month 12 into January of the next year, so December needs
  // no special case.
  return {
    periodEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    periodStart: new Date(Date.UTC(year, month, 1)).toISOString()
  }
}

// ── Deterministic ids ─────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid()

/**
 * The namespace every platform-fee event id is derived under. FROZEN FOREVER.
 *
 * Changing this value re-mints the id of every fee that has ever accrued, which
 * would make the at-most-one check below pass for loads that were already billed
 * and charge every host a second time. There is no migration that fixes that
 * after the fact.
 */
const PLATFORM_FEE_EVENT_NAMESPACE = "8f8c4b3e-6a1d-4a2f-9b57-2c0d5e7a1b64"

/**
 * Namespace for percentage_v1 fee events, keyed by physical movement rather
 * than assignment. Frozen forever: changing it would make a completed movement
 * look unbilled and permit a second fee.
 */
const PERCENTAGE_V1_FEE_EVENT_NAMESPACE = "f0b0d70d-9530-4d29-b66d-0b227d1f08e8"

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

/**
 * SHA-1, by hand, over bytes.
 *
 * WHY HAND-ROLLED. The id has to be computed synchronously inside the
 * compare-and-swap mutation that writes the fee, and it has to be computable by
 * any surface that wants to check whether a fee already exists. `node:crypto`
 * would tie this contracts package to a Node runtime it is not allowed to assume,
 * and WebCrypto's only digest is asynchronous, which a synchronous mutation
 * callback cannot await.
 *
 * SHA-1 is used because RFC 4122 version 5 specifies it — this is name derivation,
 * not a security primitive, and nothing here depends on SHA-1 being
 * collision-resistant against an attacker who chooses both inputs. The
 * implementation is pinned in the tests against the published RFC 4122 v5 vector.
 */
function sha1(message: Uint8Array): Uint8Array {
  // One 0x80 byte plus an eight-byte length must fit after the message.
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64)

  padded.set(message)
  padded[message.length] = 0x80

  const bitLength = message.length * 8

  writeUint32(padded, padded.length - 8, Math.floor(bitLength / 0x1_0000_0000))
  writeUint32(padded, padded.length - 4, bitLength % 0x1_0000_0000)

  let h0 = 0x6745_2301
  let h1 = 0xefcd_ab89
  let h2 = 0x98ba_dcfe
  let h3 = 0x1032_5476
  let h4 = 0xc3d2_e1f0

  const w = new Uint32Array(80)

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = block + index * 4

      w[index] =
        ((padded[at]! << 24) | (padded[at + 1]! << 16) | (padded[at + 2]! << 8) | padded[at + 3]!) >>>
        0
    }

    for (let index = 16; index < 80; index += 1) {
      w[index] = rotateLeft(w[index - 3]! ^ w[index - 8]! ^ w[index - 14]! ^ w[index - 16]!, 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let index = 0; index < 80; index += 1) {
      let f: number
      let k: number

      if (index < 20) {
        f = ((b & c) | (~b & d)) >>> 0
        k = 0x5a82_7999
      } else if (index < 40) {
        f = (b ^ c ^ d) >>> 0
        k = 0x6ed9_eba1
      } else if (index < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0
        k = 0x8f1b_bcdc
      } else {
        f = (b ^ c ^ d) >>> 0
        k = 0xca62_c1d6
      }

      // Five terms below 2^32 sum well inside exact integer range, so the
      // truncation to 32 bits happens once, here.
      const next = (rotateLeft(a, 5) + f + e + k + w[index]!) >>> 0

      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = next
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const digest = new Uint8Array(20)

  writeUint32(digest, 0, h0)
  writeUint32(digest, 4, h1)
  writeUint32(digest, 8, h2)
  writeUint32(digest, 12, h3)
  writeUint32(digest, 16, h4)

  return digest
}

function uuidBytes(value: string): Uint8Array {
  if (!uuidSchema.safeParse(value).success) {
    throw new Error(`Expected a uuid, received ${JSON.stringify(value)}`)
  }

  const hex = value.replaceAll("-", "")
  const bytes = new Uint8Array(16)

  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code > 0x7f) {
      // Every name hashed in this system is a uuid. Refusing non-ASCII keeps the
      // encoding unambiguous instead of depending on a TextEncoder this package
      // cannot assume exists.
      throw new Error("Deterministic ids are derived from ASCII names only")
    }

    bytes[index] = code
  }

  return bytes
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-")
}

/**
 * RFC 4122 version 5: the uuid a namespace and a name always produce.
 *
 * Exported so every money record in this system derives its id the same way. A
 * second derivation would be a second at-most-one rule, and the two would
 * disagree.
 */
export function deterministicUuidV5(namespaceUuid: string, name: string): string {
  const namespace = uuidBytes(namespaceUuid)
  const nameBytes = asciiBytes(name)
  const input = new Uint8Array(namespace.length + nameBytes.length)

  input.set(namespace)
  input.set(nameBytes, namespace.length)

  const bytes = sha1(input).slice(0, 16)

  bytes[6] = (bytes[6]! & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant

  return formatUuid(bytes)
}

/**
 * The id of the legacy_percentage fee accrued for one assignment. Same
 * assignment, same id, forever. Subscription-v1 usage has a separate
 * movement-derived id and must never call this helper.
 *
 * THIS IS THE DOUBLE-BILLING DEFENCE. The operating state is a single JSONB
 * document: there is no unique index, no foreign key and no CHECK constraint
 * anywhere behind it. So the guarantee that a completed load is charged once is
 * this derivation plus an explicit "no event with this id already exists"
 * assertion made inside the same mutation as the write. Either half alone is not
 * enough — a random id makes the assertion unable to recognise the duplicate, and
 * the assertion outside the mutation is defeated by a compare-and-swap retry.
 *
 * Keyed on the ASSIGNMENT because an assignment is exactly one truckload hauled by
 * one driver, which is the unit the fee is charged on. It is deliberately not
 * keyed on the truck slot: a slot in this product carries `capacity`, so several
 * assignments legitimately complete inside one slot, and slot-keying would bill
 * one fee for all of them.
 *
 * The input is lower-cased first, so a uuid written in upper case cannot mint a
 * second fee for a load that was already charged.
 */
export function platformFeeEventId(assignmentId: string): string {
  if (!uuidSchema.safeParse(assignmentId).success) {
    throw new Error(`platformFeeEventId needs an assignment uuid, received ${JSON.stringify(assignmentId)}`)
  }

  return deterministicUuidV5(PLATFORM_FEE_EVENT_NAMESPACE, assignmentId.toLowerCase())
}

/**
 * The one percentage_v1 fee id for a physical movement. Replacement
 * assignments intentionally derive the same id.
 */
export function percentageFeeEventId(loadMovementId: string): string {
  if (!uuidSchema.safeParse(loadMovementId).success) {
    throw new Error(
      `percentageFeeEventId needs a movement uuid, received ${JSON.stringify(loadMovementId)}`
    )
  }

  return deterministicUuidV5(
    PERCENTAGE_V1_FEE_EVENT_NAMESPACE,
    loadMovementId.toLowerCase()
  )
}
