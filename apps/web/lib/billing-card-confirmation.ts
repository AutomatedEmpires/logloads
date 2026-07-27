type CardConfirmationStatus = "attached" | "failed" | "none" | "pending"

export interface CardConfirmationSnapshot {
  paymentMethodId?: string | null
  status?: CardConfirmationStatus
}

/**
 * Stripe may return the confirmed payment method as either its opaque id or an
 * expanded object. Normalizing both shapes keeps the browser from falling back
 * to "any attached card", which would let the old card satisfy a replacement
 * poll before the setup-intent webhook commits the new one.
 */
export function confirmedPaymentMethodId(paymentMethod: unknown): string | null {
  if (typeof paymentMethod === "string") {
    return paymentMethod.length > 0 ? paymentMethod : null
  }

  if (!paymentMethod || typeof paymentMethod !== "object" || !("id" in paymentMethod)) {
    return null
  }

  const id = paymentMethod.id
  return typeof id === "string" && id.length > 0 ? id : null
}

export function cardConfirmsPaymentMethod(
  card: CardConfirmationSnapshot | null | undefined,
  expectedPaymentMethodId: string
): boolean {
  return card?.status === "attached" && card.paymentMethodId === expectedPaymentMethodId
}
