import type { MarketplacePrivacyRequestReceipt } from "@logloads/contracts"

/**
 * The privacy request form's state (#343), shared by `submitPrivacyRequestAction` and the form drawn in #336. A plain
 * module: a "use server" file may export only async functions. `kind` and `details` keep what the person chose and
 * typed whenever nothing was stored.
 */
export type PrivacyRequestFormState =
  | { status: "idle" }
  /** Stored, or this person's open request of the same kind (`alreadyOpen`), with its due date. */
  | { status: "sent"; receipt: MarketplacePrivacyRequestReceipt; alreadyOpen: boolean }
  /** No store keeps requests here yet. Nothing was sent; the message gives the email address instead. */
  | { status: "unavailable"; message: string; kind: string; details: string }
  | { status: "error"; message: string; kind: string; details: string }

export const PRIVACY_REQUEST_IDLE: PrivacyRequestFormState = { status: "idle" }
