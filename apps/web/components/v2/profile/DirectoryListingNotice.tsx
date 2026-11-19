"use client"

import { Icon, type IconKey } from "@logloads/ui/icons"
import { Button } from "@logloads/ui/primitives"
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode, type Ref } from "react"

import {
  listingAfterFailure,
  listingRetryChoice,
  listingView,
  type HaulerListingChoice,
  type HaulerListingIntent,
  type HaulerListingState
} from "@/lib/marketplace-v2/hauler-profile-form"

import styles from "./HaulerProfile.module.css"

/** One thing a landing sees about the business ("Business name", "Granite Creek Hauling"). */
export interface DirectoryListingRow {
  key: string
  label: string
  value: string
}

export interface DirectoryListingNoticeProps {
  businessName: string
  /** What a landing sees, built on the server from the same sources as the landing's screens. */
  facts: readonly DirectoryListingRow[]
  initial: HaulerListingState
  /** Owner or manager. Anyone else reads the notice with no listing control (the server refuses them anyway). */
  canEdit: boolean
  /** Whether this store saves the listing; when false the notice says so before any tap. */
  supportsSaving: boolean
  /** Not now: back to the business profile. */
  backHref: string
  /** The tap with scripts on: one save, answered with the new state. */
  action: (previous: HaulerListingState, formData: FormData) => Promise<HaulerListingState>
  /** The same tap posted without scripts: one save, then back to this screen. */
  formAction: (formData: FormData) => Promise<void>
}

const WHO_SEES = "Landing businesses signed in to LogLoads. Not people who are signed out, and not search engines."
const NEVER_SHOWN = "Your phone number, your email and your exact location."
const NAME_NOTE = "If your business name is your own name, landings will see your name."
const COPIES_NOTE = "You can remove the listing in one tap. If someone saved a copy or a link before then, LogLoads cannot take that copy back."
const READ_ONLY = "Only an owner or manager of this business can list it or remove it. You can read what landings see here."
const PREVIEW_ONLY = "Listing isn't available in this preview yet. Nothing you tap here changes your listing."
const OFFLINE = "You're offline. Your listing stays as last saved."

type Tone = "neutral" | "positive" | "critical"

/** The tone is the icon and the 4 px edge as well as the colour, never the colour alone (FG00 Notice 207:1206). */
const TONE_ICON: Record<Tone, IconKey> = { critical: "status.warning", neutral: "status.info", positive: "status.confirmed" }

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/** Next.js navigations (a redirect to sign-in) surface as errors with a digest; they are not a failed tap. */
function isNavigation(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
}

function choiceData(choice: HaulerListingChoice): FormData {
  const data = new FormData()
  data.set("intent", choice.intent)
  data.set("listed", String(choice.listed))
  return data
}

function Notice({
  body,
  bodyId,
  children,
  noticeRef,
  role,
  title,
  titleId,
  tone
}: {
  body: ReactNode
  bodyId: string
  children?: ReactNode
  noticeRef: Ref<HTMLDivElement>
  role?: "status" | "alert"
  title: string
  titleId: string
  tone: Tone
}) {
  return (
    <div className={styles.notice} data-tone={tone} ref={noticeRef} role={role} tabIndex={role ? -1 : undefined}>
      <Icon aria-hidden className={styles.noticeIcon} name={TONE_ICON[tone]} size={24} />
      <div className={styles.noticeText}>
        <p className={styles.noticeTitle} id={titleId}>
          {title}
        </p>
        <p className={styles.noticeBody} id={bodyId}>
          {body}
        </p>
        {children}
      </div>
    </div>
  )
}

/** A quiet aside (FG00 Note 207:1215): an info icon and one or two lines. */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className={styles.note}>
      <Icon aria-hidden className={styles.noteIcon} name="status.info" size={20} />
      <span>{children}</span>
    </p>
  )
}

