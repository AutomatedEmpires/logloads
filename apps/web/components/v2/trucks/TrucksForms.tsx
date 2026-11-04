import {
  HAULER_AVAILABILITY_LEAD_DAYS,
  HAULER_OTHER_TRAILER_MAX_LENGTH,
  HAULER_UNITS_MAX,
  MARKETPLACE_EQUIPMENT_GROUPS,
  NO_TRAILER,
  OTHER_TRAILER,
  type HaulerEquipmentUnitView
} from "@logloads/contracts"
import type { CapacityRow } from "@logloads/services"
import { EquipmentCapacity, formatDay } from "@logloads/ui/marketplace"
import { FormField } from "@logloads/ui/primitives"

import { FormCheckbox } from "@/components/v2/FormCheckbox"
import { InterestCountField } from "@/components/v2/InterestCountField"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { ChoiceCardGroup } from "@/components/v2/onboarding/ChoiceCardGroup"
import {
  addHaulerEquipmentAction,
  confirmHaulerAvailabilityAction,
  reportHaulerAvailabilityAction,
  setHaulerEquipmentCountAction
} from "@/lib/marketplace-v2/fleet-actions"
import type { AddEquipmentValues, AvailabilityValues } from "@/lib/marketplace-v2/fleet-page"

import styles from "./Trucks.module.css"

function SetupField({ setup }: { setup: boolean }) {
  return setup ? <input name="setup" type="hidden" value="1" /> : null
}

/**
 * "Add equipment" (UX 02 §A4): presets only from MARKETPLACE_EQUIPMENT_TYPES, grouped truck, trailer and extras,
 * with "Other (describe)" for a trailer that is not on the list. A plain POST, so it works without JavaScript.
 */
export function AddEquipmentForm({ disabled, error, setup, values }: { disabled: boolean; error: string | null; setup: boolean; values: AddEquipmentValues | null }) {
  return (
    <form action={addHaulerEquipmentAction} className={styles.form} id="add-equipment">
      <SetupField setup={setup} />
      <fieldset className={styles.fields} disabled={disabled}>
        <legend className={styles.legend}>Add equipment</legend>
        <div className={styles.pair}>
          <FormField error={error ?? undefined} hint="The truck, from the LogLoads list." id="add-truck" label="Truck">
            <select defaultValue={values?.truckCode || (MARKETPLACE_EQUIPMENT_GROUPS.truck[0]?.code ?? "")} name="truckCode" required>
              {MARKETPLACE_EQUIPMENT_GROUPS.truck.map((type) => (
                <option key={type.code} value={type.code}>{type.label}</option>
              ))}
            </select>
          </FormField>
          <FormField hint="What it pulls, if anything." id="add-trailer" label="Trailer" optional>
            <select defaultValue={values?.trailer ?? NO_TRAILER} name="trailer">
              <option value={NO_TRAILER}>No trailer</option>
              {MARKETPLACE_EQUIPMENT_GROUPS.trailer.map((type) => (
                <option key={type.code} value={type.code}>{type.label}</option>
              ))}
              <option value={OTHER_TRAILER}>Other (describe)</option>
            </select>
          </FormField>
        </div>
        <FormField hint="Only for Other (describe): the trailer in a few words. LogLoads staff may review it." id="add-other-trailer" label="Describe the trailer" optional>
          <input defaultValue={values?.otherTrailer ?? ""} maxLength={HAULER_OTHER_TRAILER_MAX_LENGTH} name="otherTrailer" type="text" />
        </FormField>
        <fieldset className={styles.group}>
          <legend className={styles.groupLegend}>Extras on these trucks (optional)</legend>
          {MARKETPLACE_EQUIPMENT_GROUPS.attachment.map((type) => (
            <FormCheckbox
              defaultChecked={values?.attachments.includes(type.code) ?? false}
              id={`add-attachment-${type.code}`}
              key={type.code}
              label={type.label}
              name="attachments"
              value={type.code}
            />
          ))}
        </fieldset>
        <InterestCountField defaultValue={Number(values?.count) || 1} hint={`From 1 to ${HAULER_UNITS_MAX}.`} id="add-count" label="How many like this" max={HAULER_UNITS_MAX} min={1} name="count" required />
      </fieldset>
      {disabled ? null : <PendingSubmitButton label="Add to my trucks" variant="secondary" />}
    </form>
  )
}

/** One listed configuration or extra, with its count. 0 takes it off the list. */
export function EquipmentRow({ disabled, posted, setup, unit }: { disabled: boolean; posted: string | null; setup: boolean; unit: HaulerEquipmentUnitView }) {
  return (
    <li className={styles.unit}>
      <form action={setHaulerEquipmentCountAction} className={styles.unitForm}>
        <SetupField setup={setup} />
        <input name="unitId" type="hidden" value={unit.id} />
        <div className={styles.unitText}>
          <span className={styles.unitName}>{unit.label}</span>
          <span className={styles.unitMeta}>{unit.category === "attachment" ? "Extra" : `${unit.units} listed`} · self-reported</span>
        </div>
        {disabled ? (
          <span className={styles.unitCount}>{unit.units}</span>
        ) : (
          <>
            <InterestCountField defaultValue={posted !== null ? Number(posted) || 0 : unit.units} id={`count-${unit.id}`} label={`How many: ${unit.label}`} labelHidden max={HAULER_UNITS_MAX} min={0} name="count" required />
            <PendingSubmitButton label="Update" size="sm" variant="ghost" />
          </>
        )}
      </form>
    </li>
  )
}

