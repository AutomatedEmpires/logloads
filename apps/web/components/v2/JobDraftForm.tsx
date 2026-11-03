import {
  MARKETPLACE_DRAFT_LIMITS,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_PAY_UNIT_LABELS,
  MARKETPLACE_PRODUCTS,
  marketplacePayUnitSchema,
  type MarketplaceDraftIssue,
  type MarketplaceDraftLandingContext
} from "@logloads/contracts"
import type { ReactNode } from "react"

import type { DraftFormValues, DraftTextField } from "@/lib/marketplace-v2/draft-params"

function FieldError({ field, issues }: { field: string; issues: MarketplaceDraftIssue[] }) {
  const messages = issues.filter((issue) => issue.field === field).map((issue) => issue.message)
  return messages.length > 0 ? <span className="v2-field-error" id={`${field}-error`} role="alert">{messages.join(" ")}</span> : null
}

function Field({ children, field, hint, issues, label, optional = false }: {
  children: ReactNode
  field: string
  hint?: string
  issues: MarketplaceDraftIssue[]
  label: string
  optional?: boolean
}) {
  return (
    <label className={issues.some((issue) => issue.field === field) ? "v2-field v2-field--invalid" : "v2-field"}>
      <span>{label}{optional ? <span className="v2-muted"> (optional)</span> : null}</span>
      {children}
      {hint ? <span className="v2-muted v2-hint">{hint}</span> : null}
      <FieldError field={field} issues={issues} />
    </label>
  )
}

/**
 * Native V2 job form (UX spec §8 "Create/Edit Job"). Submits with GET to the preview, so the poster
 * sees exactly what haulers will see before anything could be published. Short by default: optional
 * estimates sit in a collapsed section. Pay is always required (C1); product and timing are required
 * to publish (UX-DEC-02, UX-DEC-03). There is no contact field (UX-DEC-04), and no availability
 * attestation here: that is ticked on the preview, so editing a draft never confirms anything.
 */
