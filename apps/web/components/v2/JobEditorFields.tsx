import {
  MARKETPLACE_DRAFT_LIMITS,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_OTHER_PRODUCT,
  MARKETPLACE_PAY_UNIT_LABELS,
  MARKETPLACE_PRODUCTS,
  marketplacePayUnitSchema,
  type MarketplaceDraftIssue,
  type MarketplaceDraftLandingContext
} from "@logloads/contracts"
import { FormField } from "@logloads/ui/primitives"

import type { DraftFormValues, DraftTextField } from "@/lib/marketplace-v2/draft-params"

import { FormCheckbox } from "./FormCheckbox"
import styles from "./JobEditor.module.css"

/**
 * The fields of the job editor's three input steps (UX 02 §B4–B6), as design-system FormFields inside a GET form,
 * so each works without JavaScript. Field ids are the draft field names, and errors render as `<id>-error`.
 * Pay is always required (V2-DEC-02); product and timing are required to publish (UX-DEC-03, UX-DEC-02). There is
 * no contact field (UX-DEC-04) and no publish statement: those are ticked on the review step, so editing a
 * draft never confirms anything.
 */

export interface StepFieldsProps {
  values: DraftFormValues
  issues: readonly MarketplaceDraftIssue[]
  /** The field that receives focus: the first invalid one, or none. */
  focus: string | null
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

function errorFor(issues: readonly MarketplaceDraftIssue[], field: string): string | undefined {
  const messages = issues.filter((issue) => issue.field === field).map((issue) => issue.message)
  return messages.length > 0 ? messages.join(" ") : undefined
}

function valueOf(values: DraftFormValues, name: DraftTextField): string {
  return values.text[name] ?? ""
}

/** An error for a group of controls (a fieldset), referenced by the group's aria-describedby. */
function GroupError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p className={styles.error} id={id} role="alert">{message}</p> : null
}

/** Step 1: Basics & location. */
export function BasicsFields({ values, issues, focus, landings }: StepFieldsProps & { landings: readonly MarketplaceDraftLandingContext[] }) {
  const v = (name: DraftTextField) => valueOf(values, name)

  return (
    <>
      <FormField error={errorFor(issues, "landingId")} hint="Only your business's active landings can post jobs." id="landingId" label="Landing">
        <select autoFocus={focus === "landingId"} defaultValue={v("landingId")} name="landingId" required>
          <option value="">Choose a landing</option>
          {landings.map((landing) => (
            <option key={landing.id} value={landing.id}>{landing.name} · near {landing.areaLabel}</option>
          ))}
        </select>
      </FormField>
      <FormField error={errorFor(issues, "title")} hint="Haulers see this first, for example “Oak saw logs to Springfield”." id="title" label="Title">
        <input autoFocus={focus === "title"} defaultValue={v("title")} maxLength={140} name="title" required />
      </FormField>
      <FormField error={errorFor(issues, "product")} hint="Required to publish." id="product" label="Product">
        <select autoFocus={focus === "product"} defaultValue={v("product")} name="product" required>
          <option value="">Choose a product</option>
          {MARKETPLACE_PRODUCTS.map((product) => (
            <option key={product} value={product}>{product === MARKETPLACE_OTHER_PRODUCT ? "Other (describe)" : product}</option>
          ))}
        </select>
      </FormField>
      <FormField
        error={errorFor(issues, "productOther")}
        hint="Only for Other: what is being hauled, up to 120 characters."
        id="productOther"
        label="Describe the product"
      >
        <input autoFocus={focus === "productOther"} defaultValue={v("productOther")} maxLength={120} name="productOther" />
      </FormField>
      <div className={styles.pair}>
        <FormField error={errorFor(issues, "destinationLabel")} hint="Mill or yard and town. Public." id="destinationLabel" label="Destination" optional>
          <input autoFocus={focus === "destinationLabel"} defaultValue={v("destinationLabel")} maxLength={160} name="destinationLabel" />
        </FormField>
        <FormField error={errorFor(issues, "estOneWayMiles")} hint="Your estimate, shown as one." id="estOneWayMiles" label="One-way miles" optional>
          <input
            autoFocus={focus === "estOneWayMiles"}
            defaultValue={v("estOneWayMiles")}
            inputMode="numeric"
            max={MARKETPLACE_DRAFT_LIMITS.estOneWayMiles}
            min={1}
            name="estOneWayMiles"
            type="number"
          />
        </FormField>
      </div>
    </>
  )
}

