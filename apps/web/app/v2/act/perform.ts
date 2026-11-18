import "server-only"

import { MARKETPLACE_AVAILABILITY_ATTESTATION, attestAvailability } from "@logloads/contracts"

import {
  availabilityReconfirmedProperties,
  interestRepliedProperties,
  jobReconfirmedProperties,
  jobStoppedProperties,
  recordProductEvent
} from "@/lib/analytics/server"

import { productionEffects, type OneTapEffects, type OneTapJobSnapshot } from "./effects"
import { oneTapLedger, type OneTapAttestation, type OneTapLedger } from "./ledger"
import { oneTapStatement, type OneTapAction } from "./statements"
import { oneTapSecret, readOneTapLink, type OneTapLink } from "./token"

export type OneTapNotice = "empty" | "error" | null

export type OneTapPressResult =
  | { kind: "done" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "pending" }
  | { kind: "used" }

export interface OneTapRuntime {
  effects: OneTapEffects
  ledger: OneTapLedger
  now: () => Date
  secret: string | null
}

export function productionRuntime(): OneTapRuntime {
  return {
    effects: productionEffects(),
    ledger: oneTapLedger(),
    now: () => new Date(),
    secret: oneTapSecret()
  }
}

function viewerOf(link: OneTapLink) {
  return { organizationId: link.organizationId, userId: link.userId }
}

function attestationFor(link: OneTapLink, now: Date): OneTapAttestation {
  const statement = oneTapStatement(link.action)

  return {
    action: link.action,
    jobId: link.jobId,
    organizationId: link.organizationId,
    recordedAt: now.toISOString(),
    statementText: statement.text,
    statementVersion: statement.version,
    tokenId: link.tokenId,
    userId: link.userId
  }
}

async function apply(link: OneTapLink, effects: OneTapEffects, now: Date): Promise<{ confirmed: number; report: boolean; snapshot: OneTapJobSnapshot | null }> {
  const viewer = viewerOf(link)

  if (link.action === "reply" || link.action === "decline") {
    if (!link.interestId) throw new Error("missing inquiry")

    await effects.reply(viewer, {
      decision: link.action === "decline" ? "declined" : "replied",
      interestId: link.interestId,
      ...(link.replyBody ? { body: link.replyBody } : {}),
      ...(link.replyId ? { replyId: link.replyId } : {})
    })
    return { confirmed: 0, report: true, snapshot: null }
  }

  if (link.action === "confirm_availability") {
    return { confirmed: (await effects.confirmAvailability(viewer)).confirmed, report: true, snapshot: null }
  }

  if (!link.jobId) throw new Error("missing job")

  const before = await effects.jobBefore(viewer, link.jobId)
  const snapshot = before?.id === link.jobId ? before : null

  if (link.action === "reconfirm") {
    const attestation = attestAvailability(MARKETPLACE_AVAILABILITY_ATTESTATION.value, "reconfirm", now)

    if (!attestation) throw new Error("missing attestation")
    await effects.reconfirmJob(viewer, link.jobId, attestation)
    return { confirmed: 0, report: true, snapshot }
  }

  const target = link.action === "fill" ? "filled" : "paused"

  // The listing already says what this press would say. Record the attestation and send no new stop event.
  if (snapshot?.status === target) {
    return { confirmed: 0, report: false, snapshot }
  }

  await effects.stopJob(viewer, link.jobId, target)
  return { confirmed: 0, report: true, snapshot }
}

async function emit(link: OneTapLink, snapshot: OneTapJobSnapshot | null, confirmed: number, now: Date): Promise<void> {
  const actor = { organizationId: link.organizationId }

  try {
    if (link.action === "reply" || link.action === "decline") {
      const interestId = link.interestId

      if (!interestId) return
      await recordProductEvent(
        "interest_replied",
        () => interestRepliedProperties({
          decision: link.action === "decline" ? "declined" : "replied",
          interestId,
          organizationId: link.organizationId,
          side: "landing"
        }),
        { actor }
      )
      return
    }

    if (link.action === "confirm_availability") {
      await recordProductEvent(
        "availability_reconfirmed",
        () => availabilityReconfirmedProperties({
          confirmed,
          organizationId: link.organizationId,
          signedIn: false,
          via: "one_tap_link"
        }),
        { actor }
      )
      return
    }

    if (!snapshot) return

    if (link.action === "reconfirm") {
      await recordProductEvent(
        "job_reconfirmed",
        () => jobReconfirmedProperties({
          job: snapshot,
          now: now.toISOString(),
          organizationId: link.organizationId,
          resumed: false,
          via: "one_tap_link"
        }),
        { actor }
      )
      return
    }

    const status = link.action === "fill" ? "filled" : "paused"

    await recordProductEvent(
      "job_stopped",
      () => jobStoppedProperties({
        job: snapshot,
        now: now.toISOString(),
        organizationId: link.organizationId,
        status,
        via: "one_tap_link"
      }),
      { actor }
    )
  } catch {
    // The press is already recorded. A product event must not fail it or invite a second press.
  }
}

/**
 * The button press. A token that does not verify, or that is already recorded, never reaches the store.
 * A store failure releases the claim so the same link can be pressed again. Nothing is emitted until the
 * write has succeeded and the claim is committed.
 */
export async function pressOneTap(token: string, runtime: OneTapRuntime): Promise<OneTapPressResult> {
  if (!runtime.secret) return { kind: "invalid" }

  const now = runtime.now()
  const read = readOneTapLink(token, runtime.secret, now)

  if (!read.ok) return { kind: read.reason }

  const claim = runtime.ledger.begin(attestationFor(read.link, now))

  if (claim.status === "used") return { kind: "used" }
  if (claim.status === "pending") return { kind: "pending" }

  try {
    const applied = await apply(read.link, runtime.effects, now)

    if (read.link.action === "confirm_availability" && applied.confirmed === 0) {
      runtime.ledger.release(read.link.tokenId)
      return { kind: "empty" }
    }

    runtime.ledger.commit(read.link.tokenId)

    if (applied.report) await emit(read.link, applied.snapshot, applied.confirmed, now)
    return { kind: "done" }
  } catch {
    runtime.ledger.release(read.link.tokenId)
    return { kind: "error" }
  }
}

export type OneTapInspection =
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "pending" }
  | { kind: "ready"; action: OneTapAction; replyBody: string | null }
  | { kind: "used"; action: OneTapAction; interestId: string | null }

/** A read of the link. It does not claim the token and it does not call the store. */
export function inspectOneTap(token: string, runtime: Pick<OneTapRuntime, "ledger" | "now" | "secret">): OneTapInspection {
  if (!runtime.secret) return { kind: "invalid" }

  const read = readOneTapLink(token, runtime.secret, runtime.now())

  if (!read.ok) return { kind: read.reason }

  const recorded = runtime.ledger.read(read.link.tokenId)

  if (recorded) return { action: recorded.action, interestId: read.link.interestId, kind: "used" }
  if (runtime.ledger.state(read.link.tokenId) === "pending") return { kind: "pending" }
  return { action: read.link.action, kind: "ready", replyBody: read.link.replyBody }
}

export type { OneTapAction }
