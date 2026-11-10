/**
 * The interest sheet's contradiction rule (UX 02 §A8; spec §6.4 "if capacity changed since inquiry: allow update and
 * flag contradiction"; UX-08 #131 criterion 2). Offering more trucks of a type than the business last reported
 * available is allowed: the sheet says so and offers a way to update the report, and Send stays available.
 *
 * Import-free on purpose, so the sheet's browser code and the server's confirmation use one rule without pulling the
 * contracts into the client bundle. Availability is per truck type (`availability_reports.equipment_code`, #126), so
 * offers are summed across the configurations of one truck type before they are compared.
 */

/** A fresh, known self-report for one truck type: how many the business said were available (0 for "not available"). */
export interface ReportedAvailability {
  truckCode: string
  /** "Log truck". */
  label: string
  reported: number
  /** Where the business updates this report (My trucks, at this type's availability form). */
  href: string
}

/** One configuration's offered count, with the truck type its availability is reported under. */
export interface OfferedCount {
  truckCode: string | null
  count: number
}

export interface CapacityContradiction extends ReportedAvailability {
  offered: number
}

export const UPDATE_AVAILABILITY = "Update availability?"

/** Every truck type whose offered total is above what the business last reported available. Unknown types never are. */
export function capacityContradictions(offered: readonly OfferedCount[], reports: readonly ReportedAvailability[]): CapacityContradiction[] {
  const totals = new Map<string, number>()

  for (const line of offered) {
    if (line.truckCode && Number.isFinite(line.count) && line.count > 0) totals.set(line.truckCode, (totals.get(line.truckCode) ?? 0) + line.count)
  }

  return reports.flatMap((report) => {
    const total = totals.get(report.truckCode) ?? 0
    return total > report.reported ? [{ ...report, offered: total }] : []
  })
}

/**
 * "Log truck: you reported 2 available, and this offers 3." While the sheet is open it is "this offers"; on the
 * confirmation it is "you offered". "None" for a type reported not available, never "0 of".
 */
export function contradictionText(contradiction: CapacityContradiction, when: "offering" | "sent"): string {
  const reported = contradiction.reported === 0 ? "none" : String(contradiction.reported)
  const offer = when === "offering" ? `this offers ${contradiction.offered}` : `you offered ${contradiction.offered}`

  return `${contradiction.label}: you reported ${reported} available, and ${offer}.`
}
