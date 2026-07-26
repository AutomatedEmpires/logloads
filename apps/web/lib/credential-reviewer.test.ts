import {
  credentialKindSchema,
  credentialReviewDecisionSchema,
  type CredentialReviewDecision
} from "@logloads/contracts"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  CREDENTIAL_IMAGE_FORMATS,
  CREDENTIAL_REVIEW_OUTPUT_SCHEMA,
  DEFAULT_CREDENTIAL_REVIEW_MODEL,
  credentialReviewCeiling,
  reviewCredentialDocument,
  type CredentialModelReading,
  type CredentialReviewOutcome,
  type CredentialReviewRequest
} from "./credential-reviewer"

/**
 * Nothing here touches the network. Every provider interaction goes through an
 * injected `fetcher`, and one test asserts the fetcher is never called at all
 * when there is no key — because "fails closed" and "fails closed without
 * shipping a driver's licence to a provider we cannot authenticate to" are two
 * different guarantees.
 */

const NOW_ISO = "2026-07-26T12:00:00.000Z"
const CONFIGURED = { ANTHROPIC_API_KEY: "test-key" } as const

const cdlRequest: CredentialReviewRequest = {
  claimedKind: "cdl",
  document: { base64Data: "aGVsbG8=", format: "jpg" },
  holderName: "Dale Rousseau",
  statedExpiresOn: "2027-04-30T04:00:00.000Z",
  statedIdentifier: "ME-4471902",
  statedIssuer: "State of Maine"
}

const truckRequest: CredentialReviewRequest = {
  claimedKind: "truck",
  document: { base64Data: "aGVsbG8=", format: "png" },
  holderName: "Dale Rousseau",
  statedExpiresOn: null,
  statedIdentifier: null,
  statedIssuer: null
}

/** A model answer that should clear every check for `cdlRequest`. */
function cleanReading(overrides: Partial<CredentialModelReading> = {}): CredentialModelReading {
  return {
    confidence: 0.94,
    decision: "approved",
    documentKind: "cdl",
    expiresOn: "2027-04-30",
    findings: [],
    holderNameMatchesClaim: true,
    identifierMatchesClaim: true,
    issuer: "State of Maine",
    kindMatchesClaim: true,
    legible: true,
    rationale: "Your licence is readable and in date.",
    requestedEvidence: [],
    ...overrides
  }
}

function providerResponse(reading: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      content: [
        { text: "", type: "thinking" },
        { text: JSON.stringify(reading), type: "text" }
      ],
      model: "claude-opus-5",
      stop_reason: "end_turn",
      ...extra
    }),
    { status: 200 }
  )
}

function respondingFetcher(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response)
}

async function review(
  request: CredentialReviewRequest,
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  environment: Record<string, string | undefined> = { ...CONFIGURED }
): Promise<CredentialReviewOutcome> {
  return reviewCredentialDocument(request, { environment, fetcher, nowIso: NOW_ISO })
}

/** Asserts the outcome is not an approval, and narrows nothing. */
function expectNotApproved(outcome: CredentialReviewOutcome): void {
  if (outcome.status === "reviewed") {
    expect(outcome.decision).not.toBe("approved")
    return
  }

  expect(outcome.status).toBe("unavailable")
}

