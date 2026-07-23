"use client"

import Link from "next/link"
import { useActionState, useState, type MouseEvent } from "react"

import {
  completeOnboardingAction,
  signInDemoPersona,
  signInWithEmail,
  type AuthFormState,
  type OnboardingFormState
} from "@/lib/session-actions"
import type { DemoPersona } from "@/lib/demo-personas"

const INITIAL_AUTH_STATE: AuthFormState = { error: null }
const INITIAL_ONBOARDING_STATE: OnboardingFormState = { error: null }

function DemoPersonaLauncher({ personas }: { personas: readonly DemoPersona[] }) {
  return (
    <section aria-labelledby="demo-persona-title" className="demo-personas">
      <div>
        <p className="eyebrow">Local founder demo</p>
        <h2 id="demo-persona-title">Choose a working view.</h2>
        <p>Synthetic records only. Each choice opens the cockpit granted by that account&apos;s membership.</p>
      </div>
      <div className="demo-personas__grid">
        {personas.map((persona) => (
          <form action={signInDemoPersona} key={persona.email}>
            <input name="persona" type="hidden" value={persona.email} />
            <button aria-label={`Continue as ${persona.label}, ${persona.role}`} type="submit">
              <span>{persona.role}</span>
              <strong>{persona.label}</strong>
              <small>{persona.start}</small>
            </button>
          </form>
        ))}
      </div>
    </section>
  )
}

export function DevSignInForm({
  demoPersonas,
  next
}: {
  demoPersonas?: readonly DemoPersona[]
  next?: string
}) {
  const [state, formAction, pending] = useActionState(signInWithEmail, INITIAL_AUTH_STATE)

  return (
    <>
      <form action={formAction} className="auth-form">
        <input name="next" type="hidden" value={next ?? ""} />
        <label>
          <span>{demoPersonas?.length ? "Seeded account email" : "Email"}</span>
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
      {demoPersonas?.length ? <DemoPersonaLauncher personas={demoPersonas} /> : null}
    </>
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
  const [step, setStep] = useState(0)
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

  function advanceStep(event: MouseEvent<HTMLButtonElement>) {
    // Prevent the browser's default action before React swaps this control for
    // the final submit button. Without this, the reused DOM node can submit the
    // form as soon as step 3 renders.
    event.preventDefault()

    const fields = Array.from(
      event.currentTarget.form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-onboarding-step="${step}"] input, [data-onboarding-step="${step}"] select`) ?? []
    )
    const invalid = fields.find((field) => !field.checkValidity())

    if (invalid) {
      invalid.reportValidity()
      return
    }

    setStep((current) => Math.min(current + 1, 2))
  }

  return (
    <form action={formAction} className="onboarding-form">
      <input name="path" type="hidden" value={path} />
      <div className="onboarding-progress" aria-label={`Step ${step + 1} of 3`}>
        <span>Step {step + 1} of 3</span>
        <div aria-hidden>
          {[0, 1, 2].map((index) => <i className={index <= step ? "is-complete" : undefined} key={index} />)}
        </div>
      </div>

      <fieldset data-onboarding-step="0" hidden={step !== 0}>
        <legend>What do you do?</legend>
        <p className="fieldset-note">Pick the closest answer. You can change optional details later.</p>
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
        <label>
          <span>Full name</span>
          <input autoComplete="name" defaultValue={identityKnown?.fullName ?? ""} name="fullName" required type="text" />
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
          <input autoComplete="tel" inputMode="tel" name="phone" placeholder="(555) 555-0100" required type="tel" />
        </label>
      </fieldset>

      <fieldset data-onboarding-step="1" hidden={step !== 1}>
        <legend>What area do you run?</legend>
        <p className="fieldset-note">This puts nearby work first. A city, county, or timber region is enough.</p>
        <label>
          <span>{orgLabel}</span>
          <input autoComplete="organization" name="organizationName" required={path !== "driver"} type="text" />
        </label>
        <label>
          <span>Operating region</span>
          <input name="region" placeholder="Roseburg, OR" required type="text" />
        </label>
      </fieldset>

      {needsEquipment ? (
        <fieldset data-onboarding-step="2" hidden={step !== 2}>
          <legend>Your main setup</legend>
          <p className="fieldset-note">Choose the truck and trailer you use most. Photos and other equipment can wait.</p>
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
          {path === "driver" ? (
            <div className="onboarding-availability">
              <strong>When can you haul?</strong>
              <p className="fieldset-note">Pick one. This keeps your first request simple.</p>
              <div className="radio-grid">
                <label className="radio-card">
                  <input defaultChecked name="availabilityPreset" type="radio" value="today" />
                  <strong>Available today</strong>
                  <span>Show work I can request now.</span>
                </label>
                <label className="radio-card">
                  <input name="availabilityPreset" type="radio" value="three_days" />
                  <strong>Next 3 days</strong>
                  <span>Keep me open for nearby work.</span>
                </label>
                <label className="radio-card">
                  <input name="availabilityPreset" type="radio" value="not_ready" />
                  <strong>Not ready yet</strong>
                  <span>Set up my profile without saying I am available.</span>
                </label>
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : (
        <fieldset data-onboarding-step="2" hidden={step !== 2}>
          <legend>Your operation is ready</legend>
          <p className="fieldset-note">Next, LogLoads will take you to your operation so you can post the work, set the schedule, and choose who can see it.</p>
          <div className="onboarding-ready">
            <strong>{path === "host" ? "Start by posting the timber that needs to move." : "Start by setting up your operation."}</strong>
            <span>Only the information needed for the next decision appears on each screen.</span>
          </div>
        </fieldset>
      )}

      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}

      <div className="onboarding-form__actions">
        {step < 2 ? (
          <button className="action-link" onClick={advanceStep} type="button">Continue</button>
        ) : (
          <button className="action-link" disabled={pending} type="submit">
            {pending ? "Setting up..." : path === "driver" ? "Show me matching loads" : "Open my workspace"}
          </button>
        )}
        {step > 0 ? (
          <button className="text-link" onClick={() => setStep((current) => Math.max(current - 1, 0))} type="button">Back</button>
        ) : (
          <button className="text-link" onClick={() => setPath(null)} type="button">Choose a different role</button>
        )}
      </div>
    </form>
  )
}
