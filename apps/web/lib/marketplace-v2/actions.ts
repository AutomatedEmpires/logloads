"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  attestAvailability,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  PUBLISH_ATTESTATION_FIELD,
  PUBLISH_ATTESTATION_REQUIRED,
  validateMarketplaceJobPublication,
  type MarketplaceAvailabilityAttestation,
  type MarketplaceJobDraft
} from "@logloads/contracts"

import { checkRateLimit } from "../rate-limit"
import { serializeError } from "../services"
import { getSessionActor } from "../session"
import { draftInput, draftQueryString, draftValuesFromForm, LANDING_NOT_OWNED, type DraftFormValues } from "./draft-params"
import { marketplaceV2Enabled } from "./flag"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError, type MarketplaceV2Viewer } from "./port"

/**
 * Marketplace V2 form actions. Identity and workspace always come from the server session; the form
 * supplies only the job/inquiry ids and the hauler's or landing's own words. Every write goes through
 * the port (and the service-layer authorization behind it). No dispatch, trip, invitation or fee.
 */

async function requireViewer(nextPath: string): Promise<MarketplaceV2Viewer> {
  if (!marketplaceV2Enabled()) {
    redirect("/")
  }

  const actor = await getSessionActor()

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

function safeRedirect(path: string, query: Record<string, string>): never {
  const params = new URLSearchParams(query)
  redirect(`${path}?${params.toString()}`)
}

/** Returns a short, user-safe message (service refusals are written for end users). */
function message(error: unknown): string {
  return serializeError(error).error.slice(0, 160)
}

export async function expressInterestAction(formData: FormData): Promise<void> {
  const jobId = field(formData, "loadPostingId")
  const back = `/v2/work/${jobId}`
  const viewer = await requireViewer(back)

  try {
    await checkRateLimit("marketplace-interest", viewer.userId, 20, 60 * 60_000)
    await pilotMarketplaceV2.expressInterest(viewer, {
      availableFrom: field(formData, "availableFrom"),
      availableUntil: field(formData, "availableUntil"),
      contactPreference: field(formData, "contactPreference") || "in_app",
      equipment: equipmentLines(formData),
      loadPostingId: jobId,
      message: field(formData, "message"),
      trucksOffered: field(formData, "trucksOffered")
    })
  } catch (error) {
    safeRedirect(back, { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect(back, { sent: "1" })
}

export async function withdrawInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")

  try {
    await pilotMarketplaceV2.withdrawInterest(viewer, field(formData, "interestId"))
  } catch (error) {
    safeRedirect("/v2/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/inquiries", { updated: "withdrawn" })
}

export async function haulerReplyAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/inquiries")

  try {
    await checkRateLimit("marketplace-reply", viewer.userId, 60, 60 * 60_000)
    await pilotMarketplaceV2.postHaulerReply(viewer, {
      body: field(formData, "body"),
      interestId: field(formData, "interestId"),
      replyId: field(formData, "replyId") || randomUUID()
    })
  } catch (error) {
    safeRedirect("/v2/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/inquiries", { updated: "reply" })
}

export async function respondToInterestAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer("/v2/landing/inquiries")
  const decision = field(formData, "decision")

  try {
    await checkRateLimit("marketplace-reply", viewer.userId, 120, 60 * 60_000)
    await pilotMarketplaceV2.respondToInterest(viewer, {
      body: field(formData, "body"),
      decision,
      interestId: field(formData, "interestId"),
      replyId: field(formData, "replyId") || undefined
    })
  } catch (error) {
    safeRedirect("/v2/landing/inquiries", { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect("/v2/landing/inquiries", { updated: decision })
}

const NEW_JOB_PATH = "/v2/landing/jobs/new"
const PREVIEW_PATH = "/v2/landing/jobs/preview"
const JOBS_PATH = "/v2/landing/jobs"
const HOUR_MS = 60 * 60_000

/** Per-user ceilings for the two actions that create or refresh a public listing. */
const PUBLISH_RATE_LIMIT = { bucket: "marketplace-publish", limit: 20 } as const
const RECONFIRM_RATE_LIMIT = { bucket: "marketplace-reconfirm", limit: 120 } as const

const CANNOT_PUBLISH = "Your role cannot publish jobs for this organization"
const CANNOT_CONFIRM = "Your role cannot confirm jobs for this organization"
const FIX_FIELDS = "Fix the highlighted fields before publishing"
const NOT_OWN_JOB = "You can only confirm your organization's own job postings"
const NOT_ACCEPTING = "Only a job that is accepting interest can be confirmed as still available"
const RECONFIRM_ATTESTATION_REQUIRED = "Tick the availability confirmation to record that this job is still available"

/** Back to the authoring screens with the poster's draft intact. The attestation is never carried back. */
function redirectWithDraft(path: string, values: DraftFormValues, extra: Record<string, string>): never {
  const params = new URLSearchParams(draftQueryString(values))

  for (const [name, value] of Object.entries(extra)) {
    params.set(name, value)
  }

  redirect(`${path}?${params.toString()}`)
}

type PublishCheck =
  | { ok: true; draft: MarketplaceJobDraft; attestation: MarketplaceAvailabilityAttestation }
  | { ok: false; path: string; error: string }

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
    return { error: CANNOT_PUBLISH, ok: false, path: PREVIEW_PATH }
  }

  // 3. Draft rules (required pay, sensitive-access and contact text, limits), publishing rules (product,
  //    timing) and all three explicit attestations, whose timestamp is the server clock.
  const publication = validateMarketplaceJobPublication(draftInput(values), attestations, new Date())

  if (!publication.ok) {
    const onlyAttestationMissing = publication.issues.every((issue) => issue.field === PUBLISH_ATTESTATION_FIELD)

    return onlyAttestationMissing
      ? { error: PUBLISH_ATTESTATION_REQUIRED, ok: false, path: PREVIEW_PATH }
      : { error: FIX_FIELDS, ok: false, path: NEW_JOB_PATH }
  }

  // 4. The landing belongs to the viewer's organization: the service lists only the organization's own
  //    active landings, so another organization's landing id is refused here.
  const landings = await pilotMarketplaceV2.authoringLandings(viewer)

  if (!landings.some((landing) => landing.id === publication.draft.landingId)) {
    return { error: LANDING_NOT_OWNED, ok: false, path: NEW_JOB_PATH }
  }

  return { attestation: publication.attestation, draft: publication.draft, ok: true }
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
    redirectWithDraft(PREVIEW_PATH, values, { error: message(error) })
  }

  if (!checked.ok) {
    redirectWithDraft(checked.path, values, { error: checked.error })
  }

  let published: { jobId: string }

  try {
    published = await pilotMarketplaceV2.publishJob(viewer, checked.draft, checked.attestation)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      redirectWithDraft(PREVIEW_PATH, values, { unavailable: "publish" })
    }

    redirectWithDraft(PREVIEW_PATH, values, { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect(`/v2/work/${published.jobId}`, { published: "1" })
}

type ReconfirmCheck =
  | { ok: true; jobId: string; attestation: MarketplaceAvailabilityAttestation }
  | { ok: false; error: string }

async function checkReconfirmRequest(viewer: MarketplaceV2Viewer, jobId: string, attestationValue: string): Promise<ReconfirmCheck> {
  // 1. Rate limit.
  await checkRateLimit(RECONFIRM_RATE_LIMIT.bucket, viewer.userId, RECONFIRM_RATE_LIMIT.limit, HOUR_MS)

  // 2. Capability `job.publish`.
  const access = await pilotMarketplaceV2.viewerAccess(viewer)

  if (!access.capabilities.includes("job.publish")) {
    return { error: CANNOT_CONFIRM, ok: false }
  }

  // 3. Ownership: the job is a posting of the viewer's organization. A job's organization is its
  //    landing's organization (`job_postings (landing_id, org_id)` references `landings (id, org_id)`).
  const id = jobId.trim()
  const job = id && id.length <= 200 ? await pilotMarketplaceV2.getJob(id) : null

  if (!job || job.posterOrganizationId !== viewer.organizationId) {
    return { error: NOT_OWN_JOB, ok: false }
  }

  // 4. Only a listing that is accepting interest can be "still available".
  if (!job.acceptingInterest) {
    return { error: NOT_ACCEPTING, ok: false }
  }

  // 5. The explicit attestation; its timestamp is the server clock.
  const attestation = attestAvailability(attestationValue, "reconfirm", new Date())

  if (!attestation) {
    return { error: RECONFIRM_ATTESTATION_REQUIRED, ok: false }
  }

  return { attestation, jobId: job.id, ok: true }
}

/**
 * The poster's explicit "this work is still available" confirmation, checked on the server (see
 * `checkReconfirmRequest`). It is the only way besides publishing to set `lastConfirmedAt`.
 */
export async function reconfirmJobAction(formData: FormData): Promise<void> {
  const viewer = await requireViewer(JOBS_PATH)
  let checked: ReconfirmCheck

  try {
    checked = await checkReconfirmRequest(viewer, field(formData, "jobId"), field(formData, MARKETPLACE_AVAILABILITY_ATTESTATION.field))
  } catch (error) {
    safeRedirect(JOBS_PATH, { error: message(error) })
  }

  if (!checked.ok) {
    safeRedirect(JOBS_PATH, { error: checked.error })
  }

  try {
    await pilotMarketplaceV2.reconfirmJob(viewer, checked.jobId, checked.attestation)
  } catch (error) {
    if (error instanceof MarketplaceOperationUnavailableError) {
      safeRedirect(JOBS_PATH, { unavailable: "reconfirm" })
    }

    safeRedirect(JOBS_PATH, { error: message(error) })
  }

  revalidatePath("/v2", "layout")
  safeRedirect(JOBS_PATH, { updated: "reconfirmed" })
}
