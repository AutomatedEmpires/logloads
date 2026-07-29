import type { PayBasis } from "./economics"

/**
 * How a load's pay is worded, decided in ONE place.
 *
 * Nine surfaces previously each wrote `grossLabel ? "<gross> est. gross" : payLabel`
 * and demoted the host's commitment to a line reading "Base $525.00". The result
 * was that the public homepage, every load card and every load detail page
 * headlined $1,970 for a haul the host had committed $525 to — and twelve
 * surfaces showed the derived figure while eight showed the real one, so they
 * collided on a single screen.
 *
 * The rule this module enforces: a host-stated figure is presented as what the
 * load pays, with nothing added to it; a rate-card derivation may only ever be
 * presented as an estimate, and must say so. Keeping the rule here rather than
 * at nine call sites is deliberate — a presentation rule copied nine times is a
 * presentation rule that drifts, and this one drifted into a 3.75x
 * misstatement of driver compensation on a live public page.
 */
export interface PayPresentation {
  /** The figure a driver may read as what this haul pays them. */
  headline: string
  /**
   * Set only when `headline` is derived rather than committed. Surfaces MUST
   * render it whenever it is non-null, so an estimate can never read as a promise.
   */
  estimateNote: string | null
  /** What is left after estimated diesel. Always an estimate; always labelled. */
  afterFuel: string | null
}

export interface PayPresentationInput {
  payLabel: string
  economics: {
    afterFuelLabel: string | null
    grossLabel: string | null
    payBasis: PayBasis
  }
}

export function presentPay(load: PayPresentationInput): PayPresentation {
  if (load.economics.payBasis === "host_stated") {
    // The host committed to this number. Nothing is added to it and nothing
    // qualifies it — "exactly that number" is the decided rule.
    return {
      afterFuel: load.economics.afterFuelLabel,
      estimateNote: null,
      headline: load.payLabel
    }
  }

  // A posting from before hosts could state pay. The rate card is all we have,
  // so the figure is shown as an estimate and named as one.
  return {
    afterFuel: load.economics.afterFuelLabel,
    estimateNote: "Rate-card estimate — this host has not stated a flat driver pay",
    headline: load.economics.grossLabel ? `${load.economics.grossLabel} est.` : load.payLabel
  }
}

/** The one-line form used where a card has room for a single string. */
export function payHeadline(load: PayPresentationInput): string {
  return presentPay(load).headline
}
