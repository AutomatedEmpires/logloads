"use client"

import {
  HAULER_ABOUT_MAX_LENGTH,
  HAULER_BUSINESS_NAME_MAX_LENGTH,
  HAULER_HOME_BASE_MAX_LENGTH,
  HAULER_LEGAL_NAME_MAX_LENGTH,
  HAULER_SERVICE_RADIUS_CHOICES,
  type HaulerProfileField
} from "@logloads/contracts"
import { Button, FormActions, FormField, VisibilityPanel } from "@logloads/ui/primitives"
import { useActionState, useEffect, useRef } from "react"

import { FormCheckbox } from "@/components/v2/FormCheckbox"
import { PageNotice } from "@/components/v2/PageNotice"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { saveHaulerProfileAction } from "@/lib/marketplace-v2/hauler-actions"
import { PROFILE_FIELD_IDS, type HaulerProfileFormState } from "@/lib/marketplace-v2/hauler-profile-form"

import styles from "./HaulerProfile.module.css"

const FIELD_LABELS: Readonly<Record<HaulerProfileField, string>> = {
  about: "About",
  acceptsInvitations: "Job invitations",
  businessName: "Business name",
  homeBase: "Home base",
  legalName: "Legal name",
  listed: "Who sees your profile",
  serviceRadiusMiles: "How far you travel"
}

const PUBLIC = "Seen by landing operators."
const PRIVATE = "Private: never shown on your profile."

export interface HaulerProfileFormProps {
  initial: HaulerProfileFormState
  canEditProfile: boolean
  canEditIdentity: boolean
  /** The sign-in email, shown read-only in the private panel. */
  accountEmail: string | null
  /** The business has a verified identity: changing the legal name re-opens the review. */
  verified: boolean
  /** Whether this store saves the profile; when false the page says so before anything is typed. */
  supportsSaving: boolean
  /** Known towns ("Sweet Home, OR") offered as suggestions for the home base. */
  places: readonly string[]
  /** Setup step 2 (UX 02 §A3): Save and continue, or Skip to `skipHref`. */
  setup: boolean
  skipHref: string
}

