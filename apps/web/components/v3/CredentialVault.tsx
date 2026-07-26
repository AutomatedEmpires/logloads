"use client"

import Image from "next/image"
import { useId, useState, useTransition, type FormEvent } from "react"
import { Badge, Icon } from "@logloads/ui"

import {
  requestCredentialReviewAction,
  submitDriverCredentialAction,
  type CredentialActionResult
} from "@/lib/cockpit-actions"
import type {
  CredentialVaultView,
  DriverCredentialSlotView,
  HostCredentialLineView,
  HostDriverCredentialSummaryView
} from "@/lib/credential-data"

type CredentialActionOutcome = NonNullable<CredentialActionResult["outcome"]>

/**
 * ── The driver's credential vault, and the host's view of it ───────────────────
 *
 * A PHONE IN A TRUCK. Every control here is one of the app's existing 44px-floor
 * classes, every state is announced rather than implied by colour, and the one
 * thing a driver must not have to work out for themselves — that they cannot accept
 * loads, and why — is the first thing on the screen, in a live region.
 *
 * NO DECISIONS ARE MADE HERE. Every label, tone, sentence and availability flag
 * arrives from `credential-data`, which reads the contract's gate. A component that
 * decided for itself whether a record counted would be a second safety rule living
 * in the least reviewable place in the codebase.
 *
 * WHY THE UPLOAD CONTROL IS OFTEN ABSENT. LogLoads cannot store a credential
 * document today: it has no media account of its own, and no upload route scoped to
 * the vault. The read model reports that as `intake.available === false` with a
 * notice, and this surface then shows the notice INSTEAD of a control. A file input
 * that discarded a driver's licence would be worse than no file input, and a
 * spinner that ended in "saved" would be worse still.
 */

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_FILE_BYTES = 10_000_000

/**
 * What the driver is told once the check has run — or has not.
 *
 * The decision itself is never restated here. `commit` revalidates the page, so the
 * record above re-renders with the real state, its expiry and its reason; repeating a
 * verdict in a toast is how a screen ends up contradicting itself. `not_checked` is
 * the one that has to be said out loud: the document IS filed, nobody has decided,
 * and the driver is still blocked.
 */
function outcomeSentence(
  outcome: CredentialActionOutcome | undefined,
  context: "rechecked" | "submitted"
): string {
  // Not "we looked again": nothing was read. The record is filed either way, nobody
  // decided, and the driver is still blocked — all three said plainly.
  if (outcome === "not_checked") {
    return context === "submitted"
      ? "Sent, and filed in your vault. LogLoads could not run the check just now, so this record stays in review — ask for another look in a while."
      : "The check could not run just now, so nothing on this record changed. Try again in a while."
  }

  if (outcome === "approved") {
    return context === "submitted" ? "Sent, checked, and approved." : "Looked at again, and approved."
  }

  return context === "submitted"
    ? "Sent and checked. The decision and the reason for it are on the record above."
    : "Looked at again. The decision and the reason for it are on the record above."
}

interface SignedUploadResponse {
  apiKey: string
  parameters: Record<string, string | number>
  signature: string
  uploadUrl: string
}

/**
 * Reads a JSON body without letting a non-JSON one become the message the driver
 * reads. Gateways and crashed functions answer with HTML, and the caller's own
 * status check is what should decide what to say.
 */
async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * Sends one document for review: signature, then the provider, then the server
 * records it. The record is only written once the bytes are known to exist, which is
 * why the server reads the asset back rather than trusting this client's word for
 * the upload.
 *
 * Rendered only when the read model says intake is available, and it takes the
 * signature endpoint from the read model rather than naming one, so this component
 * cannot outlive the route it depends on.
 */
