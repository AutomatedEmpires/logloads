"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  attestAvailability,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  PUBLISH_ATTESTATION_FIELD,
  validateMarketplaceJobPublication,
  type MarketplaceAvailabilityAttestation,
  type MarketplaceDraftLandingContext,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft
} from "@logloads/contracts"

import {
  interestRepliedProperties,
  interestSubmittedProperties,
  jobPublishedProperties,
  jobReconfirmedProperties,
  productEventsWanted,
  recordProductEvent
} from "../analytics/server"
import { checkRateLimit } from "../rate-limit"
import { draftInput, draftQueryString, draftValuesFromForm, type DraftFormValues } from "./draft-params"
import { v2ErrorQuery, type V2ErrorCode } from "./error-codes"
import { reportV2Error } from "./error-log"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, type MarketplaceV2Viewer } from "./port"
import { getV2SessionActor } from "./v2-session"

/**
 * Marketplace V2 form actions. Identity and workspace always come from the server session; the form
 * supplies only the job/inquiry ids and the hauler's or landing's own words. Every write goes through
 * the port (and the service-layer authorization behind it). No dispatch, trip, invitation or fee.
 * A failure answers with an error code, never with words (#279): see `failed`.
 *
 * Each successful write records its product event (#330, docs/analytics/event-plan.md §6) with
 * `recordProductEvent`, which sends it after the response and never fails the action. The event carries
 * ids, enums and counts only: the form's words never reach it.
 */

async function requireViewer(nextPath: string): Promise<MarketplaceV2Viewer> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getV2SessionActor()

  if (!actor) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  if (actor.workspaceSelectionInvalid || !actor.activeOrganization) {
    throw new Error("Choose a workspace before continuing")
  }

  return { organizationId: actor.activeOrganization.id, userId: actor.profile.id }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

/**
 * Per-configuration counts from the inquiry form: parallel `equipmentKey` / `equipmentCount` fields.
 * Only keys and counts come from the form; labels and limits are resolved from the profile server-side.
 */
function equipmentLines(formData: FormData): Array<{ configurationKey: string; count: string }> {
  const keys = formData.getAll("equipmentKey")
  const counts = formData.getAll("equipmentCount")

  return keys.slice(0, 20).flatMap((key, index) => {
    const count = counts[index]
    return typeof key === "string" && typeof count === "string" && key ? [{ configurationKey: key, count: count || "0" }] : []
  })
}

function safeRedirect(path: string, query: Record<string, string>, hash = ""): never {
  const params = new URLSearchParams(query)
  redirect(`${path}?${params.toString()}${hash}`)
}

/**
 * The query for a failed operation: an error code and, when the failure was logged, its request id (#279). Never
 * the error's words: the page shows the code's fixed copy (`error-codes.ts`), so no text travels in the URL.
 */
function failed(error: unknown, operation: string): Record<string, string> {
  return v2ErrorQuery(reportV2Error(error, operation))
}

/** A refusal these actions decide themselves: its code, with nothing logged. */
function refused(code: V2ErrorCode): Record<string, string> {
  return v2ErrorQuery({ code, requestId: null })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Back to an inquiry list with the same inquiry selected (`inquiry`), so the conversation the viewer acted on stays
 * open beside the list. Only a well-formed id is carried; the page shows it only if it is one of the viewer's own.
 */
function inquiryRedirect(path: string, formData: FormData, query: Record<string, string>): never {
  const interestId = field(formData, "interestId").trim()
  safeRedirect(path, UUID.test(interestId) ? { ...query, inquiry: interestId } : query)
}

/** The interest sheet on the job page (UX-08, #131): a page without JavaScript lands on its answer, not the page top. */
const INTEREST_ANCHOR = "#interest"

/**
 * The hauler sends (or sends again) interest. The form supplies the job id, a count per configuration key, the dates,
 * the contact route and the message; the business is the session's. Sending twice is safe: both stores keep one
 * inquiry per job and business, and an identical one changes nothing (UX spec §5.4 "idempotent submission").
 */
export async function expressInterestAction(formData: FormData): Promise<void> {
  const jobId = field(formData, "loadPostingId")
  const back = `/v2/work/${encodeURIComponent(jobId)}`
  const viewer = await requireViewer(back)
  let interest: MarketplaceInterestView

  try {
    await checkRateLimit("marketplace-interest", viewer.userId, 20, 60 * 60_000)
    interest = await pilotMarketplaceV2.expressInterest(viewer, {
      availableFrom: field(formData, "availableFrom"),
      availableUntil: field(formData, "availableUntil"),
      contactPreference: field(formData, "contactPreference") || "in_app",
      equipment: equipmentLines(formData),
      loadPostingId: jobId,
      message: field(formData, "message"),
      trucksOffered: field(formData, "trucksOffered")
    })
  } catch (error) {
    safeRedirect(back, failed(error, "interest.express"), INTEREST_ANCHOR)
  }

  await recordProductEvent("interest_submitted", () => interestSubmittedProperties({ interest, now: new Date().toISOString() }), { actor: viewer })
  revalidatePath("/v2", "layout")
  safeRedirect(back, { sent: "1" }, INTEREST_ANCHOR)
}

/**
 * The hauler withdraws, optionally with a reason the landing sees (UX-09 #132). The reason is a message, so it
 * counts against the same reply rate limit; the port posts it and withdraws in one change.
 */
export async function withdrawInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")
  const reason = field(formData, "reason")

  try {
    if (reason.trim()) {
      await checkRateLimit("marketplace-reply", viewer.userId, 60, 60 * 60_000)
    }

    await pilotMarketplaceV2.withdrawInterestWithReason(viewer, {
      interestId: field(formData, "interestId"),
      reason,
      replyId: field(formData, "replyId") || randomUUID()
    })
  } catch (error) {
    inquiryRedirect("/v2/inquiries", formData, failed(error, "interest.withdraw"))
  }

  revalidatePath("/v2", "layout")
  inquiryRedirect("/v2/inquiries", formData, { updated: "withdrawn" })
}