describe("credential reviewer: it fails closed", () => {
  it("cannot be approved by any provider failure mode", async () => {
    // The single most important assertion in this file: enumerate every way the
    // provider can fail and require that NONE of them produces an approval.
    const failures: Array<{
      environment?: Record<string, string | undefined>
      expected: string
      fetcher: ReturnType<typeof vi.fn<typeof fetch>>
      label: string
    }> = [
      {
        environment: {},
        expected: "model_not_configured",
        fetcher: vi.fn<typeof fetch>(),
        label: "no API key"
      },
      {
        expected: "provider_unreachable",
        fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
        label: "network error"
      },
      {
        expected: "provider_timeout",
        fetcher: vi
          .fn<typeof fetch>()
          .mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
        label: "timeout"
      },
      {
        expected: "provider_rate_limited",
        fetcher: respondingFetcher(new Response("{}", { status: 429 })),
        label: "rate limit"
      },
      {
        expected: "provider_rejected",
        fetcher: respondingFetcher(new Response("{}", { status: 500 })),
        label: "server error"
      },
      {
        expected: "provider_rejected",
        fetcher: respondingFetcher(new Response("{}", { status: 401 })),
        label: "bad credentials"
      },
      {
        expected: "provider_refused",
        fetcher: respondingFetcher(
          providerResponse(cleanReading(), { stop_reason: "refusal" })
        ),
        label: "safety refusal"
      },
      {
        expected: "response_truncated",
        fetcher: respondingFetcher(
          providerResponse(cleanReading(), { stop_reason: "max_tokens" })
        ),
        label: "truncated answer"
      },
      {
        expected: "response_unreadable",
        fetcher: respondingFetcher(
          new Response(
            JSON.stringify({
              content: [{ text: "I'm sorry, I can't read that document.", type: "text" }],
              stop_reason: "end_turn"
            }),
            { status: 200 }
          )
        ),
        label: "prose instead of JSON"
      },
      {
        expected: "response_unreadable",
        fetcher: respondingFetcher(new Response("<html>gateway</html>", { status: 200 })),
        label: "non-JSON body"
      },
      {
        expected: "response_unreadable",
        fetcher: respondingFetcher(
          new Response(JSON.stringify({ content: [], stop_reason: "end_turn" }), { status: 200 })
        ),
        label: "empty content"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(providerResponse(cleanReading({ decision: "verified" as never }))),
        label: "unexpected decision enum"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse(cleanReading({ documentKind: "medical_card" as never }))
        ),
        label: "unexpected kind enum"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse(cleanReading({ expiresOn: "next March" as never }))
        ),
        label: "malformed date"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(providerResponse(cleanReading({ expiresOn: "2027-04-31" }))),
        label: "impossible calendar date"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse({ ...cleanReading(), rationale: undefined })
        ),
        label: "missing rationale"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(providerResponse({ decision: "approved" })),
        label: "almost every field missing"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(providerResponse(cleanReading({ confidence: 4 }))),
        label: "confidence out of range"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(providerResponse(cleanReading({ rationale: "   " }))),
        label: "blank rationale"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse(
            cleanReading({ decision: "more_info_required", requestedEvidence: [] })
          )
        ),
        label: "asks for more with nothing named"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse(cleanReading({ requestedEvidence: ["a clearer photo"] }))
        ),
        label: "approves with something outstanding"
      },
      {
        expected: "response_invalid",
        fetcher: respondingFetcher(
          providerResponse(cleanReading({ rationale: "x".repeat(2001) }))
        ),
        label: "rationale longer than storage allows"
      }
    ]

    for (const failure of failures) {
      const outcome = await review(cdlRequest, failure.fetcher, failure.environment ?? {
        ...CONFIGURED
      })

      expect(outcome, failure.label).toMatchObject({
        reason: failure.expected,
        status: "unavailable"
      })
      expect(outcome, failure.label).not.toHaveProperty("decision")
    }
  })

  it("does not send the document anywhere when no model is configured", async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(review(cdlRequest, fetcher, {})).resolves.toMatchObject({
      providerStatus: null,
      reason: "model_not_configured",
      status: "unavailable"
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("treats a blank API key as no key at all", async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      review(cdlRequest, fetcher, { ANTHROPIC_API_KEY: "   " })
    ).resolves.toMatchObject({ reason: "model_not_configured" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("reports the provider status without ever carrying its body", async () => {
    const fetcher = respondingFetcher(
      new Response(JSON.stringify({ error: { message: "quota exhausted for org acct_9" } }), {
        status: 429
      })
    )

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toEqual({ providerStatus: 429, reason: "provider_rate_limited", status: "unavailable" })
    expect(JSON.stringify(outcome)).not.toContain("acct_9")
  })

  it("refuses a truncated answer even when the text that arrived would have parsed", async () => {
    // Negative control for reading content before checking why generation stopped:
    // the payload here is a complete, approvable answer.
    const fetcher = respondingFetcher(
      providerResponse(cleanReading(), { stop_reason: "max_tokens" })
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      reason: "response_truncated",
      status: "unavailable"
    })
  })
})

describe("credential reviewer: decisions", () => {
  it("approves a clean, in-date licence", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    await expect(review(cdlRequest, fetcher)).resolves.toEqual({
      confidence: 0.94,
      decision: "approved",
      extracted: {
        detectedKind: "cdl",
        expiresOn: "2027-04-30",
        holderName: null,
        identifier: null,
        issuedOn: null,
        issuer: "State of Maine",
        plateNumber: null,
        unitNumber: null
      },
      findings: [],
      model: "claude-opus-5",
      overrodeModelDecision: false,
      rationale: "Your licence is readable and in date.",
      requestedEvidence: [],
      status: "reviewed"
    })
  })

  it("denies a document that is not the kind claimed", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          decision: "denied",
          documentKind: "insurance",
          kindMatchesClaim: false,
          rationale: "This is a certificate of insurance, not a licence."
        })
      )
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      decision: "denied",
      overrodeModelDecision: false,
      status: "reviewed"
    })
  })

  it("denies an expired document", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          decision: "denied",
          expiresOn: "2026-03-01",
          rationale: "This licence expired in March."
        })
      )
    )
    const request = { ...cdlRequest, statedExpiresOn: "2026-03-01T05:00:00.000Z" }

    await expect(review(request, fetcher)).resolves.toMatchObject({
      decision: "denied",
      status: "reviewed"
    })
  })

  it("asks for more when the document cannot be read", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          decision: "more_info_required",
          documentKind: null,
          expiresOn: null,
          holderNameMatchesClaim: null,
          identifierMatchesClaim: null,
          issuer: null,
          legible: false,
          rationale: "The photo is too dark to read.",
          requestedEvidence: ["A photo taken in better light."]
        })
      )
    )

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({ decision: "more_info_required", status: "reviewed" })
    if (outcome.status === "reviewed") {
      expect(outcome.requestedEvidence.length).toBeGreaterThan(0)
    }
  })

  it("asks for more when the expiry read off the document is not the one the driver typed", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ expiresOn: "2028-04-30" }))
    )

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({
      decision: "more_info_required",
      overrodeModelDecision: true,
      status: "reviewed"
    })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("expiry_disagrees_with_driver")
      expect(outcome.requestedEvidence.length).toBeGreaterThan(0)
    }
  })

  it("accepts the same expiry expressed as a different instant on the same day", async () => {
    // The vault stores an instant, the document prints a date. Comparing at day
    // precision is the only comparison the two share; a stricter one would
    // manufacture a disagreement out of a time zone.
    const fetcher = respondingFetcher(providerResponse(cleanReading()))
    const request = { ...cdlRequest, statedExpiresOn: "2027-04-30T23:59:00.000Z" }

    await expect(review(request, fetcher)).resolves.toMatchObject({
      decision: "approved",
      status: "reviewed"
    })
  })

  it("reports the model that actually answered, not the one requested", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading(), { model: "claude-opus-4-8" })
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      model: "claude-opus-4-8",
      status: "reviewed"
    })
  })

  it("falls back to the requested model id when the provider names none", async () => {
    const fetcher = respondingFetcher(
      new Response(
        JSON.stringify({
          content: [{ text: JSON.stringify(cleanReading()), type: "text" }],
          stop_reason: "end_turn"
        }),
        { status: 200 }
      )
    )

    // A review record must name the model that decided; an empty name would be
    // an AI decision nobody can attribute.
    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      model: DEFAULT_CREDENTIAL_REVIEW_MODEL,
      status: "reviewed"
    })
  })
})

