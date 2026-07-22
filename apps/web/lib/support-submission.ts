import type { SubmitSupportRequestInput } from "@logloads/contracts"

export type SupportSubmissionDraft = Omit<SubmitSupportRequestInput, "submissionId">

export interface SupportSubmissionAttempt {
  payloadKey: string
  submissionId: string
}

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
  createSubmissionId: () => string = () => crypto.randomUUID()
): SupportSubmissionAttempt {
  const payloadKey = supportSubmissionPayloadKey(draft)

  if (current?.payloadKey === payloadKey) {
    return current
  }

  return { payloadKey, submissionId: createSubmissionId() }
}