/** One tap as a form: it posts to `formAction` without scripts; with them `onChoose` handles it in the page. */
function ChoiceForm({
  children,
  choice,
  formAction,
  onChoose
}: {
  children: ReactNode
  choice: HaulerListingChoice
  formAction: (formData: FormData) => Promise<void>
  onChoose: (choice: HaulerListingChoice) => void
}) {
  return (
    <form
      action={formAction}
      className={styles.choiceForm}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        onChoose(choice)
      }}
    >
      <input name="intent" type="hidden" value={choice.intent} />
      <input name="listed" type="hidden" value={String(choice.listed)} />
      {children}
    </form>
  )
}

function Facts({ rows }: { rows: readonly DirectoryListingRow[] }) {
  return (
    <dl className={styles.facts}>
      {rows.map((row) => (
        <div className={styles.fact} data-fact={row.key} key={row.key}>
          <dt className={styles.factLabel}>{row.label}</dt>
          <dd className={styles.factValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The directory listing notice (#423, LL-UI05; Figma 04 Settings: not listed 361:4236 / 361:4523 / 361:4739, listed
 * 361:4954 / 361:5163 / 361:5372, removed with Undo 361:5581 / 361:5799 / 361:6009, offline 361:6219 / 361:6457 /
 * 361:6682, not saved 361:6907 / 361:7131 / 361:7347, dark 361:7563).
 *
 * It says exactly what landings see, who sees it, what is never shown and that saved copies stay (legal review §6.5),
 * then one tap: List my profile, or Remove my listing with Undo. Each tap is a form that posts without scripts
 * (`formAction`); with scripts it is one call to `action`, so the page keeps its place. Offline nothing is sent and
 * the last saved listing stays. Focus follows the answer: to Undo after a removal, otherwise to the notice, which is
 * a status (or an alert when the tap failed). Every word is text on the page, never a tooltip.
 */
export function DirectoryListingNotice({ action, backHref, businessName, canEdit, facts, formAction, initial, supportsSaving }: DirectoryListingNoticeProps) {
  const [state, setState] = useState(initial)
  const [offline, setOffline] = useState(false)
  const [sending, setSending] = useState<HaulerListingIntent | null>(null)
  const [, startTransition] = useTransition()
  const noticeRef = useRef<HTMLDivElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const bodyId = `${id}-body`

  useEffect(() => {
    const update = () => setOffline(isOffline())
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  // After each tap, focus goes to what answers it.
  useEffect(() => {
    if (state.attempt === 0) return
    if (state.status === "offline") bannerRef.current?.focus()
    else if (listingView(state).canUndo) undoRef.current?.focus()
    else noticeRef.current?.focus()
  }, [state])

  function submit(choice: HaulerListingChoice) {
    if (sending) return

    if (isOffline()) {
      setOffline(true)
      setState((current) => listingAfterFailure(current, choice, "offline"))
      return
    }

    const before = state
    setSending(choice.intent)
    startTransition(async () => {
      try {
        const next = await action(before, choiceData(choice))
        setState(next)
      } catch (error) {
        if (isNavigation(error)) throw error
        const reason = isOffline() ? "offline" : "unreachable"
        if (reason === "offline") setOffline(true)
        setState((current) => listingAfterFailure(current, choice, reason))
      } finally {
        setSending(null)
      }
    })
  }

  function retryOffline() {
    const choice = state.status === "offline" ? listingRetryChoice(state) : null

    if (isOffline()) {
      bannerRef.current?.focus()
      return
    }

    setOffline(false)
    if (choice) submit(choice)
  }

  const tap = { formAction, onChoose: submit }
  const { canUndo, failed, view } = listingView(state)
  const retry = listingRetryChoice(state)
  const answered = state.attempt > 0 || state.status !== "idle"
  const heading = view === "listed" ? "What landings see" : view === "removed" ? "If you list it again, landings will see" : "If you list it, landings will see"

  let notice: ReactNode

  if (failed) {
    notice = (
      <Notice
        body={
          <>
            {state.message}
            {state.reference ? ` Reference: ${state.reference}` : null}
          </>
        }
        bodyId={bodyId}
        noticeRef={noticeRef}
        role="alert"
        title={state.intent === "remove" ? "Your listing was not removed" : "Your profile was not listed"}
        titleId={titleId}
        tone="critical"
      >
        {canEdit && retry && (state.status === "error" || state.status === "unreachable") ? (
          <ChoiceForm {...tap} choice={retry}>
            <Button className={styles.noticeAction} label="Try again" loading={sending === retry.intent} type="submit" variant="secondary" />
          </ChoiceForm>
        ) : null}
      </Notice>
    )
  } else if (view === "removed") {
    notice = (
      <Notice
        body={`Landings can no longer find ${businessName} in Find trucks. You can still send interest in jobs.`}
        bodyId={bodyId}
        noticeRef={noticeRef}
        role="status"
        title="Your listing is removed"
        titleId={titleId}
        tone="positive"
      >
        {canEdit && canUndo ? (
          <ChoiceForm {...tap} choice={{ intent: "undo", listed: true }}>
            <Button
              aria-describedby={`${titleId} ${bodyId}`}
              className={styles.noticeAction}
              label="Undo"
              loading={sending === "undo"}
              ref={undoRef}
              type="submit"
              variant="secondary"
            />
          </ChoiceForm>
        ) : null}
      </Notice>
    )
  } else if (view === "listed") {
    notice = (
      <Notice
        body="Landing businesses signed in to LogLoads can find you in Find trucks."
        bodyId={bodyId}
        noticeRef={noticeRef}
        role={answered ? "status" : undefined}
        title={`${businessName} is listed`}
        titleId={titleId}
        tone="positive"
      />
    )
  } else {
    notice = (
      <Notice
        body="You can still send interest in any job. A landing sees your business when you send interest or reply."
        bodyId={bodyId}
        noticeRef={noticeRef}
        role={answered ? "status" : undefined}
        title={`${businessName} is not in the directory`}
        titleId={titleId}
        tone="neutral"
      />
    )
  }

  return (
    <div className={styles.listing} data-listing-view={view}>
      {offline ? (
        <div className={styles.offline} ref={bannerRef} role="status" tabIndex={-1}>
          <Icon aria-hidden className={styles.offlineIcon} name="status.offline" size={24} />
          <p className={styles.offlineText}>{state.status === "offline" && state.message ? state.message : OFFLINE}</p>
          <Button className={styles.offlineAction} label="Retry" onClick={retryOffline} variant="ghost" />
        </div>
      ) : null}

      {notice}

      {canEdit && !supportsSaving && !answered ? <Note>{PREVIEW_ONLY}</Note> : null}
      {canEdit ? null : <Note>{READ_ONLY}</Note>}

      <h2 className={styles.listingHeading}>{heading}</h2>
      <Facts rows={facts} />
      <Note>{NAME_NOTE}</Note>

      <h2 className={styles.listingHeading}>Who can see it</h2>
      <Facts
        rows={[
          { key: "audience", label: "Who sees it", value: WHO_SEES },
          { key: "neverShown", label: "Never shown", value: NEVER_SHOWN }
        ]}
      />
      <Note>{COPIES_NOTE}</Note>

      {canEdit ? (
        view === "listed" ? (
          <div className={styles.listingActions}>
            <ChoiceForm {...tap} choice={{ intent: "remove", listed: false }}>
              <Button label="Remove my listing" loading={sending === "remove"} size="lg" type="submit" variant="secondary" />
            </ChoiceForm>
          </div>
        ) : (
          // The primary action: in the bottom bar below bp-sm (FG04 390 frames), in the flow above it.
          <div className={styles.listingActions} data-bar="">
            <ChoiceForm {...tap} choice={{ intent: "list", listed: true }}>
              <Button className={styles.listingPrimary} label="List my profile" loading={sending === "list"} size="lg" type="submit" />
            </ChoiceForm>
            {view === "notListed" ? <Button className={styles.listingSecondary} href={backHref} label="Not now" size="lg" variant="secondary" /> : null}
          </div>
        )
      ) : null}
    </div>
  )
}