describe("credential reviewer: the model can only be overruled toward refusal", () => {
  it("never yields an approval unless both the model and the facts allow one", async () => {
    // Enumerated coverage over the contract's own decision set crossed with
    // every deterministic ceiling. Typed as an exhaustive Record, so a decision
    // added to the contract fails to compile here rather than going untested.
    const strictness: Record<CredentialReviewDecision, number> = {
      approved: 0,
      denied: 2,
      more_info_required: 1
    }
    /** Reading fields that force each ceiling, independent of the expiry dates. */
    const forceCeiling: Record<CredentialReviewDecision, Partial<CredentialModelReading>> = {
      approved: {},
      denied: { kindMatchesClaim: false },
      more_info_required: { legible: false }
    }

    for (const modelDecision of credentialReviewDecisionSchema.options) {
      for (const ceiling of credentialReviewDecisionSchema.options) {
        const label = `model=${modelDecision} ceiling=${ceiling}`
        const reading = cleanReading({
          decision: modelDecision,
          requestedEvidence: modelDecision === "more_info_required" ? ["a clearer photo"] : [],
          ...forceCeiling[ceiling]
        })

        expect(credentialReviewCeiling(reading, cdlRequest, NOW_ISO).ceiling, label).toBe(ceiling)

        const outcome = await review(cdlRequest, respondingFetcher(providerResponse(reading)))

        expect(outcome.status, label).toBe("reviewed")
        if (outcome.status !== "reviewed") {
          continue
        }

        // The returned decision is never more permissive than either input, and
        // is an approval only when both inputs were.
        expect(strictness[outcome.decision], label).toBeGreaterThanOrEqual(
          strictness[modelDecision]
        )
        expect(strictness[outcome.decision], label).toBeGreaterThanOrEqual(strictness[ceiling])
        expect(outcome.decision === "approved", label).toBe(
          modelDecision === "approved" && ceiling === "approved"
        )
      }
    }
  })

  it("reports its reasons in a fixed order, so the same document always reads the same", () => {
    const reading = cleanReading({
      decision: "denied",
      documentKind: null,
      expiresOn: null,
      holderNameMatchesClaim: null,
      identifierMatchesClaim: false,
      legible: false
    })

    expect(credentialReviewCeiling(reading, cdlRequest, NOW_ISO)).toEqual({
      ceiling: "more_info_required",
      reasons: [
        "kind_unreadable",
        "document_illegible",
        "holder_name_unreadable",
        "identifier_mismatch",
        "expiry_unreadable"
      ]
    })
  })

  it("never softens a refusal the model already reached", async () => {
    // A clean document plus a model that denied it: the denial stands, and it is
    // not recorded as an override because we did not overrule anything.
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({ decision: "denied", rationale: "The tamper seal is broken." })
      )
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      decision: "denied",
      overrodeModelDecision: false,
      rationale: "The tamper seal is broken.",
      status: "reviewed"
    })
  })

  it("refuses an approval the model contradicts itself about", async () => {
    // documentKind says cdl, kindMatchesClaim says no. The permissive reading of
    // a self-contradiction would let this through as an approval.
    const fetcher = respondingFetcher(providerResponse(cleanReading({ kindMatchesClaim: false })))

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({ decision: "denied", overrodeModelDecision: true })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("kind_mismatch")
    }
  })

  it("refuses an approval of an illegible document", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading({ legible: false })))

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({
      decision: "more_info_required",
      overrodeModelDecision: true
    })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("document_illegible")
      expect(outcome.requestedEvidence.length).toBeGreaterThan(0)
    }
  })

  it("refuses an approval of a lapsed document", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ expiresOn: "2026-07-25" }))
    )
    const request = { ...cdlRequest, statedExpiresOn: "2026-07-25T04:00:00.000Z" }

    const outcome = await review(request, fetcher)

    expect(outcome).toMatchObject({ decision: "denied", overrodeModelDecision: true })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("expiry_lapsed")
    }
  })

  it("does not deny on the last day the document is still valid", async () => {
    // Boundary, and the direction matters: the vault gate compares instants and
    // blocks the moment it lapses, so refusing here would be a denial the
    // document does not support.
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ expiresOn: "2026-07-26" }))
    )
    const request = { ...cdlRequest, statedExpiresOn: "2026-07-26T23:00:00.000Z" }

    await expect(review(request, fetcher)).resolves.toMatchObject({ decision: "approved" })
  })

  it("denies rather than asking for more when the two dates disagree but both have passed", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ expiresOn: "2026-01-01" }))
    )
    const request = { ...cdlRequest, statedExpiresOn: "2026-02-01T05:00:00.000Z" }

    const outcome = await review(request, fetcher)

    expect(outcome).toMatchObject({ decision: "denied" })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("expiry_lapsed")
      expect(outcome.findings).not.toContain("expiry_disagrees_with_driver")
    }
  })

  it("refuses an approval when the name on a licence is not the driver's", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ holderNameMatchesClaim: false }))
    )

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({ decision: "denied" })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("holder_name_mismatch")
    }
  })

  it("does not hold a company's name on an insurance certificate against the driver", async () => {
    // A driver covered by a carrier's policy is correctly covered. Requiring the
    // driver's own name here would refuse exactly those drivers.
    const insuranceRequest: CredentialReviewRequest = {
      ...cdlRequest,
      claimedKind: "insurance",
      statedIdentifier: null
    }
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({ documentKind: "insurance", holderNameMatchesClaim: false })
      )
    )

    await expect(review(insuranceRequest, fetcher)).resolves.toMatchObject({
      decision: "approved",
      status: "reviewed"
    })
  })

  it("does not demand an expiry from an equipment photo", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          documentKind: "truck",
          expiresOn: null,
          holderNameMatchesClaim: null,
          identifierMatchesClaim: null,
          issuer: null,
          rationale: "The truck and its unit number are clearly visible."
        })
      )
    )

    await expect(review(truckRequest, fetcher)).resolves.toMatchObject({
      decision: "approved",
      status: "reviewed"
    })
  })

  it("asks for more when a licence shows no readable expiry", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ expiresOn: null }))
    )
    const request = { ...cdlRequest, statedExpiresOn: null }

    const outcome = await review(request, fetcher)

    expect(outcome).toMatchObject({
      decision: "more_info_required",
      overrodeModelDecision: true
    })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("expiry_unreadable")
    }
  })

  it("asks for more when the stated number is not on the document", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ identifierMatchesClaim: false }))
    )

    const outcome = await review(cdlRequest, fetcher)

    expect(outcome).toMatchObject({ decision: "more_info_required" })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toContain("identifier_mismatch")
    }
  })

  it("does not withhold approval merely because no number was legible", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ identifierMatchesClaim: null }))
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({ decision: "approved" })
  })

  it("does not check a number against a driver who stated none", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ identifierMatchesClaim: false }))
    )
    const request = { ...cdlRequest, statedIdentifier: null }

    await expect(review(request, fetcher)).resolves.toMatchObject({ decision: "approved" })
  })
})

