"use client"

import Link from "next/link"
import { useActionState, useState } from "react"

import {
  completeOnboardingAction,
  signInWithEmail,
  type AuthFormState,
  type OnboardingFormState
} from "@/lib/session-actions"

const INITIAL_AUTH_STATE: AuthFormState = { error: null }
const INITIAL_ONBOARDING_STATE: OnboardingFormState = { error: null }

export function DevSignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInWithEmail, INITIAL_AUTH_STATE)

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={next ?? ""} />
      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="action-link" disabled={pending} type="submit">
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p className="auth-form__note">
        New to LogLoads? <Link href="/sign-up">Create your account</Link>.
      </p>
    </form>
  )
}

type OnboardingPath = "driver" | "fleet" | "host"

const PATH_CHOICES: Array<{ path: OnboardingPath; title: string; body: string }> = [
  { body: "Owner-operators, company drivers, and leased-on drivers.", path: "driver", title: "I haul timber" },
  { body: "Fleet owners, dispatchers, and carrier operations.", path: "fleet", title: "I manage trucks" },
  { body: "Landing operators, logging contractors, and timber teams.", path: "host", title: "I have timber to move" }
]

const ACCOUNT_TYPES: Record<OnboardingPath, Array<{ value: string; label: string; hint: string }>> = {
  driver: [
    { hint: "You own and run your truck.", label: "Owner-operator", value: "owner_operator" },
    { hint: "You drive for a carrier.", label: "Company driver", value: "company_driver" },
    { hint: "Your truck runs under another authority.", label: "Leased-on driver", value: "leased_on_driver" }
  ],
  fleet: [
    { hint: "A handful of trucks and drivers.", label: "Small fleet", value: "small_fleet" },
    { hint: "Dedicated dispatch and larger operations.", label: "Larger fleet", value: "fleet" }
  ],
  host: [
    { hint: "You cut and move timber on contract.", label: "Logging contractor", value: "logging_contractor" },
    { hint: "You manage timberland or timber sales.", label: "Timber organization", value: "timber_organization" },
    { hint: "You run the landing day to day.", label: "Landing operator", value: "landing_operator" }
  ]
}

const TRUCK_TYPES = [
  { label: "Log truck", value: "log_truck" },
  { label: "Chip truck", value: "chip_truck" },
  { label: "Lowboy", value: "lowboy" },
  { label: "Other", value: "other" }
]

const TRAILER_TYPES = [
  { label: "No trailer yet", value: "" },
  { label: "Pole trailer", value: "pole_trailer" },
  { label: "Bunk trailer", value: "bunk_trailer" },
  { label: "Self-loader", value: "self_loader" },
  { label: "Chip van", value: "chip_van" },
  { label: "Flatbed", value: "flatbed" },
  { label: "Other", value: "other" }
]

export function OnboardingFlow({
  identityKnown,
  initialPath
}: {
  identityKnown?: { fullName?: string | null; email?: string | null }
  initialPath?: OnboardingPath
}) {
  const [path, setPath] = useState<OnboardingPath | null>(initialPath ?? null)
  const [accountType, setAccountType] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(completeOnboardingAction, INITIAL_ONBOARDING_STATE)

  if (!path) {
    return (
      <div className="choice-grid" role="group" aria-label="How will you use LogLoads?">
        {PATH_CHOICES.map((choice) => (
          <button key={choice.path} onClick={() => setPath(choice.path)} type="button">
            <strong>{choice.title}</strong>
            <span>{choice.body}</span>
          </button>
        ))}
      </div>
    )
  }

  const types = ACCOUNT_TYPES[path]
  const selectedType = accountType ?? types[0]?.value ?? "owner_operator"
  const needsEquipment = path !== "host"
  const orgLabel = path === "host" ? "Company or operation name" : path === "fleet" ? "Fleet name" : "Business name (optional)"

  return (
    <form action={formAction} className="onboarding-form">
      <input name="path" type="hidden" value={path} />
      <fieldset>
        <legend>What describes you best?</legend>
        <div className="radio-grid">
          {types.map((type) => (
            <label className={selectedType === type.value ? "radio-card radio-card--active" : "radio-card"} key={type.value}>
              <input
                checked={selectedType === type.value}
                name="accountType"
                onChange={() => setAccountType(type.value)}
                type="radio"
                value={type.value}
              />
              <strong>{type.label}</strong>
              <span>{type.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>About you</legend>
        <label>
          <span>Full name</span>
          <input defaultValue={identityKnown?.fullName ?? ""} name="fullName" required type="text" />
        </label>
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            defaultValue={identityKnown?.email ?? ""}
            name="email"
            readOnly={Boolean(identityKnown?.email)}
            required
            type="email"
          />
        </label>
        <label>
          <span>Phone</span>
          <input autoComplete="tel" name="phone" placeholder="555-0100" required type="tel" />
        </label>
        <label>
          <span>{orgLabel}</span>
          <input name="organizationName" required={path !== "driver"} type="text" />
        </label>
        <label>
          <span>Operating region</span>
          <input name="region" placeholder="Cascade Foothills, OR" required type="text" />
        </label>
      </fieldset>

      {needsEquipment ? (
        <fieldset>
          <legend>First truck</legend>
          <p className="fieldset-note">Equipment powers matching, availability, and assignments. You can add more later.</p>
          <label>
            <span>Truck type</span>
            <select defaultValue="log_truck" name="truckType">
              {TRUCK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label>
            <span>Trailer</span>
            <select defaultValue="" name="trailerType">
              {TRAILER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label>
            <span>Max payload (tons)</span>
            <input defaultValue={30} max={60} min={1} name="maxPayloadTons" type="number" />
          </label>
        </fieldset>
      ) : null}

      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}

      <div className="onboarding-form__actions">
        <button className="action-link" disabled={pending} type="submit">
          {pending ? "Setting up..." : "Create my account"}
        </button>
        <button className="text-link" onClick={() => setPath(null)} type="button">
          Choose a different path
        </button>
      </div>
    </form>
  )
}