/** Step 2: Pay & scope (pay, timing and truck demand). */
export function PayFields({ values, issues, focus }: StepFieldsProps) {
  const v = (name: DraftTextField) => valueOf(values, name)
  const workPeriodError = errorFor(issues, "workPeriod")

  return (
    <>
      <p className={styles.hint}>Every published job states pay: an amount with what it is per, or Negotiable with a note on how pay is set.</p>
      <div className={styles.pair}>
        <FormField error={errorFor(issues, "payUnit")} id="payUnit" label="Pay basis">
          <select autoFocus={focus === "payUnit"} defaultValue={v("payUnit")} name="payUnit" required>
            <option value="">Choose a basis</option>
            {marketplacePayUnitSchema.options.map((unit) => (
              <option key={unit} value={unit}>{sentence(MARKETPLACE_PAY_UNIT_LABELS[unit])}</option>
            ))}
          </select>
        </FormField>
        <FormField error={errorFor(issues, "payAmount")} hint="Leave blank for negotiable pay." id="payAmount" label="Amount ($)">
          <input autoFocus={focus === "payAmount"} defaultValue={v("payAmount")} inputMode="decimal" name="payAmount" placeholder="525" />
        </FormField>
      </div>
      <FormField
        error={errorFor(issues, "payNote")}
        hint="Required for negotiable pay or another basis. No phone numbers, email addresses or access details."
        id="payNote"
        label="Pay note"
        optional
      >
        <input autoFocus={focus === "payNote"} defaultValue={v("payNote")} maxLength={300} name="payNote" />
      </FormField>

      <FormField error={errorFor(issues, "startsOn")} hint="Required to publish." id="startsOn" label="Work starts">
        <input autoFocus={focus === "startsOn"} defaultValue={v("startsOn")} name="startsOn" type="date" />
      </FormField>
      <fieldset aria-describedby={workPeriodError ? "workPeriod-error workPeriod-hint" : "workPeriod-hint"} className={styles.fieldset}>
        <legend className={styles.legend}>How long it runs</legend>
        <p className={styles.hint} id="workPeriod-hint">Required to publish: give one of an end date, a duration, or Ongoing.</p>
        <div className={styles.pair}>
          <FormField error={errorFor(issues, "endsOn")} id="endsOn" label="End date">
            <input
              aria-invalid={workPeriodError ? true : undefined}
              autoFocus={focus === "endsOn" || focus === "workPeriod"}
              defaultValue={v("endsOn")}
              name="endsOn"
              type="date"
            />
          </FormField>
          <FormField error={errorFor(issues, "durationDays")} id="durationDays" label="Duration (days)">
            <input
              aria-invalid={workPeriodError ? true : undefined}
              autoFocus={focus === "durationDays"}
              defaultValue={v("durationDays")}
              inputMode="numeric"
              max={MARKETPLACE_DRAFT_LIMITS.durationDays}
              min={1}
              name="durationDays"
              type="number"
            />
          </FormField>
        </div>
        <FormCheckbox
          aria-invalid={workPeriodError || errorFor(issues, "ongoing") ? true : undefined}
          autoFocus={focus === "ongoing"}
          defaultChecked={v("ongoing") === "1"}
          id="ongoing"
          label="Ongoing: no set end date"
          name="ongoing"
          value="1"
        />
        <GroupError id="ongoing-error" message={errorFor(issues, "ongoing")} />
        <GroupError id="workPeriod-error" message={workPeriodError} />
      </fieldset>

      <div className={styles.pair}>
        <FormField error={errorFor(issues, "trucksRequested")} id="trucksRequested" label="Trucks needed for the job">
          <input
            autoFocus={focus === "trucksRequested"}
            defaultValue={v("trucksRequested") || "1"}
            inputMode="numeric"
            max={MARKETPLACE_DRAFT_LIMITS.trucksRequested}
            min={1}
            name="trucksRequested"
            required
            type="number"
          />
        </FormField>
        <FormField error={errorFor(issues, "trucksPerDay")} id="trucksPerDay" label="Trucks per working day" optional>
          <input
            autoFocus={focus === "trucksPerDay"}
            defaultValue={v("trucksPerDay")}
            inputMode="numeric"
            max={MARKETPLACE_DRAFT_LIMITS.trucksRequested}
            min={1}
            name="trucksPerDay"
            type="number"
          />
        </FormField>
      </div>
    </>
  )
}