describe("credential reviewer: what an overruled review says", () => {
  it("discards the model's wording entirely, so the driver is never told something untrue", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          expiresOn: "2020-01-01",
          findings: ["all_checks_passed"],
          rationale: "Everything looks good — you are all set to haul."
        })
      )
    )

    // Both dates agree and both are in the past, so this is a lapse rather than
    // a disagreement — see the expiry tests above for that distinction.
    const outcome = await review(
      { ...cdlRequest, statedExpiresOn: "2020-01-01T05:00:00.000Z" },
      fetcher
    )

    expect(outcome).toMatchObject({ decision: "denied", overrodeModelDecision: true })
    if (outcome.status === "reviewed") {
      expect(outcome.rationale).not.toContain("all set")
      expect(outcome.findings).not.toContain("all_checks_passed")
      expect(outcome.rationale.trim().length).toBeGreaterThan(0)
    }
  })

  it("drops the model's confidence once it has been overruled", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ confidence: 0.99, legible: false }))
    )

    // 0.99 was its confidence in approving. Reporting it beside our refusal
    // would attribute a certainty to a decision the model never made.
    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      confidence: null,
      overrodeModelDecision: true
    })
  })

  it("keeps the model's wording and appends our findings when they agree", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({
          decision: "denied",
          expiresOn: "2020-01-01",
          findings: ["seal_broken"],
          rationale: "The tamper seal is broken."
        })
      )
    )

    const outcome = await review(
      { ...cdlRequest, statedExpiresOn: "2020-01-01T05:00:00.000Z" },
      fetcher
    )

    expect(outcome).toMatchObject({
      confidence: 0.94,
      decision: "denied",
      overrodeModelDecision: false,
      rationale: "The tamper seal is broken."
    })
    if (outcome.status === "reviewed") {
      expect(outcome.findings).toEqual(expect.arrayContaining(["seal_broken", "expiry_lapsed"]))
    }
  })

  it("always names evidence when it asks for more", async () => {
    // The row contract refuses a more_info_required credential with nothing
    // outstanding, so an overruled review that named nothing could not be stored.
    for (const overrides of [
      { legible: false },
      { documentKind: null },
      { expiresOn: null },
      { holderNameMatchesClaim: null },
      { identifierMatchesClaim: false },
      { expiresOn: "2029-01-01" }
    ] satisfies Array<Partial<CredentialModelReading>>) {
      const fetcher = respondingFetcher(providerResponse(cleanReading(overrides)))
      const outcome = await review({ ...cdlRequest, statedExpiresOn: "2027-04-30T04:00:00.000Z" }, fetcher)

      if (outcome.status === "reviewed" && outcome.decision === "more_info_required") {
        expect(outcome.requestedEvidence.length, JSON.stringify(overrides)).toBeGreaterThan(0)
        for (const evidence of outcome.requestedEvidence) {
          expect(evidence.trim().length).toBeGreaterThan(0)
          expect(evidence.length).toBeLessThanOrEqual(200)
        }
      } else {
        expectNotApproved(outcome)
      }
    }
  })
})