const STATE_OPTIONS = [
  { description: "Ready for work now.", title: "Available now", value: "now" },
  { description: "Free from the date below.", title: "Available from a date", value: "from" },
  { description: "Landings see none available.", title: "Not available", value: "none" }
] as const

/**
 * Availability for one truck type (UX 02 §A5): the three states, the date, and a count that can never exceed the
 * units listed. The count's hint states the limit, and the server refuses more.
 */
export function AvailabilityForm({ disabled, error, now, row, setup, values }: { disabled: boolean; error: string | null; now: string; row: CapacityRow; setup: boolean; values: AvailabilityValues | null }) {
  const today = now.slice(0, 10)
  const latest = new Date(Date.parse(`${today}T00:00:00.000Z`) + HAULER_AVAILABILITY_LEAD_DAYS * 86_400_000).toISOString().slice(0, 10)
  const state = values?.state ?? (row.state === "available_from" ? "from" : row.state === "not_available" ? "none" : "now")
  const id = `availability-${row.equipmentCode}`

  return (
    <form action={reportHaulerAvailabilityAction} className={styles.form} id={id}>
      <SetupField setup={setup} />
      <input name="equipmentCode" type="hidden" value={row.equipmentCode} />
      <fieldset className={styles.fields} disabled={disabled}>
        <legend className={styles.legend}>
          {row.label}: {row.have} listed
        </legend>
        <p className={styles.stamp} data-fresh={row.stamp.fresh ? "" : undefined}>{availabilityLine(row)}</p>
        <ChoiceCardGroup defaultValue={state} legend={`Are your ${row.label.toLowerCase()}s available?`} name="state" options={STATE_OPTIONS} />
        <div className={styles.pair}>
          <FormField error={error ?? undefined} hint="Only for Available from a date." id={`${id}-from`} label="Available from" optional>
            <input className={styles.date} defaultValue={values?.fromDate ?? row.from ?? ""} max={latest} min={today} name="fromDate" type="date" />
          </FormField>
          <InterestCountField
            defaultValue={Math.min(row.have, Number(values?.count) || row.available || row.have)}
            hint={`You have ${row.have} listed, so at most ${row.have} can be available. Not needed for Not available.`}
            id={`${id}-count`}
            label="Trucks available"
            max={row.have}
            min={1}
            name="count"
          />
        </div>
      </fieldset>
      {disabled ? null : <PendingSubmitButton label="Save availability" size="sm" variant="secondary" />}
    </form>
  )
}

/** "4 of 6 available · Updated today by the hauler"; unknown is "Not recently confirmed", never a number. */
export function availabilityLine(row: CapacityRow): string {
  switch (row.state) {
    case "available_now":
      return `${row.available} of ${row.have} available now · ${row.stamp.label}`
    case "available_from":
      return `${row.available} of ${row.have} available from ${formatDay(row.from as string)} · ${row.stamp.label}`
    case "not_available":
      return `Not available · ${row.stamp.label}`
    default:
      return row.stamp.label
  }
}

/**
 * The capacity board (UX 02 A-fleet) for two or more trucks: configuration, have, available, from and when it was
 * last said, and one "Confirm all as shown". A table at bp-lg and up, stacked rows below.
 */
export function CapacityBoard({ canConfirm, rows, setup }: { canConfirm: boolean; rows: CapacityRow[]; setup: boolean }) {
  const confirmable = rows.filter((row) => row.state !== "unknown").length

  return (
    <div className={styles.board}>
      <table className={styles.table}>
        <caption className={styles.caption}>Capacity by truck type, as your business reported it</caption>
        <thead>
          <tr>
            <th scope="col">Configuration</th>
            <th scope="col">Have</th>
            <th scope="col">Available</th>
            <th scope="col">From</th>
            <th scope="col">Last confirmed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.equipmentCode}>
              <th data-label="Configuration" scope="row">
                <span className={styles.boardName}>{row.label}</span>
                <span className={styles.boardDetail}>{row.configurations.map((unit) => `${unit.units} × ${unit.label}`).join(", ")}</span>
              </th>
              <td data-label="Have">{row.have}</td>
              <td data-label="Available">
                {/* Unknown or stale is "not recently confirmed", never 0; an explicit "not available" is 0 of N. */}
                <EquipmentCapacity available={row.state === "not_available" ? 0 : row.available} state={row.state === "unknown" ? "unknown" : "known"} units={row.have} />
              </td>
              <td data-label="From">{row.state === "available_from" && row.from ? formatDay(row.from) : row.state === "available_now" ? "Now" : row.state === "not_available" ? "Not available" : "—"}</td>
              <td data-label="Last confirmed">{row.stamp.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canConfirm ? (
        <form action={confirmHaulerAvailabilityAction} className={styles.confirm}>
          <SetupField setup={setup} />
          <PendingSubmitButton label="Confirm all as shown" />
          <p className={styles.hint}>
            {confirmable === rows.length
              ? "Re-states every row as it is today."
              : `Re-states the ${confirmable} row${confirmable === 1 ? "" : "s"} with a recent answer. Set the others above first.`}
          </p>
        </form>
      ) : null}
    </div>
  )
}
