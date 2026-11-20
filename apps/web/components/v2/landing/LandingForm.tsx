"use client"

import { MARKETPLACE_LANDING_LIMITS } from "@logloads/contracts"
import { Button, FormActions, FormField, VisibilityPanel } from "@logloads/ui/primitives"
import { useActionState } from "react"

import { saveLandingAction } from "@/lib/marketplace-v2/landing-actions"
import { LANDINGS_PATH, PLANS_HREF, type LandingFormState } from "@/lib/marketplace-v2/landing-workspace"

import { FormCheckbox } from "../FormCheckbox"
import { PageNotice } from "../PageNotice"
import { PendingSubmitButton } from "../PendingSubmitButton"
import styles from "./landing.module.css"

export interface LandingFormProps {
  initialState: LandingFormState
  /** Editing this landing; `null` adds a new one. */
  landingId: string | null
  /** New landings only: the plan count under "Recruiting now", worded from the contracts' plan. */
  recruiting?: { hint: string; possible: boolean } | null
}

/**
 * B3: add or edit a landing (#127). The "Seen by haulers" panel is the public half; "Private · your team only" is
 * what the landing's own team sees. The server action keeps what was typed when it refuses or cannot save, and the
 * form posts without JavaScript. A missing exact location never blocks saving.
 */
export function LandingForm({ initialState, landingId, recruiting = null }: LandingFormProps) {
  const [state, action] = useActionState(saveLandingAction, initialState)
  const values = state.values
  const errors = state.fieldErrors
  const tone = state.outcome === "unavailable" ? "info" : "critical"

  return (
    <form action={action} className={styles.form} noValidate>
      {landingId ? <input name="landingId" type="hidden" value={landingId} /> : null}

      {state.message ? (
        <PageNotice role={state.outcome === "unavailable" ? "status" : "alert"} tone={tone}>
          <p>{state.message}</p>
          {state.outcome === "at_cap" || state.outcome === "billing_inactive" ? (
            <p>
              {state.outcome === "at_cap" ? <><a href={LANDINGS_PATH}>Pause another landing</a> or </> : null}
              <a href={PLANS_HREF}>See plans</a>. You can also untick Recruiting now and save it paused.
            </p>
          ) : null}
        </PageNotice>
      ) : null}

      <VisibilityPanel audience="public" title="Seen by haulers">
        <FormField error={errors.name} id="landing-name" label="Landing name">
          <input autoComplete="off" defaultValue={values.name} maxLength={MARKETPLACE_LANDING_LIMITS.name} name="name" required type="text" />
        </FormField>
        <div className={styles.grid2}>
          <FormField
            error={errors.areaLabel}
            hint="Haulers see this town and an approximate area on the 0.1° public grid, never your site."
            id="landing-area"
            label="Nearest town"
          >
            <input defaultValue={values.areaLabel} maxLength={MARKETPLACE_LANDING_LIMITS.areaLabel} name="areaLabel" required type="text" />
          </FormField>
          <FormField error={errors.stateCode} hint="Two letters, for example OR." id="landing-state" label="State">
            <input autoComplete="address-level1" defaultValue={values.stateCode} maxLength={2} name="stateCode" required type="text" />
          </FormField>
        </div>
        <FormField error={errors.county} id="landing-county" label="County" optional>
          <input defaultValue={values.county} maxLength={MARKETPLACE_LANDING_LIMITS.county} name="county" type="text" />
        </FormField>
        <FormField error={errors.typicalHours} hint="For example 5 a.m. to 3 p.m., Monday to Friday." id="landing-hours" label="Typical hours" optional>
          <input defaultValue={values.typicalHours} maxLength={MARKETPLACE_LANDING_LIMITS.typicalHours} name="typicalHours" type="text" />
        </FormField>
        <FormField
          error={errors.publicRoadNotes}
          hint="Road conditions only. Never gate codes, combinations or coordinates: those go in the private section."
          id="landing-road"
          label="Public road notes"
          optional
        >
          <textarea defaultValue={values.publicRoadNotes} maxLength={MARKETPLACE_LANDING_LIMITS.publicRoadNotes} name="publicRoadNotes" rows={3} />
        </FormField>
      </VisibilityPanel>

      <VisibilityPanel audience="private" title="Private · your team only">
        <fieldset aria-describedby="landing-exact-hint" className={styles.fieldset}>
          <legend className={styles.legend}>Exact location <span className={styles.note}>(optional)</span></legend>
          <p className={styles.hint} id="landing-exact-hint">
            Saving works without it. Never on a listing or a map: haulers see only the approximate area. Copy the
            decimal coordinates from your map app.
          </p>
          <div className={styles.grid2}>
            <FormField error={errors.exactLat} id="landing-lat" label="Latitude">
              <input defaultValue={values.exactLat} inputMode="decimal" name="exactLat" type="text" />
            </FormField>
            <FormField error={errors.exactLng} id="landing-lng" label="Longitude">
              <input defaultValue={values.exactLng} inputMode="decimal" name="exactLng" type="text" />
            </FormField>
          </div>
        </fieldset>
        <FormField
          error={errors.gateInstructions}
          hint="Never on a listing. Sharing it with a hauler comes after the policy review."
          id="landing-gate"
          label="Gate and access instructions"
          optional
        >
          <textarea defaultValue={values.gateInstructions} maxLength={MARKETPLACE_LANDING_LIMITS.gateInstructions} name="gateInstructions" rows={3} />
        </FormField>
        <div className={styles.grid2}>
          <FormField error={errors.siteContactName} id="landing-contact" label="Site contact" optional>
            <input autoComplete="off" defaultValue={values.siteContactName} maxLength={MARKETPLACE_LANDING_LIMITS.siteContactName} name="siteContactName" type="text" />
          </FormField>
          <FormField error={errors.siteContactPhone} id="landing-phone" label="Contact phone" optional>
            <input autoComplete="off" defaultValue={values.siteContactPhone} inputMode="tel" name="siteContactPhone" type="tel" />
          </FormField>
        </div>
      </VisibilityPanel>

      {recruiting ? (
        <div className={styles.stack}>
          <FormCheckbox
            defaultChecked={values.recruiting === "1" && recruiting.possible}
            disabled={!recruiting.possible}
            hint={recruiting.hint}
            id="landing-recruiting"
            label="Recruiting now"
            name="recruiting"
            value="1"
          />
          {recruiting.possible ? null : (
            <p className={styles.links}>
              <a href={LANDINGS_PATH}>Pause another landing</a>
              <span aria-hidden="true">·</span>
              <a href={PLANS_HREF}>See plans</a>
            </p>
          )}
        </div>
      ) : null}

      <FormActions
        primary={<PendingSubmitButton label="Save landing" />}
        secondary={<Button href={LANDINGS_PATH} label="Cancel" variant="ghost" />}
      />
    </form>
  )
}