function CredentialDocumentUpload({
  kind,
  kindLabel,
  replacing,
  signatureEndpoint
}: {
  kind: DriverCredentialSlotView["kind"]
  kindLabel: string
  replacing: boolean
  signatureEndpoint: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldId = useId()
  const expiryId = useId()
  const issuerId = useId()

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get("document")
    const expiresOn = String(data.get("expiresOn") ?? "").trim()
    const issuer = String(data.get("issuer") ?? "").trim()

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a photo of the document first.")
      return
    }

    if (!FILE_TYPES.includes(file.type)) {
      setError("Use a JPG, PNG, or WebP photo.")
      return
    }

    if (file.size > MAX_FILE_BYTES) {
      setError("Photos must be 10 MB or smaller.")
      return
    }

    setError(null)
    setSent(null)
    startTransition(async () => {
      try {
        const signatureResponse = await fetch(signatureEndpoint, {
          body: JSON.stringify({ kind }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        })
        const signature = await readJson<SignedUploadResponse & { error?: string }>(signatureResponse)

        if (!signatureResponse.ok || !signature) {
          throw new Error(signature?.error ?? "Document upload is not available right now.")
        }

        const uploadBody = new FormData()
        uploadBody.append("file", file)
        uploadBody.append("api_key", signature.apiKey)
        uploadBody.append("signature", signature.signature)
        for (const [key, value] of Object.entries(signature.parameters)) {
          uploadBody.append(key, String(value))
        }

        const providerResponse = await fetch(signature.uploadUrl, { body: uploadBody, method: "POST" })
        const asset = await readJson<{ error?: { message?: string }; public_id?: string }>(providerResponse)

        if (!providerResponse.ok || !asset?.public_id) {
          throw new Error(asset?.error?.message ?? "The document could not be uploaded.")
        }

        const saved = await submitDriverCredentialAction({
          expiresOn: expiresOn || null,
          issuer: issuer || null,
          kind,
          publicId: asset.public_id
        })

        if (!saved.ok) {
          throw new Error(saved.error ?? "The document could not be added to your vault.")
        }

        setSent(outcomeSentence(saved.outcome, "submitted"))
        form.reset()
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "The document could not be sent.")
      }
    })
  }

  return (
    <form className="media-upload-card" onSubmit={upload}>
      <label htmlFor={fieldId}>
        {replacing ? `Replace your ${kindLabel.toLowerCase()}` : `Add your ${kindLabel.toLowerCase()}`}
        <input accept={FILE_TYPES.join(",")} id={fieldId} name="document" required type="file" />
      </label>
      {/* The driver states the expiry, and the check refuses the document when the two
          disagree. It is asked for rather than inferred because the vault stores what
          the DRIVER said their document says: a date the platform read and stored
          silently would be a date nobody agreed to, and the driver would be the one
          refused over it later. Blank is a real answer — a photo of a truck prints
          nothing to enter. */}
      <label htmlFor={expiryId}>
        Expiry date printed on it (leave blank only if it prints none)
        <input id={expiryId} name="expiresOn" type="date" />
      </label>
      <label htmlFor={issuerId}>
        Who issued it (optional)
        <input
          autoComplete="off"
          id={issuerId}
          maxLength={200}
          name="issuer"
          placeholder="Your insurer, or the licensing state"
          type="text"
        />
      </label>
      <button className="advance-button" disabled={pending} type="submit">
        <Icon aria-hidden name="action.upload" size={18} />
        {pending ? "Sending…" : replacing ? "Send a replacement" : "Send for review"}
      </button>
      {/* No licence or policy number is asked for anywhere on this screen. */}
      <p>JPG, PNG, or WebP · 10 MB max · kept in your vault, not on your public profile.</p>
      {error ? (
        <p className="action-error" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="action-note" role="status">
          {sent}
        </p>
      ) : null}
    </form>
  )
}

/**
 * Asks for another look at a refusal.
 *
 * The credential id comes from the read model, which sets it only on a record the
 * driver was actually shown — and the server resolves the driver from the session,
 * so this button cannot be aimed at somebody else's record whatever the client
 * sends.
 */