/**
 * Whether an answer is new, read from the inquiry as it is before the write (#330). Both stores treat a resubmitted
 * reply (the same `replyId`, as after a lost redirect) and a second decline as no change, so neither may send another
 * `interest_replied`. The read is made only when an event would be sent at all, and runs beside the rate-limit check.
 * An inquiry this read cannot find or a failed read counts the answer as new: the write itself decides what is allowed.
 */
async function answerIsNew(
  viewer: MarketplaceV2Viewer,
  side: "hauler" | "landing",
  interestId: string,
  isNew: (interest: MarketplaceInterestView) => boolean
): Promise<boolean> {
  try {
    if (!(await productEventsWanted())) {
      return false
    }

    const inquiries = side === "hauler" ? await pilotMarketplaceV2.listHaulerInterests(viewer) : await pilotMarketplaceV2.listLandingInterests(viewer)
    const id = interestId.trim().toLowerCase()
    const interest = inquiries.find((candidate) => candidate.id.toLowerCase() === id)
    return interest ? isNew(interest) : true
  } catch {
    return true
  }
}

const hasReply = (interest: MarketplaceInterestView, replyId: string | undefined) => Boolean(replyId) && interest.replies.some((reply) => reply.id === replyId)

export async function haulerReplyAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")
  const interestId = field(formData, "interestId")
  const replyId = field(formData, "replyId") || randomUUID()
  let isNew = false

  try {
    const [, fresh] = await Promise.all([
      checkRateLimit("marketplace-reply", viewer.userId, 60, 60 * 60_000),
      answerIsNew(viewer, "hauler", interestId, (interest) => !hasReply(interest, replyId))
    ])
    isNew = fresh
    await pilotMarketplaceV2.postHaulerReply(viewer, { body: field(formData, "body"), interestId, replyId })
  } catch (error) {
    inquiryRedirect("/v2/inquiries", formData, failed(error, "inquiry.hauler_reply"))
  }

  // The inquiry is the one the port just wrote to (it refuses any other); its id only reaches PostHog as a pseudonym.
  if (isNew) {
    await recordProductEvent(
      "interest_replied",
      () => interestRepliedProperties({ decision: "replied", interestId, organizationId: viewer.organizationId, side: "hauler" }),
      { actor: viewer }
    )
  }

  revalidatePath("/v2", "layout")
  inquiryRedirect("/v2/inquiries", formData, { updated: "reply" })
}

