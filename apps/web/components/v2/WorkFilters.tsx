import { MARKETPLACE_PAY_UNIT_LABELS, marketplaceEquipmentLabel, marketplacePayUnitSchema, type MarketplacePayUnit } from "@logloads/contracts"
import { Button, FormField } from "@logloads/ui/primitives"

import { WorkFilterCheckbox } from "./WorkFilterCheckbox"
import styles from "./WorkFilters.module.css"

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * The find-work filters as a GET form (works without JavaScript), built from design-system fields. These are the
 * filters the marketplace port supports today: text, equipment, pay basis and inactive listings. Equipment options
 * show contract labels, never raw codes.
 */
export function WorkFilters({
  equipment,
  equipmentOptions,
  includeInactive,
  payUnit,
  query,
  showMap
}: {
  equipment: string
  equipmentOptions: readonly string[]
  includeInactive: boolean
  payUnit: MarketplacePayUnit | null
  query: string
  showMap: boolean
}) {
  return (
    <form action="/v2/work" aria-label="Filter jobs" className={styles.form} method="get" role="search">
      <FormField id="work-q" label="Search">
        <input defaultValue={query} name="q" placeholder="Product, place, company" type="search" />
      </FormField>
      <FormField id="work-equipment" label="Equipment">
        <select defaultValue={equipment} name="equipment">
          <option value="">Any equipment</option>
          {equipmentOptions.map((option) => (
            <option key={option} value={option}>{marketplaceEquipmentLabel(option)}</option>
          ))}
        </select>
      </FormField>
      <FormField id="work-pay" label="Pay basis">
        <select defaultValue={payUnit ?? ""} name="pay">
          <option value="">Any pay basis</option>
          {marketplacePayUnitSchema.options.map((unit) => (
            <option key={unit} value={unit}>{sentence(MARKETPLACE_PAY_UNIT_LABELS[unit])}</option>
          ))}
        </select>
      </FormField>
      <Button className={styles.submit} label="Apply" type="submit" />
      <div className={styles.inactive}>
        <WorkFilterCheckbox defaultChecked={includeInactive} />
      </div>
      {showMap ? <input name="view" type="hidden" value="map" /> : null}
    </form>
  )
}
