"use client"

import { EquipmentCapacity } from "@logloads/ui/marketplace"
import { FormField } from "@logloads/ui/primitives"
import { useState } from "react"

import { AppLink } from "@/components/AppLink"
import { expressInterestAction } from "@/lib/marketplace-v2/actions"
import { capacityContradictions, contradictionText, UPDATE_AVAILABILITY } from "@/lib/marketplace-v2/interest-capacity"
import type { InterestSheetModel, InterestSheetRow } from "@/lib/marketplace-v2/interest-sheet"

import { InterestCountField } from "./InterestCountField"
import styles from "./InterestForm.module.css"
import { PendingSubmitButton } from "./PendingSubmitButton"

const CONTACT_HINTS = {
  default: "Landings reply in LogLoads messages unless you choose phone or email.",
  last_inquiry: "As on your last inquiry. Change it for this one if you like."
} as const

function EquipmentRow({ index, onCount, row }: { index: number; onCount: (key: string, value: number) => void; row: InterestSheetRow }) {
  return (
    <li className={styles.equipmentRow}>
      <input name="equipmentKey" type="hidden" value={row.configurationKey} />
      <div className={styles.equipmentText}>
        <span className={styles.equipmentName}>{row.label}</span>
        {row.capacity.state !== "unknown" && row.capacity.available === null ? (
          // The report is for the truck type across several setups: its count is in the line below, not claimed here.
          <span className={styles.stamp}>{row.unitsListed} {row.unitsListed === 1 ? "unit" : "units"} listed</span>
        ) : (
          <EquipmentCapacity
            available={row.capacity.available}
            state={row.capacity.state === "unknown" ? "unknown" : "known"}
            units={row.unitsListed}
          />
        )}
        {row.capacity.line ? <span className={styles.stamp}>{row.capacity.line}</span> : null}
      </div>
      <InterestCountField
        defaultValue={row.count}
        id={`interest-equipment-${index}`}
        label={`Trucks offered: ${row.label}`}
        labelHidden
        max={row.unitsListed}
        min={0}
        name="equipmentCount"
        onValueChange={(value) => onCount(row.configurationKey, value)}
      />
    </li>
  )
}

/**
 * The interest sheet (UX 02 §A8; UX-08 #131): one short form, filled in from the business's own records
 * (`interest-sheet.ts`), so the default path is one tap on Send.
 *
 * - Trucks by configuration: the ones the job asks for first, the rest behind "Show my other trucks" (a native
 *   disclosure). Each count is capped at the units listed; the server re-checks every count.
 * - Offering more of a truck type than its latest report says is available shows "Update availability?" and leaves
 *   Send as it is (spec §6.4). The note is live, so a screen reader hears it as the count changes.
 * - Send disables while it runs and reads "Sending…" (React's form status, PendingSubmitButton). The form has no
 *   submit handler of its own (#179), and a repeated send is the same inquiry: the store keeps one per job and
 *   business, and an identical one changes nothing.
 *
 * The server renders every field as a plain form control, so the sheet works the same without JavaScript.
 */
export function InterestSheet({ jobId, model }: { jobId: string; model: InterestSheetModel }) {
  const rows = [...model.requested, ...model.others]
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(rows.map((row) => [row.configurationKey, row.count])))
  const setCount = (key: string, value: number) => setCounts((current) => ({ ...current, [key]: value }))
  const contradictions = capacityContradictions(
    rows.map((row) => ({ count: counts[row.configurationKey] ?? row.count, truckCode: row.truckCode })),
    model.reports
  )

  return (
    <form action={expressInterestAction} className={styles.form}>
      <input name="loadPostingId" type="hidden" value={jobId} />
      <p className={styles.as}>
        As <strong className={styles.business}>{model.businessName}</strong>
      </p>

      {rows.length === 0 ? (
        <div className={styles.group}>
          <InterestCountField defaultValue={model.trucksOffered} id="interest-trucks" label="Trucks you can offer" max={500} min={1} name="trucksOffered" required />
          <p className={styles.hint}>
            Your business lists no trucks or trailers yet, so the landing sees a count only.{" "}
            <AppLink className={styles.link} href={model.trucksHref}>Add your equipment</AppLink> to offer trucks by type.
          </p>
        </div>
      ) : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Trucks you can offer</legend>
          {model.unmatchedEquipment ? (
            <p className={styles.hint}>
              This job asks for {model.unmatchedEquipment}. None of your listed trucks has all of it, so nothing is filled in.
            </p>
          ) : null}
          <ul className={styles.equipmentList}>
            {model.requested.map((row, index) => (
              <EquipmentRow index={index} key={row.configurationKey} onCount={setCount} row={row} />
            ))}
          </ul>
          {model.others.length > 0 ? (
            <details className={styles.others}>
              <summary className={styles.summary}>Show my other trucks ({model.others.length})</summary>
              <ul aria-label="Your other trucks" className={styles.equipmentList}>
                {model.others.map((row, index) => (
                  <EquipmentRow index={model.requested.length + index} key={row.configurationKey} onCount={setCount} row={row} />
                ))}
              </ul>
            </details>
          ) : null}
          <div aria-live="polite" className={styles.capacityNotes}>
            {contradictions.map((contradiction) => (
              <p className={styles.capacityNote} key={contradiction.truckCode}>
                {contradictionText(contradiction, "offering")}{" "}
                <AppLink className={styles.link} href={contradiction.href}>{UPDATE_AVAILABILITY}</AppLink>
              </p>
            ))}
          </div>
          <p className={styles.hint}>
            Self-reported, from <AppLink className={styles.link} href={model.trucksHref}>My trucks</AppLink>. Nothing is tracked. Offer at least one truck.
          </p>
        </fieldset>
      )}

      <FormField
        hint={model.availableFromSource === "availability" ? "From your availability in My trucks." : "When your trucks are free, if you know."}
        id="interest-from"
        label="Available from"
        optional
      >
        <input defaultValue={model.availableFrom} name="availableFrom" type="date" />
      </FormField>
      {/* TODO(#131 follow-up, normalized-v2 schema batch): default from the profile's contact route once it has one. */}
      <FormField hint={CONTACT_HINTS[model.contactSource === "last_inquiry" ? "last_inquiry" : "default"]} id="interest-contact" label="Reach me by">
        <select defaultValue={model.contactPreference} name="contactPreference">
          <option value="in_app">LogLoads messages</option>
          <option value="phone">Phone</option>
          <option value="email">Email</option>
        </select>
      </FormField>
      <FormField id="interest-message" label="Message" optional>
        <textarea maxLength={2000} name="message" rows={3} />
      </FormField>
      <details className={styles.more}>
        <summary className={styles.summary}>Add an end date</summary>
        <div className={styles.moreBody}>
          <FormField hint="The last day your trucks are free for this job." id="interest-until" label="Available until" optional>
            <input name="availableUntil" type="date" />
          </FormField>
        </div>
      </details>

      <PendingSubmitButton className={styles.submit} label="Send interest" pendingLabel="Sending…" />
      <p className={styles.hint}>Free and nonbinding. The landing reviews and replies.</p>
    </form>
  )
}