export async function respondToInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/landing/inquiries")
  const decision = field(formData, "decision")
  const interestId = field(formData, "interestId")
  const replyId = field(formData, "replyId") || undefined
  // A reply or a decline is an answer (flow C); "viewed" is not, and records nothing.
  const answers = decision === "replied" || decision === "declined"
  let isNew = false

  try {
    const [, fresh] = await Promise.all([
      checkRateLimit("marketplace-reply", viewer.userId, 120, 60 * 60_000),
      answers
        ? answerIsNew(viewer, "landing", interestId, (interest) => (decision === "declined" ? interest.status !== "declined" : !hasReply(interest, replyId)))
        : false
    ])
    isNew = fresh
    await pilotMarketplaceV2.respondToInterest(viewer, { body: field(formData, "body"), decision, interestId, replyId })
  } catch (error) {
    inquiryRedirect("/v2/landing/inquiries", formData, failed(error, "inquiry.respond"))
  }

  if (isNew) {
    await recordProductEvent(
      "interest_replied",
      () => interestRepliedProperties({ decision, interestId, organizationId: viewer.organizationId, side: "landing" }),
      { actor: viewer }
    )
  }

  revalidatePath("/v2", "layout")
  inquiryRedirect("/v2/landing/inquiries", formData, { updated: decision })
}

const NEW_JOB_PATH = "/v2/landing/jobs/new"
const PREVIEW_PATH = "/v2/landing/jobs/preview"
const JOBS_PATH = "/v2/landing/jobs"
const HOUR_MS = 60 * 60_000

/** Per-user ceilings for the two actions that create or refresh a public listing. */
const PUBLISH_RATE_LIMIT = { bucket: "marketplace-publish", limit: 20 } as const
const RECONFIRM_RATE_LIMIT = { bucket: "marketplace-reconfirm", limit: 120 } as const

/** Back to the authoring screens with the poster's draft intact. The attestation is never carried back. */
function redirectWithDraft(path: string, values: DraftFormValues, extra: Record<string, string>): never {
  const params = new URLSearchParams(draftQueryString(values))

  for (const [name, value] of Object.entries(extra)) {
    params.set(name, value)
  }

  redirect(`${path}?${params.toString()}`)
}

type PublishCheck =
  | { ok: true; draft: MarketplaceJobDraft; attestation: MarketplaceAvailabilityAttestation; landing: MarketplaceDraftLandingContext }
  | { ok: false; path: string; error: V2ErrorCode }

/**
 * Every server-side check publishing needs, in order. Identity is the session viewer; the form supplies
 * only the draft and the three attestation checkboxes. Thrown service errors (rate limit, membership) propagate.
 */
async function checkPublishRequest(viewer: MarketplaceV2Viewer, values: DraftFormValues, attestations: Record<string, string>): Promise<PublishCheck> {
  // 1. Rate limit first, so refused attempts (for example probing other organizations' landings) count too.
  await checkRateLimit(PUBLISH_RATE_LIMIT.bucket, viewer.userId, PUBLISH_RATE_LIMIT.limit, HOUR_MS)

  // 2. Capability `job.publish` in the session's active organization.
  const access = await pilotMarketplaceV2.viewerAccess(viewer)

  if (!access.capabilities.includes("job.publish")) {
    return { error: "cannot_publish", ok: false, path: PREVIEW_PATH }
  }

  // 3. Draft rules (required pay, sensitive-access and contact text, limits), publishing rules (product,
  //    timing) and all three explicit attestations, whose timestamp is the server clock.
  const publication = validateMarketplaceJobPublication(draftInput(values), attestations, new Date())

  if (!publication.ok) {
    const onlyAttestationMissing = publication.issues.every((issue) => issue.field === PUBLISH_ATTESTATION_FIELD)

    return onlyAttestationMissing
      ? { error: "publish_attestation", ok: false, path: PREVIEW_PATH }
      : { error: "fix_fields", ok: false, path: NEW_JOB_PATH }
  }

  // 4. The landing belongs to the viewer's organization: the service lists only the organization's own
  //    active landings, so another organization's landing id is refused here.
  const landings = await pilotMarketplaceV2.authoringLandings(viewer)
  const landing = landings.find((candidate) => candidate.id === publication.draft.landingId)

  if (!landing) {
    return { error: "landing_not_owned", ok: false, path: NEW_JOB_PATH }
  }

  return { attestation: publication.attestation, draft: publication.draft, landing, ok: true }
}

/**
 * Publishing a native V2 job. Every check runs on the server (see `checkPublishRequest`) before the port
 * is called. On the pilot store the port refuses (no persistence yet), and the poster is returned to the
 * preview with an explanation instead of a fake success.
 */