describe("credential reviewer: the driver's number does not come back", () => {
  it("refuses a response that restates the stated number", async () => {
    const fetcher = respondingFetcher(
      providerResponse(
        cleanReading({ rationale: "Licence ME-4471902 is readable and in date." })
      )
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      reason: "response_disclosed_identifier",
      status: "unavailable"
    })
  })

  it("catches the number rewritten with different punctuation", async () => {
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ findings: ["number_read_as_me 447 1902"] }))
    )

    await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
      reason: "response_disclosed_identifier",
      status: "unavailable"
    })
  })

  it("catches the number hidden in requested evidence or the issuer field", async () => {
    for (const overrides of [
      { requestedEvidence: ["Confirm ME4471902 is yours"], decision: "more_info_required" as const },
      { issuer: "State of Maine (ME-4471902)" }
    ] satisfies Array<Partial<CredentialModelReading>>) {
      const fetcher = respondingFetcher(providerResponse(cleanReading(overrides)))

      await expect(review(cdlRequest, fetcher)).resolves.toMatchObject({
        reason: "response_disclosed_identifier",
        status: "unavailable"
      })
    }
  })

  it("does not refuse over a short number that appears by coincidence", async () => {
    // A false positive here blocks a driver on every retry, forever. Below the
    // match floor, containment is coincidence more often than disclosure.
    const request = { ...cdlRequest, statedIdentifier: "ME-1" }
    const fetcher = respondingFetcher(
      providerResponse(cleanReading({ rationale: "Issued in ME, expires 2027." }))
    )

    await expect(review(request, fetcher)).resolves.toMatchObject({ status: "reviewed" })
  })

  it("never returns the number, the name, or the image, however clean the review", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    const outcome = await review(cdlRequest, fetcher)
    const serialized = JSON.stringify(outcome)

    expect(serialized).not.toContain("4471902")
    expect(serialized).not.toContain("Dale Rousseau")
    expect(serialized).not.toContain(cdlRequest.document.base64Data)
    if (outcome.status === "reviewed") {
      expect(outcome.extracted.identifier).toBeNull()
      expect(outcome.extracted.holderName).toBeNull()
    }
  })
})