export function JobDraftForm({ issues, landings, values }: {
  issues: MarketplaceDraftIssue[]
  landings: MarketplaceDraftLandingContext[]
  values: DraftFormValues
}) {
  const v = (name: DraftTextField) => values.text[name] ?? ""
  const invalid = (name: string) => issues.some((issue) => issue.field === name) || undefined
  const describedBy = (name: string) => (invalid(name) ? `${name}-error` : undefined)

  return (
    <form action="/v2/landing/jobs/preview" className="v2-form v2-job-form" method="get" noValidate>
      <section aria-labelledby="draft-basics">
        <h2 id="draft-basics">The job</h2>
        <Field field="landingId" issues={issues} label="Landing">
          <select aria-describedby={describedBy("landingId")} aria-invalid={invalid("landingId")} defaultValue={v("landingId")} name="landingId" required>
            <option value="">Choose a landing</option>
            {landings.map((landing) => <option key={landing.id} value={landing.id}>{landing.name} — {landing.areaLabel}</option>)}
          </select>
        </Field>
        <Field field="title" hint="Haulers see this first, e.g. “Doug-fir saw logs to Springfield”." issues={issues} label="Title">
          <input aria-describedby={describedBy("title")} aria-invalid={invalid("title")} defaultValue={v("title")} maxLength={140} name="title" required />
        </Field>
        <Field field="product" hint="Required to publish." issues={issues} label="Product">
          <select aria-describedby={describedBy("product")} aria-invalid={invalid("product")} defaultValue={v("product")} name="product">
            <option value="">Choose a product</option>
            {MARKETPLACE_PRODUCTS.map((product) => <option key={product} value={product}>{product === "Other" ? "Other (describe)" : product}</option>)}
          </select>
        </Field>
        <Field field="productOther" hint="Only for Other: what is being hauled, up to 120 characters." issues={issues} label="Describe the product">
          <input aria-describedby={describedBy("productOther")} aria-invalid={invalid("productOther")} defaultValue={v("productOther")} maxLength={120} name="productOther" />
        </Field>
        <fieldset className={invalid("equipment") ? "v2-field v2-field--invalid" : "v2-field"}>
          <legend>Equipment required</legend>
          <div className="v2-checks">
            {MARKETPLACE_EQUIPMENT_TYPES.map((type) => (
              <label className="v2-check" key={type.code}>
                <input defaultChecked={values.equipment.includes(type.code)} name="equipment" type="checkbox" value={type.code} />
                <span>{type.label}</span>
              </label>
            ))}
          </div>
          <FieldError field="equipment" issues={issues} />
        </fieldset>
      </section>

      <section aria-labelledby="draft-pay">
        <h2 id="draft-pay">Advertised pay</h2>
        <p className="v2-muted">Required: an amount and what it is per, or Negotiable with a note on how pay is set.</p>
        <div className="v2-form__pair">
          <Field field="payAmount" hint="Leave blank for negotiable pay." issues={issues} label="Amount ($)">
            <input aria-describedby={describedBy("payAmount")} aria-invalid={invalid("payAmount")} defaultValue={v("payAmount")} inputMode="decimal" name="payAmount" placeholder="525" />
          </Field>
          <Field field="payUnit" issues={issues} label="Pay basis">
            <select aria-describedby={describedBy("payUnit")} aria-invalid={invalid("payUnit")} defaultValue={v("payUnit")} name="payUnit" required>
              <option value="">Choose a basis</option>
              {marketplacePayUnitSchema.options.map((unit) => <option key={unit} value={unit}>{MARKETPLACE_PAY_UNIT_LABELS[unit]}</option>)}
            </select>
          </Field>
        </div>
        <Field field="payNote" hint="Required for negotiable pay or another basis. No phone numbers, email addresses or access details." issues={issues} label="Pay note" optional>
          <input aria-describedby={describedBy("payNote")} aria-invalid={invalid("payNote")} defaultValue={v("payNote")} maxLength={300} name="payNote" />
        </Field>
      </section>

      <section aria-labelledby="draft-demand">
        <h2 id="draft-demand">Trucks and schedule</h2>
        <div className="v2-form__pair">
          <Field field="trucksRequested" issues={issues} label="Trucks for the job">
            <input aria-describedby={describedBy("trucksRequested")} aria-invalid={invalid("trucksRequested")} defaultValue={v("trucksRequested") || "1"} inputMode="numeric" max={MARKETPLACE_DRAFT_LIMITS.trucksRequested} min={1} name="trucksRequested" required type="number" />
          </Field>
          <Field field="trucksPerDay" issues={issues} label="Trucks per day" optional>
            <input aria-describedby={describedBy("trucksPerDay")} aria-invalid={invalid("trucksPerDay")} defaultValue={v("trucksPerDay")} inputMode="numeric" min={1} name="trucksPerDay" type="number" />
          </Field>
        </div>
        <Field field="startsOn" hint="Required to publish." issues={issues} label="Expected start">
          <input aria-describedby={describedBy("startsOn")} aria-invalid={invalid("startsOn")} defaultValue={v("startsOn")} name="startsOn" type="date" />
        </Field>
        <fieldset
          aria-describedby={invalid("workPeriod") ? "workPeriod-error" : undefined}
          className={invalid("workPeriod") ? "v2-field v2-field--invalid" : "v2-field"}
        >
          <legend>How long it runs</legend>
          <span className="v2-muted v2-hint">Required to publish: give one of an end date, a duration, or Ongoing.</span>
          <div className="v2-form__pair">
            <Field field="endsOn" issues={issues} label="End date">
              <input aria-describedby={describedBy("endsOn")} aria-invalid={invalid("endsOn")} defaultValue={v("endsOn")} name="endsOn" type="date" />
            </Field>
            <Field field="durationDays" issues={issues} label="Duration (days)">
              <input aria-describedby={describedBy("durationDays")} aria-invalid={invalid("durationDays")} defaultValue={v("durationDays")} inputMode="numeric" max={MARKETPLACE_DRAFT_LIMITS.durationDays} min={1} name="durationDays" type="number" />
            </Field>
          </div>
          <label className="v2-check">
            <input aria-invalid={invalid("ongoing")} defaultChecked={v("ongoing") === "1"} name="ongoing" type="checkbox" value="1" />
            <span>Ongoing: no set end date</span>
          </label>
          <FieldError field="ongoing" issues={issues} />
          <FieldError field="workPeriod" issues={issues} />
        </fieldset>
      </section>

      <section aria-labelledby="draft-route">
        <h2 id="draft-route">Destination and route</h2>
        <Field field="destinationLabel" hint="Mill or yard and town — public." issues={issues} label="Destination" optional>
          <input aria-describedby={describedBy("destinationLabel")} aria-invalid={invalid("destinationLabel")} defaultValue={v("destinationLabel")} maxLength={160} name="destinationLabel" />
        </Field>
        <Field field="estOneWayMiles" issues={issues} label="Estimated one-way miles" optional>
          <input aria-describedby={describedBy("estOneWayMiles")} aria-invalid={invalid("estOneWayMiles")} defaultValue={v("estOneWayMiles")} inputMode="numeric" max={MARKETPLACE_DRAFT_LIMITS.estOneWayMiles} min={1} name="estOneWayMiles" type="number" />
        </Field>
        <Field field="publicRoadNotes" hint="Public conditions only. Never gate codes, combinations or exact coordinates — share access details privately with haulers you approve." issues={issues} label="Public road conditions" optional>
          <textarea aria-describedby={describedBy("publicRoadNotes")} aria-invalid={invalid("publicRoadNotes")} defaultValue={v("publicRoadNotes")} maxLength={1000} name="publicRoadNotes" rows={3} />
        </Field>
      </section>

      <details className="v2-more" open={["estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad", "description"].some((name) => invalid(name) || v(name as DraftTextField))}>
        <summary>Volume estimates and description (optional)</summary>
        <div className="v2-form__pair">
          <Field field="estLoadsPerTruckPerDay" issues={issues} label="Loads per truck per day" optional>
            <input aria-invalid={invalid("estLoadsPerTruckPerDay")} defaultValue={v("estLoadsPerTruckPerDay")} inputMode="decimal" name="estLoadsPerTruckPerDay" />
          </Field>
          <Field field="estDailyLoads" issues={issues} label="Loads per day (whole job)" optional>
            <input aria-invalid={invalid("estDailyLoads")} defaultValue={v("estDailyLoads")} inputMode="numeric" name="estDailyLoads" type="number" />
          </Field>
        </div>
        <Field field="estTonsPerLoad" issues={issues} label="Tons per load" optional>
          <input aria-invalid={invalid("estTonsPerLoad")} defaultValue={v("estTonsPerLoad")} inputMode="decimal" name="estTonsPerLoad" />
        </Field>
        <Field field="description" issues={issues} label="Description" optional>
          <textarea aria-invalid={invalid("description")} defaultValue={v("description")} maxLength={6000} name="description" rows={4} />
        </Field>
        <p className="v2-muted">Estimates are shown to haulers as your estimates. Leave blank if unknown — LogLoads never fills them in.</p>
      </details>

      <p className="v2-muted">
        Haulers contact you through LogLoads messages, so the posting has no contact field. Leave phone numbers and email
        addresses out of it; you can share them in a conversation with a business you choose.
      </p>

      <button type="submit">Preview job</button>
    </form>
  )
}
