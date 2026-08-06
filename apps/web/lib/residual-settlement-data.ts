import "server-only"

import {
  type ResidualDriverReceipt,
  type ResidualHostPayment,
  type ResidualSettlementItem
} from "@logloads/services"

import { services } from "./services"

export type {
  ResidualDriverReceipt,
  ResidualHostPayment,
  ResidualSettlementItem
}

/** Thin server projection over the canonical service-layer authorization. */
export function residualSettlementItemsForOrganization(
  userId: string,
  organizationId: string
): ResidualSettlementItem[] {
  return services.residualSettlementItemsForOrganization(userId, organizationId)
}
