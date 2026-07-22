import type { SubmitSupportRequestInput } from "@logloads/contracts"

export type SupportSubmissionDraft = Omit<SubmitSupportRequestInput, "submissionId">

export interface SupportSubmissionAttempt {
  organizationScope: string
  payloadKey: string
  submissionId: string
}

const PLATFORM_ADMIN_SCOPE = "platform-admin"

function normalizeAttemptText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US")
}

export function supportSubmissionPayloadKey(draft: SupportSubmissionDraft): string {
  return JSON.stringify({
    details: normalizeAttemptText(draft.details),
    impact: draft.impact,
    kind: draft.kind,
    pagePath: draft.pagePath ?? null,
    title: normalizeAttemptText(draft.title)
  })
}

export function bindSupportSubmissionAttempt(
  current: SupportSubmissionAttempt | null,
  draft: SupportSubmissionDraft,
  activeOrganizationId: string | null,
  createSubmissionId: () => string = () => crypto.randomUUID()
): SupportSubmissionAttempt {
  const payloadKey = supportSubmissionPayloadKey(draft)
  const organizationScope = activeOrganizationId ?? PLATFORM_ADMIN_SCOPE

  if (current?.organizationScope === organizationScope && current.payloadKey === payloadKey) {
    return current
  }

  return { organizationScope, payloadKey, submissionId: createSubmissionId() }
}
