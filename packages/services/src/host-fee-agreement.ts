import {
  auditEventSchema,
  HOST_FEE_TERMS_VERSION,
  hostFeeAgreementId,
  hostFeeAgreementSchema,
  isCurrentHostFeeAgreement,
  organizationRoleCan,
  organizationTypeCanPublishLoads,
  platformFeePercentLabel,
  PLATFORM_FEE_BPS,
  type HostFeeAgreement
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createNotification } from "./notifications"
import { organizationOperationallyAccessible } from "./organization-access"
import { assertCondition, assertDomainCondition, createUuid, nowIso } from "./utils"

const acceptInputSchema = z.object({
  actorUserId: z.string().uuid(),
  organizationId: z.string().uuid(),
  termsVersion: z.string().trim().min(1).max(120)
})

export interface AcceptHostFeeAgreementInput {
  actorUserId: string
  organizationId: string
  /** The terms version the host was shown. It must be the current one. */
  termsVersion: string
}

export interface AcceptHostFeeAgreementResult {
  agreement: HostFeeAgreement
  changed: boolean
}

/**
 * Records that a host organization accepted the LogLoads fee terms: 2% of the
 * driver pay it states on each load, billed to the host on top of that pay when
 * the load completes, invoiced monthly in arrears and charged to the host's card
 * on file. Driver pay stays a direct host-to-driver obligation.
 *
 * Any active member who can manage billing may accept for an organization that
 * can publish loads. Accepting the current terms again is a no-op: the stored
 * agreement is returned unchanged and nothing is audited or notified twice.
 */
export function acceptHostFeeAgreement(
  state: LogLoadsDatabaseState,
  rawInput: AcceptHostFeeAgreementInput,
  at = nowIso()
): AcceptHostFeeAgreementResult {
  const input = acceptInputSchema.parse(rawInput)

  assertDomainCondition(
    input.termsVersion === HOST_FEE_TERMS_VERSION,
    "Refresh the current LogLoads fee terms before accepting them"
  )

  const actors = state.profiles.filter(
    (candidate) => candidate.id === input.actorUserId && candidate.isActive
  )
  const memberships = state.organizationMemberships.filter(
    (candidate) =>
      candidate.organizationId === input.organizationId &&
      candidate.status === "active" &&
      candidate.userId === input.actorUserId
  )

  assertDomainCondition(
    actors.length === 1 && memberships.length === 1,
    "You are not an active member of this organization"
  )
  assertDomainCondition(
    organizationRoleCan(memberships[0]!.role, "manage_billing"),
    "Only an organization owner, administrator, or billing manager can accept the fee terms"
  )

  const organizations = state.organizations.filter(
    (candidate) => candidate.id === input.organizationId
  )

  assertDomainCondition(organizations.length === 1, "Organization not found")

  const organization = organizations[0]!

  assertDomainCondition(
    organizationOperationallyAccessible(organization),
    "This organization cannot accept the fee terms while its workspace is locked"
  )
  assertDomainCondition(
    organizationTypeCanPublishLoads(organization.type),
    "Only an organization that publishes loads accepts the LogLoads host fee"
  )

  const existing = state.hostFeeAgreements.filter(
    (candidate) => candidate.organizationId === input.organizationId
  )

  assertCondition(
    existing.length <= 1,
    `Organization ${input.organizationId} has conflicting fee agreements`
  )

  const current = existing[0]

  if (current && isCurrentHostFeeAgreement(current)) {
    return { agreement: current, changed: false }
  }

  const agreement = hostFeeAgreementSchema.parse({
    acceptedAt: at,
    acceptedByUserId: input.actorUserId,
    createdAt: current?.createdAt ?? at,
    feeBps: PLATFORM_FEE_BPS,
    id: hostFeeAgreementId(input.organizationId),
    organizationId: input.organizationId,
    termsVersion: input.termsVersion,
    updatedAt: at
  })

  state.hostFeeAgreements = current
    ? state.hostFeeAgreements.map((candidate) =>
        candidate.id === current.id ? agreement : candidate
      )
    : [...state.hostFeeAgreements, agreement]
  state.auditEvents.push(
    auditEventSchema.parse({
      action: "host_fee_agreement_accepted",
      actorUserId: input.actorUserId,
      createdAt: at,
      entityId: agreement.id,
      entityType: "host_fee_agreement",
      id: createUuid(),
      metadata: {
        feeBps: agreement.feeBps,
        organizationId: agreement.organizationId,
        termsVersion: agreement.termsVersion
      }
    })
  )

  createNotification(state, {
    body: `${organization.displayName} accepted the LogLoads fee terms: ${platformFeePercentLabel(agreement.feeBps)} of stated driver pay, billed to the host on top of that pay on completed truckloads and invoiced monthly. Driver pay remains a direct host-to-driver obligation.`,
    relatedEntityId: agreement.id,
    relatedEntityType: "host_fee_agreement",
    title: "Fee terms accepted",
    type: "system_alert",
    userId: input.actorUserId
  })

  return { agreement, changed: true }
}
