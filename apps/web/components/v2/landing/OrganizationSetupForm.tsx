"use client"

import { MARKETPLACE_LANDING_LIMITS } from "@logloads/contracts"
import { FormActions, FormField, VisibilityPanel } from "@logloads/ui/primitives"
import { useActionState } from "react"

import { createLandingOrganizationAction } from "@/lib/marketplace-v2/landing-actions"
import { INITIAL_ORGANIZATION_FORM_STATE } from "@/lib/marketplace-v2/landing-workspace"

import { PageNotice } from "../PageNotice"
import { PendingSubmitButton } from "../PendingSubmitButton"
import styles from "./landing.module.css"

/**
 * B1: a landing business (#127). Only what the store holds is asked for: the public name and home state. The contact
 * route is not a choice yet: first contact is always through LogLoads messages (UX-DEC-04). Posts without JavaScript.
 */
export function OrganizationSetupForm() {
  const [state, action] = useActionState(createLandingOrganizationAction, INITIAL_ORGANIZATION_FORM_STATE)

  if (state.outcome === "created") {
    return (
      <PageNotice role="status" tone="positive">
        <p>
          <strong>{state.createdName}</strong> is set up, with you as its owner, and you are acting for it now. It is in
          your business switcher at the top of the page.
        </p>
      </PageNotice>
    )
  }

  return (
    <form action={action} className={styles.form} noValidate>
      {state.message ? (
        <PageNotice role={state.outcome === "unavailable" ? "status" : "alert"} tone={state.outcome === "unavailable" ? "info" : "critical"}>
          <p>{state.message}</p>
        </PageNotice>
      ) : null}

      <VisibilityPanel audience="public" title="Seen by haulers">
        <FormField error={state.fieldErrors.displayName} id="organization-name" label="Business name">
          <input autoComplete="organization" defaultValue={state.values.displayName} maxLength={MARKETPLACE_LANDING_LIMITS.organizationName} name="displayName" required type="text" />
        </FormField>
        <FormField error={state.fieldErrors.homeState} hint="Two letters, for example OR." id="organization-state" label="Home state" optional>
          <input autoComplete="address-level1" defaultValue={state.values.homeState} maxLength={2} name="homeState" type="text" />
        </FormField>
      </VisibilityPanel>

      <VisibilityPanel audience="private" title="Private · only you and your team">
        <p className={styles.note}>
          <strong>How haulers reach you:</strong> through LogLoads messages, on every job. Your phone and email are never
          shown on a listing.
        </p>
      </VisibilityPanel>

      <FormActions primary={<PendingSubmitButton label="Set up business" />} />
    </form>
  )
}