const EQUIPMENT_GROUPS = [
  { category: "truck", label: "Truck" },
  { category: "trailer", label: "Trailer" },
  { category: "attachment", label: "Attachments" }
] as const

/** Step 3: Equipment & volume. Equipment is grouped by truck, trailer and attachment (MARKETPLACE_EQUIPMENT_TYPES). */
export function EquipmentFields({ values, issues, focus }: StepFieldsProps) {
  const v = (name: DraftTextField) => valueOf(values, name)
  const equipmentError = errorFor(issues, "equipment")
  const firstCode = MARKETPLACE_EQUIPMENT_TYPES[0].code
  const estimatesOpen = (["estLoadsPerTruckPerDay", "estDailyLoads", "estTonsPerLoad"] as const).some((name) => v(name) || errorFor(issues, name))
  const detailsOpen = (["publicRoadNotes", "description"] as const).some((name) => v(name) || errorFor(issues, name))

  return (
    <>
      <fieldset aria-describedby={equipmentError ? "equipment-error" : undefined} className={styles.fieldset}>
        <legend className={styles.legend}>Equipment required</legend>
        <p className={styles.hint}>Choose every truck, trailer and attachment that fits the job. At least one is required.</p>
        <div className={styles.groups}>
          {EQUIPMENT_GROUPS.map((group) => (
            <fieldset className={styles.group} key={group.category}>
              <legend className={styles.groupLegend}>{group.label}</legend>
              <div className={styles.checks}>
                {MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === group.category).map((type) => (
                  <FormCheckbox
                    aria-invalid={equipmentError ? true : undefined}
                    autoFocus={focus === "equipment" && type.code === firstCode}
                    defaultChecked={values.equipment.includes(type.code)}
                    id={`equipment-${type.code}`}
                    key={type.code}
                    label={type.label}
                    name="equipment"
                    value={type.code}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <GroupError id="equipment-error" message={equipmentError} />
      </fieldset>

      <details className={styles.more} open={estimatesOpen}>
        <summary>Volume estimates (optional)</summary>
        <div className={styles.moreBody}>
          <p className={styles.hint}>Shown to haulers as your estimates. Leave blank if unknown: LogLoads never fills them in.</p>
          <div className={styles.pair}>
            <FormField error={errorFor(issues, "estLoadsPerTruckPerDay")} id="estLoadsPerTruckPerDay" label="Loads per truck per day" optional>
              <input autoFocus={focus === "estLoadsPerTruckPerDay"} defaultValue={v("estLoadsPerTruckPerDay")} inputMode="decimal" name="estLoadsPerTruckPerDay" />
            </FormField>
            <FormField error={errorFor(issues, "estDailyLoads")} id="estDailyLoads" label="Loads per day, whole job" optional>
              <input
                autoFocus={focus === "estDailyLoads"}
                defaultValue={v("estDailyLoads")}
                inputMode="numeric"
                max={MARKETPLACE_DRAFT_LIMITS.estDailyLoads}
                min={1}
                name="estDailyLoads"
                type="number"
              />
            </FormField>
          </div>
          <FormField error={errorFor(issues, "estTonsPerLoad")} id="estTonsPerLoad" label="Tons per load" optional>
            <input autoFocus={focus === "estTonsPerLoad"} defaultValue={v("estTonsPerLoad")} inputMode="decimal" name="estTonsPerLoad" />
          </FormField>
        </div>
      </details>

      <details className={styles.more} open={detailsOpen}>
        <summary>Road notes and description (optional)</summary>
        <div className={styles.moreBody}>
          <FormField
            error={errorFor(issues, "publicRoadNotes")}
            hint="Public conditions only. Never gate codes, combinations or exact coordinates: share access details privately with haulers you approve."
            id="publicRoadNotes"
            label="Public road notes"
            optional
          >
            <textarea autoFocus={focus === "publicRoadNotes"} defaultValue={v("publicRoadNotes")} maxLength={1000} name="publicRoadNotes" rows={3} />
          </FormField>
          <FormField error={errorFor(issues, "description")} hint="Anything else haulers should know. Public." id="description" label="Description" optional>
            <textarea autoFocus={focus === "description"} defaultValue={v("description")} maxLength={6000} name="description" rows={4} />
          </FormField>
        </div>
      </details>
    </>
  )
}