describe("credential reviewer: what goes to the provider", () => {
  it("sends the document as bytes, with the media type its stored format implies", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    await review(cdlRequest, fetcher)

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
      model: string
      output_config: { format: { schema: { properties: Record<string, unknown> } } }
    }

    expect(url).toBe("https://api.anthropic.com/v1/messages")
    expect(body.model).toBe(DEFAULT_CREDENTIAL_REVIEW_MODEL)
    expect(body.messages[0]?.content[0]).toEqual({
      source: { data: "aGVsbG8=", media_type: "image/jpeg", type: "base64" },
      type: "image"
    })
    // The image is passed as bytes and never as a URL: a delivery URL that
    // leaks is a leaked licence.
    expect(JSON.stringify(body)).not.toContain("cloudinary")
    expect(body.output_config.format.schema.properties).toHaveProperty("decision")
  })

  it("honours a configured model override", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    await review(cdlRequest, fetcher, {
      ...CONFIGURED,
      CREDENTIAL_REVIEW_MODEL: "claude-sonnet-5"
    })

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).model).toBe("claude-sonnet-5")
  })

  it("authenticates with the key header the provider expects and nothing else", async () => {
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    await review(cdlRequest, fetcher)

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": "test-key"
    })
  })
})

describe("credential reviewer: the output schema is derived, not retyped", () => {
  it("offers the model exactly the decisions the contract defines", () => {
    const schema = CREDENTIAL_REVIEW_OUTPUT_SCHEMA as {
      properties: Record<string, { anyOf?: Array<{ enum?: string[] }>; enum?: string[] }>
    }

    expect(schema.properties.decision?.enum).toEqual([...credentialReviewDecisionSchema.options])
    expect(schema.properties.documentKind?.anyOf?.[0]?.enum).toEqual([
      ...credentialKindSchema.options
    ])
  })

  it("requires every property it declares", () => {
    // A field added without a matching `required` entry is how a strict schema
    // silently starts accepting half an answer.
    const schema = CREDENTIAL_REVIEW_OUTPUT_SCHEMA as {
      additionalProperties: boolean
      properties: Record<string, unknown>
      required: string[]
    }

    expect(schema.additionalProperties).toBe(false)
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
  })

  it("asks the model for no field that could carry the driver's number", () => {
    const schema = CREDENTIAL_REVIEW_OUTPUT_SCHEMA as { properties: Record<string, unknown> }

    expect(Object.keys(schema.properties)).not.toContain("identifier")
    expect(Object.keys(schema.properties)).toContain("identifierMatchesClaim")
  })

  it("covers every stored image format", () => {
    // Each format must reach the provider under a real media type; a guessed one
    // would come back as a transport failure rather than the omission it is.
    expect([...CREDENTIAL_IMAGE_FORMATS].sort()).toEqual(["jpeg", "jpg", "png", "webp"])
  })
})

describe("credential reviewer: a broken clock is a bug, not a silent pass", () => {
  it("throws on an unparsable caller clock rather than reviewing against today", async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      reviewCredentialDocument(cdlRequest, {
        environment: { ...CONFIGURED },
        fetcher,
        nowIso: "sometime tuesday"
      })
    ).rejects.toThrow(/parsable instant/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("throws on an unparsable stated expiry rather than skipping the expiry check", async () => {
    // Silently ignoring it would drop the comparison this module exists to make.
    const fetcher = respondingFetcher(providerResponse(cleanReading()))

    await expect(
      review({ ...cdlRequest, statedExpiresOn: "expires soon" }, fetcher)
    ).rejects.toThrow(/statedExpiresOn/)
  })
})
