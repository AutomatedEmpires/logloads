import { randomUUID } from "node:crypto"

import {
  PLATFORM_FEE_BPS,
  auditEventSchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationRoleCan,
  type OrganizationBillingAccount
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createNotification } from "./notifications"

/**
 * Self-serve enrollment into the percentage agreement — the commercial model
 * the founder reverted to on 2026-08-01: LogLoads charges the host 5% of the
 * driver pay the host states, only on truckloads that complete, billed monthly
 * in arrears to the card on file. Posting is free; drivers are free; driver
 * pay is never reduced.
 *
 * The stored literals stay `legacy_percentage` / `legacy` because renaming an
 * enum that lives inside production snapshots is a migration, and the schema's
 * own refinements already hold this exact shape together. Display copy owns
 * the human name; storage keeps its history.
 */

const acceptInputSchema = z.object({
  actorUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

function nowIso(): string {
  return new Date().toISOString()
}

export function acceptPercentageBillingAgreement(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationBillingAccount {
  const input = acceptInputSchema.parse(rawInput)

  const actor = state.profiles.find((candidate) => candidate.id === input.actorUserId && candidate.isActive)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === input.organizationId &&
    candidate.status === "active" &&
    candidate.userId === input.actorUserId
  )

  if (!actor || !membership) {
    throw new Error("You are not an active member of this organization")
  }

  if (!organizationRoleCan(membership.role, "manage_billing")) {
    throw new Error("Only an organization owner or billing manager can accept the fee agreement")
  }

  const organization = state.organizations.find((candidate) => candidate.id === input.organizationId)

  if (!organization || organization.archivedAt) {
    throw new Error("Organization not found")
  }

  const now = nowIso()
  const existing = state.organizationBillingAccounts.find(
    (account) =>
      account.organizationId === input.organizationId &&
      Date.parse(account.effectiveAt) <= Date.parse(now)
  )

  if (existing && existing.activationState !== "unenrolled") {
    throw new Error("This organization already has a commercial agreement on file")
  }

  const account = organizationBillingAccountSchema.parse({
    activationState: "legacy",
    billingModel: "legacy_percentage",
    createdAt: existing?.createdAt ?? now,
    effectiveAt: now,
    id: existing?.id ?? organizationBillingAccountId(input.organizationId),
    organizationId: input.organizationId,
    subscriptionId: null,
    updatedAt: now
  })

  if (existing) {
    state.organizationBillingAccounts = state.organizationBillingAccounts.map((candidate) =>
      candidate.id === account.id ? account : candidate
    )
  } else {
    state.organizationBillingAccounts.push(account)
  }

  state.auditEvents.push(auditEventSchema.parse({
    action: "percentage_agreement_accepted",
    actorUserId: input.actorUserId,
    createdAt: now,
    entityId: account.id,
    entityType: "organization_billing_account",
    id: randomUUID(),
    // The rate is snapshotted so the audit record states what was agreed even
    // if the platform constant later changes with notice.
    metadata: { feeBps: PLATFORM_FEE_BPS, organizationId: input.organizationId }
  }))

  createNotification(state, {
    body: `${organization.displayName} is on the LogLoads fee agreement: ${PLATFORM_FEE_BPS / 100}% of stated driver pay, only on completed truckloads, billed monthly to the card on file. Attach a card in Billing to publish work.`,
    relatedEntityId: account.id,
    relatedEntityType: "organization_billing_account",
    title: "Fee agreement accepted",
    type: "system_alert",
    userId: input.actorUserId
  })

  return account
}