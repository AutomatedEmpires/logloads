"use client"

import { HAULER_BUSINESS_NAME_MAX_LENGTH, HAULER_HOME_BASE_MAX_LENGTH } from "@logloads/contracts"
import { Button, FormActions, FormField, VisibilityPanel } from "@logloads/ui/primitives"
import { useActionState, useEffect, useRef } from "react"

import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import profileStyles from "@/components/v2/profile/HaulerProfile.module.css"
import { startHaulingBusinessAction } from "@/lib/marketplace-v2/hauler-actions"
import { initialStartBusinessState, START_BUSINESS_FIELD_IDS } from "@/lib/marketplace-v2/hauler-profile-form"

import styles from "./Onboarding.module.css"

const LABELS = { businessName: "Business name", homeBase: "Home base" } as const

/**
 * UX 02 §A3 for an account with no hauling business: the public basics, validated on the server. Where the V2 store
 * can create the business (the normalized store, #213) the action creates and selects it and goes on to the profile;
 * otherwise, or when the store refuses, the answer says so while keeping what was typed.
 */
export function StartBusinessForm({ solo }: { solo: boolean }) {
  const [state, formAction] = useActionState(startHaulingBusinessAction, initialStartBusinessState())
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const error = (field: "businessName" | "homeBase") => state.issues.find((issue) => issue.field === field)?.message

  useEffect(() => {
    if (state.attempt > 0) summaryRef.current?.focus()
  }, [state.attempt])

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.status === "invalid" ? (
        <div className={profileStyles.summary} data-tone="critical" ref={summaryRef} role="alert" tabIndex={-1}>
          <p className={profileStyles.summaryTitle}>{state.issues.length === 1 ? "Fix 1 field to continue:" : `Fix ${state.issues.length} fields to continue:`}</p>
          <ul>
            {state.issues.map((issue) => (
              <li key={issue.field}>
                <a href={`#${START_BUSINESS_FIELD_IDS[issue.field as keyof typeof START_BUSINESS_FIELD_IDS]}`}>
                  {LABELS[issue.field as keyof typeof LABELS]}: {issue.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.status === "unavailable" || state.status === "refused" ? (
        <div className={profileStyles.summary} data-tone="critical" ref={summaryRef} role="alert" tabIndex={-1}>
          <p>{state.message}</p>
        </div>
      ) : null}

      <div className={styles.stack} key={state.attempt}>
        <VisibilityPanel audience="public" title="Seen by landing operators">
          <FormField error={error("businessName")} hint={solo ? "Seen by landing operators. Your own name works if you haul under it." : "Seen by landing operators."} id={START_BUSINESS_FIELD_IDS.businessName} label={LABELS.businessName}>
            <input autoComplete="organization" defaultValue={state.values.businessName} maxLength={HAULER_BUSINESS_NAME_MAX_LENGTH} name="businessName" type="text" />
          </FormField>
          <FormField error={error("homeBase")} hint="Seen by landing operators. A town or ZIP code, never a street address." id={START_BUSINESS_FIELD_IDS.homeBase} label={LABELS.homeBase} optional>
            <input autoComplete="off" defaultValue={state.values.homeBase} maxLength={HAULER_HOME_BASE_MAX_LENGTH} name="homeBase" placeholder="Sweet Home, OR" type="text" />
          </FormField>
        </VisibilityPanel>
      </div>

      <FormActions primary={<PendingSubmitButton label="Continue" />} secondary={<Button href="/v2/work" label="Skip for now" variant="ghost" />} />
    </form>
  )
}