function RequestAnotherLook({ credentialId, kindLabel }: { credentialId: string; kindLabel: string }) {
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const request = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await requestCredentialReviewAction({ credentialId })

        if (!result.ok) {
          throw new Error(result.error ?? "The request could not be sent.")
        }

        setAsked(outcomeSentence(result.outcome, "rechecked"))
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "The request could not be sent.")
      }
    })
  }

  return (
    <div className="feature-toggle-block">
      {/* Disabled once asked, because a re-review reads the SAME document: pressing it
          again spends another check to reach the same answer. */}
      <button
        className="feature-toggle"
        disabled={pending || asked !== null}
        onClick={request}
        type="button"
      >
        {pending
          ? "Checking again…"
          : asked !== null
            ? "Looked at again"
            : `Ask for another look at your ${kindLabel.toLowerCase()}`}
      </button>
      {asked ? (
        <p className="action-note" role="status">
          {asked}
        </p>
      ) : null}
      {error ? (
        <p className="action-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function CredentialSlot({
  intakeAvailable,
  signatureEndpoint,
  slot
}: {
  intakeAvailable: boolean
  signatureEndpoint: string | null
  slot: DriverCredentialSlotView
}) {
  return (
    <li className="verify-record">
      <div className="verify-record__head">
        <strong>{slot.kindLabel}</strong>
        <Badge tone={slot.tone}>{slot.stateLabel}</Badge>
      </div>
      <p className="verify-record__evidence">{slot.detail}</p>

      {slot.requestedEvidence.length > 0 ? (
        <div className="req-block">
          <span className="req-label">Send this</span>
          <ul>
            {slot.requestedEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="fact-row">
        {slot.expiresOnLabel ? <span>Expires {slot.expiresOnLabel}</span> : null}
        {slot.submittedOnLabel ? <span>Sent {slot.submittedOnLabel}</span> : null}
        {/* Said on every record, both ways round. A driver should never have to
            wonder which of their documents a host is looking at. */}
        <span>{slot.hostSeesPhoto ? "Hosts see this photo" : "Never sent to a host"}</span>
      </div>

      {intakeAvailable && signatureEndpoint !== null ? (
        <CredentialDocumentUpload
          kind={slot.kind}
          kindLabel={slot.kindLabel}
          replacing={slot.submittedOnLabel !== null}
          signatureEndpoint={signatureEndpoint}
        />
      ) : null}

      {slot.canRequestReview && slot.reviewCredentialId !== null ? (
        <RequestAnotherLook credentialId={slot.reviewCredentialId} kindLabel={slot.kindLabel} />
      ) : null}

      {slot.reviewLimitation ? <p className="verify-form__hint">{slot.reviewLimitation}</p> : null}
    </li>
  )
}

export function CredentialVault({ vault }: { vault: CredentialVaultView }) {
  const noticeId = useId()

  return (
    <section aria-describedby={noticeId} className="verify-panel">
      {vault.satisfied ? (
        // The sentence is the read model's, not this component's. A screen that wrote
        // its own version of "you're covered" is a second claim about a safety record.
        <p className="action-note" id={noticeId} role="status">
          <Icon aria-hidden name="status.verified" size={18} /> {vault.headline}
        </p>
      ) : (
        // role="alert" on purpose: this is the sentence that stops a driver
        // wondering why the load board keeps refusing them.
        <div className="interrupt" id={noticeId} role="alert">
          <Icon aria-hidden name="status.warning" size={18} />
          <span>
            <strong>{vault.headline}</strong> {vault.blockedNotice}
          </span>
        </div>
      )}

      {vault.expiryNotice ? (
        <div className="interrupt" role="status">
          <Icon aria-hidden name="status.freshness" size={18} />
          <span>{vault.expiryNotice}</span>
        </div>
      ) : null}

      {vault.intake.notice ? (
        <p className="action-note action-note--muted" role="note">
          {vault.intake.notice}
        </p>
      ) : null}

      {vault.noActionAvailableNotice ? (
        <p className="action-note action-note--muted" role="note">
          {vault.noActionAvailableNotice}
        </p>
      ) : null}

      <ul className="verify-records">
        {vault.slots.map((slot) => (
          <CredentialSlot
            intakeAvailable={vault.intake.available}
            key={slot.kind}
            signatureEndpoint={vault.intake.signatureEndpoint}
            slot={slot}
          />
        ))}
      </ul>

      <p className="verify-form__hint">{vault.hostDisclosure}</p>
    </section>
  )
}

// ── The host's side ───────────────────────────────────────────────────────────

/**
 * One record as a host reads it.
 *
 * The image is rendered only when the read model supplies a src, which it does only
 * when something can actually serve it. There is no fallback that guesses a URL: a
 * broken image on a safety record reads as a driver who sent nothing.
 */
function HostCredentialRow({ line }: { line: HostCredentialLineView }) {
  return (
    <li className="verify-record">
      <div className="verify-record__head">
        <strong>{line.kindLabel}</strong>
        <Badge tone={line.tone}>{line.stateLabel}</Badge>
      </div>
      {line.note ? <p className="verify-record__evidence">{line.note}</p> : null}
      {line.expiresOnLabel ? <span className="verify-record__meta">Expires {line.expiresOnLabel}</span> : null}

      {line.photoSrc !== null ? (
        <Image
          alt={`${line.kindLabel} submitted by this driver`}
          className="media-upload-card__image"
          height={360}
          src={line.photoSrc}
          unoptimized
          width={480}
        />
      ) : line.photoOnFile ? (
        <div className="media-upload-card__placeholder">
          <Icon aria-hidden name="ops.document" size={24} /> Photo on file · cannot be shown yet
        </div>
      ) : null}
    </li>
  )
}

/**
 * What a host is told about the driver on their work.
 *
 * Every sentence comes from the read model, including `assurance`, which is the
 * contract's own words. Nothing on this surface may say LogLoads verified a driver,
 * certified them, or stands behind their legal right to operate: LogLoads
 * orchestrates the work, and legitimacy sits between the host and the driver.
 */
export function HostCredentialSummary({ summary }: { summary: HostDriverCredentialSummaryView }) {
  return (
    <section aria-label="Driver records" className="decision-panel">
      <p className="eyebrow">Driver records</p>
      <p>
        <strong>{summary.headline}</strong>
      </p>

      {summary.attentionNotice ? (
        <div className="interrupt" role="alert">
          <Icon aria-hidden name="status.warning" size={18} />
          <span>{summary.attentionNotice}</span>
        </div>
      ) : null}

      <ul className="verify-records">
        {summary.lines.map((line) => (
          <HostCredentialRow key={line.kind} line={line} />
        ))}
      </ul>

      {summary.photoNotice ? <p className="verify-form__hint">{summary.photoNotice}</p> : null}
      <p className="verify-form__hint">{summary.withheldNote}</p>
      <p className="verify-form__hint">{summary.assurance}</p>
    </section>
  )
}
