import { z } from "zod"

export const supportRequestKindSchema = z.enum(["problem", "feature_request"])
export const supportRequestImpactSchema = z.enum(["blocked", "degraded", "minor", "idea"])
export const supportRequestStatusSchema = z.enum(["open", "in_review", "resolved", "closed"])
export const supportRequestResolutionCodeSchema = z.enum([
  "fixed",
  "answered",
  "planned",
  "not_planned",
  "duplicate",
  "unable_to_reproduce"
])

const timestampSchema = z.string().datetime()
const nullableTimestampSchema = timestampSchema.nullable()
const nullableUserIdSchema = z.string().uuid().nullable()
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const RESOLVED_CODES = new Set(["fixed", "answered"])
const CLOSED_CODES = new Set(["planned", "not_planned", "duplicate", "unable_to_reproduce"])

export const supportRequestPagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !CONTROL_CHARACTERS.test(value),
    "Page path must be a relative application pathname without a query or fragment"
  )

const submissionFields = {
  submissionId: z.string().uuid(),
  kind: supportRequestKindSchema,
  impact: supportRequestImpactSchema,
  title: z.string().trim().min(5).max(120),
  details: z.string().trim().min(10).max(4000),
  pagePath: supportRequestPagePathSchema.optional().nullable()
}

function validateKindAndImpact(
  value: { kind: z.infer<typeof supportRequestKindSchema>; impact: z.infer<typeof supportRequestImpactSchema> },
  context: z.RefinementCtx
): void {
  if (value.kind === "feature_request" && value.impact !== "idea") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Feature requests use idea impact",
      path: ["impact"]
    })
  }

  if (value.kind === "problem" && value.impact === "idea") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Problem reports must describe their operational impact",
      path: ["impact"]
    })
  }
}

function validateResolution(
  value: {
    status: z.infer<typeof supportRequestStatusSchema>
    resolutionCode?: z.infer<typeof supportRequestResolutionCodeSchema> | null
    resolutionNote?: string | null
  },
  context: z.RefinementCtx
): void {
  const code = value.resolutionCode ?? null
  const note = value.resolutionNote ?? null

  if (value.status === "open" || value.status === "in_review") {
    if (code !== null || note !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open requests cannot include resolution details",
        path: ["resolutionCode"]
      })
    }

    return
  }

  if (!code) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A resolution code is required for a terminal status",
      path: ["resolutionCode"]
    })
  }

  if (!note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A short resolution note is required for a terminal status",
      path: ["resolutionNote"]
    })
  }

  if (value.status === "resolved" && code && !RESOLVED_CODES.has(code)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Resolved requests must be fixed or answered",
      path: ["resolutionCode"]
    })
  }

  if (value.status === "closed" && code && !CLOSED_CODES.has(code)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Closed requests must be planned, declined, duplicated, or unable to reproduce",
      path: ["resolutionCode"]
    })
  }
}

export const submitSupportRequestInputSchema = z
  .object(submissionFields)
  .strict()
  .superRefine(validateKindAndImpact)

export const reviewSupportRequestInputSchema = z
  .object({
    status: z.enum(["in_review", "resolved", "closed"]),
    resolutionCode: supportRequestResolutionCodeSchema.optional().nullable(),
    resolutionNote: z.string().trim().min(1).max(1000).optional().nullable()
  })
  .strict()
  .superRefine(validateResolution)

export const supportRequestSchema = z
  .object({
    id: z.string().uuid(),
    submissionIds: z.array(z.string().uuid()).min(1),
    reporterUserId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
    kind: supportRequestKindSchema,
    impact: supportRequestImpactSchema,
    title: z.string().trim().min(5).max(120),
    details: z.string().trim().min(10).max(4000),
    pagePath: supportRequestPagePathSchema.nullable(),
    appCommitSha: z.string().regex(/^[a-f0-9]{7,64}$/i).nullable(),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: supportRequestStatusSchema,
    resolutionCode: supportRequestResolutionCodeSchema.nullable(),
    resolutionNote: z.string().trim().min(1).max(1000).nullable(),
    triagedAt: nullableTimestampSchema,
    triagedByUserId: nullableUserIdSchema,
    closedAt: nullableTimestampSchema,
    closedByUserId: nullableUserIdSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateKindAndImpact(value, context)
    validateResolution(value, context)

    if ((value.status === "resolved" || value.status === "closed") && (!value.closedAt || !value.closedByUserId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal requests require closure metadata",
        path: ["closedAt"]
      })
    }

    if ((value.status === "open" || value.status === "in_review") && (value.closedAt || value.closedByUserId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active requests cannot include closure metadata",
        path: ["closedAt"]
      })
    }

    if (value.status === "open" && (value.triagedAt || value.triagedByUserId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open requests cannot include triage metadata",
        path: ["triagedAt"]
      })
    }

    if (value.status !== "open" && (!value.triagedAt || !value.triagedByUserId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reviewed requests require triage metadata",
        path: ["triagedAt"]
      })
    }
  })

export type SupportRequestKind = z.infer<typeof supportRequestKindSchema>
export type SupportRequestImpact = z.infer<typeof supportRequestImpactSchema>
export type SupportRequestStatus = z.infer<typeof supportRequestStatusSchema>
export type SupportRequestResolutionCode = z.infer<typeof supportRequestResolutionCodeSchema>
export type SubmitSupportRequestInput = z.infer<typeof submitSupportRequestInputSchema>
export type ReviewSupportRequestInput = z.infer<typeof reviewSupportRequestInputSchema>
export type SupportRequest = z.infer<typeof supportRequestSchema>
