/**
 * The "Report this listing" form's state (UX-07, #130), shared by `reportListingAction` and `ReportListing`. A plain
 * module: a "use server" file may export only async functions.
 */
export type ReportListingState =
  | { status: "idle" }
  /** The store recorded the report, or already held this person's standing report of the listing. */
  | { status: "sent"; reportedAt: string; alreadyReported: boolean }
  /** The store keeps no reports (the pilot adapter). Nothing was sent; the person's words stay in the form. */
  | { status: "unavailable"; reason: string; details: string }
  | { status: "error"; message: string; reason: string; details: string }

export const REPORT_LISTING_IDLE: ReportListingState = { status: "idle" }