export async function publishJobAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer(NEW_JOB_PATH)
  const values = draftValuesFromForm(formData)
  let checked: PublishCheck

  try {
    const attestations = Object.fromEntries(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => [name, field(formData, name)]))
    checked = await checkPublishRequest(viewer, values, attestations)
  } catch (error) {
    redirectWithDraft(PREVIEW_PATH, values, failed(error, "job.publish_check"))
  }

  if (!checked.ok) {
    redirectWithDraft(checked.path, values, refused(checked.error))
  }

  let published: { jobId: string }

  try {
    published = await pilotMarketplaceV2.publishJob(viewer, checked.draft, checked.attestation)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      redirectWithDraft(PREVIEW_PATH, values, { unavailable: "publish" })
    }

    redirectWithDraft(PREVIEW_PATH, values, failed(error, "job.publish"))
  }

  // Only the landing's state code leaves, never its name or place (event plan §3).
  await recordProductEvent(
    "job_published",
    () => jobPublishedProperties({ draft: checked.draft, jobId: published.jobId, landing: checked.landing, organizationId: viewer.organizationId }),
    { actor: viewer }
  )
  revalidatePath("/v2", "layout")
  safeRedirect(`/v2/work/${published.jobId}`, { published: "1" })
}

type ReconfirmCheck =
  | { ok: true; jobId: string; attestation: MarketplaceAvailabilityAttestation; job: MarketplaceJobDetailView }
  | { ok: false; error: V2ErrorCode }

async function checkReconfirmRequest(viewer: MarketplaceV2Viewer, jobId: string, attestationValue: string): Promise<ReconfirmCheck> {
  // 1. Rate limit.
  await checkRateLimit(RECONFIRM_RATE_LIMIT.bucket, viewer.userId, RECONFIRM_RATE_LIMIT.limit, HOUR_MS)

  // 2. Capability `job.publish`.
  const access = await pilotMarketplaceV2.viewerAccess(viewer)

  if (!access.capabilities.includes("job.publish")) {
    return { error: "cannot_confirm", ok: false }
  }

  // 3. Ownership: the job is a posting of the viewer's organization. A job's organization is its
  //    landing's organization (`job_postings (landing_id, org_id)` references `landings (id, org_id)`).
  const id = jobId.trim()
  const job = id && id.length <= 200 ? await pilotMarketplaceV2.getJob(id) : null

  if (!job || job.posterOrganizationId !== viewer.organizationId) {
    return { error: "not_own_job", ok: false }
  }

  // 4. Only a listing that is accepting interest can be "still available".
  if (!job.acceptingInterest) {
    return { error: "not_accepting", ok: false }
  }

  // 5. The explicit attestation; its timestamp is the server clock.
  const attestation = attestAvailability(attestationValue, "reconfirm", new Date())

  if (!attestation) {
    return { error: "reconfirm_attestation", ok: false }
  }

  return { attestation, job, jobId: job.id, ok: true }
}

/** Where a reconfirmation answers: the job list, or the landing overview's attention list (#133). Nothing else. */
const RECONFIRM_RETURN_PATHS: ReadonlySet<string> = new Set([JOBS_PATH, "/v2/landing"])

function reconfirmReturnPath(formData: FormData): string {
  const asked = field(formData, "returnTo")
  return RECONFIRM_RETURN_PATHS.has(asked) ? asked : JOBS_PATH
}

/**
 * The poster's explicit "this work is still available" confirmation, checked on the server (see
 * `checkReconfirmRequest`). It is the only way besides publishing to set `lastConfirmedAt`.
 */
export async function reconfirmJobAction(formData: FormData): Promise<void> {
  const back = reconfirmReturnPath(formData)
  const viewer = await requireViewer(back)
  let checked: ReconfirmCheck

  try {
    checked = await checkReconfirmRequest(viewer, field(formData, "jobId"), field(formData, MARKETPLACE_AVAILABILITY_ATTESTATION.field))
  } catch (error) {
    safeRedirect(back, failed(error, "job.reconfirm_check"))
  }

  if (!checked.ok) {
    safeRedirect(back, refused(checked.error))
  }

  try {
    await pilotMarketplaceV2.reconfirmJob(viewer, checked.jobId, checked.attestation)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      safeRedirect(back, { unavailable: "reconfirm" })
    }

    safeRedirect(back, failed(error, "job.reconfirm"))
  }

  // `job` is the listing as it was before this confirmation, so the event says whether it had gone stale (flow E).
  await recordProductEvent(
    "job_reconfirmed",
    () => jobReconfirmedProperties({ job: checked.job, now: checked.attestation.confirmedAt, organizationId: viewer.organizationId, resumed: false, via: "in_app" }),
    { actor: viewer }
  )
  revalidatePath("/v2", "layout")
  safeRedirect(back, { updated: "reconfirmed" })
}