/** What happened on the last submission, above the form. Errors are an `alert`; a confirmation is a `status`. */
function Summary({ state, summaryRef }: { state: HaulerProfileFormState; summaryRef: React.RefObject<HTMLDivElement | null> }) {
  if (state.status === "idle") return null

  if (state.status === "invalid") {
    return (
      <div className={styles.summary} data-tone="critical" ref={summaryRef} role="alert" tabIndex={-1}>
        <p className={styles.summaryTitle}>
          {state.issues.length === 1 ? "Fix 1 field to save your profile:" : `Fix ${state.issues.length} fields to save your profile:`}
        </p>
        <ul>
          {state.issues.map((issue) => (
            <li key={issue.field}>
              <a href={`#${PROFILE_FIELD_IDS[issue.field]}`}>
                {FIELD_LABELS[issue.field]}: {issue.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const saved = state.status === "saved"

  return (
    <div className={styles.summary} data-tone={saved ? "positive" : "critical"} ref={summaryRef} role={saved ? "status" : "alert"} tabIndex={-1}>
      <p>{state.message}</p>
    </div>
  )
}

/**
 * The hauling business profile form (UX 02 §A3, §5.1; #125): a "Seen by landing operators" panel and a "Private"
 * panel, and every field's hint says who sees it. It posts to a server action, so it works without JavaScript; the
 * action validates on the server and answers with the posted values, which the form shows again whatever happened.
 */
export function HaulerProfileForm({
  accountEmail,
  canEditIdentity,
  canEditProfile,
  initial,
  places,
  setup,
  skipHref,
  supportsSaving,
  verified
}: HaulerProfileFormProps) {
  const [state, formAction] = useActionState(saveHaulerProfileAction, initial)
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const values = state.values
  const error = (field: HaulerProfileField) => state.issues.find((issue) => issue.field === field)?.message
  const identityHint = canEditIdentity ? "" : " Only the owner of this business can change it."
  const radiusChoices: readonly string[] = HAULER_SERVICE_RADIUS_CHOICES.map(String)
  const otherRadius = values.serviceRadiusMiles !== "" && !radiusChoices.includes(values.serviceRadiusMiles) ? values.serviceRadiusMiles : null

  useEffect(() => {
    if (state.attempt > 0) summaryRef.current?.focus()
  }, [state.attempt])

  return (
    <form action={formAction} className={styles.form} noValidate>
      {setup ? <input name="setup" type="hidden" value="1" /> : null}
      <Summary state={state} summaryRef={summaryRef} />
      {!supportsSaving && state.status === "idle" ? (
        <PageNotice role="note">Saving your business profile isn&apos;t available in this preview yet. You can fill in the form, but nothing will be saved.</PageNotice>
      ) : null}
      {!canEditProfile ? (
        <PageNotice role="note">Only an owner or manager of this business can change its profile. You can read it here.</PageNotice>
      ) : null}

      {/* Remounted after each submission, so the fields show the values the server answered with. */}
      <fieldset className={styles.fields} disabled={!canEditProfile} key={state.attempt}>
        <legend className={styles.visuallyHidden}>Business profile</legend>
        <div className={styles.panels}>
          <VisibilityPanel audience="public" title="Seen by landing operators">
            <FormField
              error={error("businessName")}
              hint={`${PUBLIC}${identityHint}`}
              id={PROFILE_FIELD_IDS.businessName}
              label={FIELD_LABELS.businessName}
            >
              <input
                autoComplete="organization"
                defaultValue={values.businessName}
                maxLength={HAULER_BUSINESS_NAME_MAX_LENGTH}
                name="businessName"
                readOnly={!canEditIdentity}
                type="text"
              />
            </FormField>
            <FormField
              error={error("homeBase")}
              hint={`${PUBLIC} A town or ZIP code, never a street address. Choose the nearest town on the list.`}
              id={PROFILE_FIELD_IDS.homeBase}
              label={FIELD_LABELS.homeBase}
              optional
            >
              <input
                autoComplete="off"
                defaultValue={values.homeBase}
                list="profile-home-base-places"
                maxLength={HAULER_HOME_BASE_MAX_LENGTH}
                name="homeBase"
                placeholder="Sweet Home, OR"
                type="text"
              />
            </FormField>
            <datalist id="profile-home-base-places">
              {places.map((place) => (
                <option key={place} value={place} />
              ))}
            </datalist>
            <FormField
              error={error("serviceRadiusMiles")}
              hint={`${PUBLIC} From your home base.`}
              id={PROFILE_FIELD_IDS.serviceRadiusMiles}
              label={FIELD_LABELS.serviceRadiusMiles}
              optional
            >
              <select defaultValue={values.serviceRadiusMiles} name="serviceRadiusMiles">
                <option value="">Not stated</option>
                {otherRadius ? <option value={otherRadius}>Up to {otherRadius} miles</option> : null}
                {HAULER_SERVICE_RADIUS_CHOICES.map((miles) => (
                  <option key={miles} value={String(miles)}>
                    Up to {miles} miles
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              error={error("about")}
              hint={`${PUBLIC} What you haul and where, in a few lines.`}
              id={PROFILE_FIELD_IDS.about}
              label={FIELD_LABELS.about}
              optional
            >
              <textarea defaultValue={values.about} maxLength={HAULER_ABOUT_MAX_LENGTH} name="about" rows={4} />
            </FormField>
            <div className={styles.setting}>
              <FormCheckbox
                defaultChecked={values.listed}
                hint="A setting, not shown on your profile. When it is off, a landing sees your profile only after you send it interest."
                id={PROFILE_FIELD_IDS.listed}
                label="Show my profile to every landing operator"
                name="listed"
              />
            </div>
          </VisibilityPanel>

          <VisibilityPanel audience="private" title="Private · only your team">
            <FormField
              error={error("legalName")}
              hint={`${PRIVATE} Used when LogLoads reviews your business identity.${verified ? " Changing it sends your business back to that review." : ""}${identityHint}`}
              id={PROFILE_FIELD_IDS.legalName}
              label={FIELD_LABELS.legalName}
              optional
            >
              <input
                defaultValue={values.legalName}
                maxLength={HAULER_LEGAL_NAME_MAX_LENGTH}
                name="legalName"
                readOnly={!canEditIdentity}
                type="text"
              />
            </FormField>
            {accountEmail ? (
              <div className={styles.readOnly}>
                <p className={styles.readOnlyLabel}>Sign-in email</p>
                <p className={styles.readOnlyHint}>{PRIVATE} It comes from your sign-in; this form does not change it.</p>
                <p className={styles.readOnlyValue}>{accountEmail}</p>
              </div>
            ) : null}
            <div className={styles.readOnly}>
              <p className={styles.readOnlyLabel}>How landings reach you</p>
              <p className={styles.readOnlyHint}>You choose LogLoads messages, phone or email each time you send interest.</p>
            </div>
            <div className={styles.setting}>
              <FormCheckbox
                defaultChecked={values.acceptsInvitations}
                hint="Off unless you turn it on. Invitations reach you only while your profile is shown to every landing operator."
                id={PROFILE_FIELD_IDS.acceptsInvitations}
                label="Landing operators may send me job invitations"
                name="acceptsInvitations"
              />
            </div>
          </VisibilityPanel>
        </div>
      </fieldset>

      {canEditProfile || setup ? (
        <FormActions
          primary={canEditProfile ? <PendingSubmitButton label={setup ? "Save and continue" : "Save profile"} /> : <Button href={skipHref} label="Continue" />}
          secondary={setup && canEditProfile ? <Button href={skipHref} label="Skip for now" variant="ghost" /> : undefined}
        />
      ) : null}
    </form>
  )
}
