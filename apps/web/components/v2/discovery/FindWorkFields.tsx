import {
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_PAY_UNIT_LABELS,
  MARKETPLACE_PRODUCTS,
  marketplacePayUnitSchema
} from "@logloads/contracts"
import { FormField } from "@logloads/ui/primitives"

import {
  FIND_WORK_RADII,
  FIND_WORK_RADIUS_LABELS,
  FIND_WORK_START_LABELS,
  FIND_WORK_STARTS,
  type FindWorkFormValues
} from "@/lib/marketplace-v2/find-work"

import { WorkFilterCheckbox } from "../WorkFilterCheckbox"
import styles from "./FindWork.module.css"

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

const EQUIPMENT_GROUPS = [
  { category: "truck", label: "Trucks" },
  { category: "trailer", label: "Trailers" },
  { category: "attachment", label: "Attachments" }
] as const

export const FIND_WORK_LOCATION_ID = "work-near"
const PLACES_LIST_ID = "work-places"

/**
 * Find work's filter fields (UX-06 criterion 1): Location (town or ZIP), Radius, Equipment (the taxonomy, grouped,
 * with "My trucks" for a signed-in hauler with equipment), Product, Pay basis, Starting, Keywords and Include
 * closed. They are the named controls of a GET form, so the same fields work in the sheet and without JavaScript.
 * Every option is a contract label, never a raw code. Rendered by the sheet's client component.
 */
export function FindWorkFields({ places, values }: { places: readonly string[]; values: FindWorkFormValues }) {
  return (
    <>
      <div className={styles.pair}>
        <FormField
          error={values.nearError ?? undefined}
          hint="A town or ZIP code, not your exact location. Distances are approximate."
          id={FIND_WORK_LOCATION_ID}
          label="Location"
        >
          <input
            autoComplete="off"
            defaultValue={values.near}
            list={PLACES_LIST_ID}
            maxLength={80}
            name="near"
            placeholder="Town or ZIP"
            type="text"
          />
        </FormField>
        <FormField hint="Used with a location." id="work-radius" label="Radius">
          <select defaultValue={values.radius} name="radius">
            {FIND_WORK_RADII.map((radius) => (
              <option key={radius} value={radius}>{FIND_WORK_RADIUS_LABELS[radius]}</option>
            ))}
          </select>
        </FormField>
      </div>
      <datalist id={PLACES_LIST_ID}>
        {places.map((place) => <option key={place} value={place} />)}
      </datalist>

      <FormField
        hint={values.setupCount > 0 ? "My trucks hides jobs that ask for equipment your business hasn't listed." : undefined}
        id="work-equipment"
        label="Equipment"
      >
        <select defaultValue={values.equipment} name="equipment">
          <option value="any">Any equipment</option>
          {values.setupCount > 0 ? (
            <option value="mine">My trucks ({values.setupCount} {values.setupCount === 1 ? "setup" : "setups"})</option>
          ) : null}
          {EQUIPMENT_GROUPS.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === group.category).map((type) => (
                <option key={type.code} value={type.code}>{type.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </FormField>

      <div className={styles.pair}>
        <FormField id="work-product" label="Product">
          <select defaultValue={values.product} name="product">
            <option value="">Any product</option>
            {MARKETPLACE_PRODUCTS.map((product) => (
              <option key={product} value={product}>{product}</option>
            ))}
          </select>
        </FormField>
        <FormField id="work-pay" label="Pay basis">
          <select defaultValue={values.pay} name="pay">
            <option value="">Any pay basis</option>
            {marketplacePayUnitSchema.options.map((unit) => (
              <option key={unit} value={unit}>{sentence(MARKETPLACE_PAY_UNIT_LABELS[unit])}</option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField
        hint="Includes work already under way. Jobs that don't state a start date are left out."
        id="work-start"
        label="Starting"
      >
        <select defaultValue={values.start} name="start">
          <option value="">Any start date</option>
          {FIND_WORK_STARTS.map((start) => (
            <option key={start} value={start}>{FIND_WORK_START_LABELS[start]}</option>
          ))}
        </select>
      </FormField>

      <FormField id="work-q" label="Keywords" optional>
        <input defaultValue={values.q} maxLength={120} name="q" placeholder="Company, place or job title" type="search" />
      </FormField>

      <WorkFilterCheckbox defaultChecked={values.includeClosed} />

      {values.hidden.map((field) => <input key={field.name} name={field.name} type="hidden" value={field.value} />)}
    </>
  )
}
