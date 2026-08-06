import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { VerificationQueueDecisionContext } from "@logloads/services"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)
vi.mock("@/lib/cockpit-actions", () => ({
  resolveNoticeAction: vi.fn(),
  reviewOrganizationAction: vi.fn(),
  reviewVerificationAction: vi.fn()
}))

import { OrganizationDecision, VerificationDecision } from "@/components/v3/AdminActions"

type Props = React.ComponentProps<typeof OrganizationDecision>

function renderDecision(overrides: Partial<Props> = {}): string {
  const props: Props = {
    activeLoads: 0,
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "North Pine",
    suspensionBlockers: { assignments: 0, completions: 0, total: 0, trips: 0 },
    verificationStatus: "pending",
    ...overrides
  }

  return renderToStaticMarkup(React.createElement(OrganizationDecision, props))
}

function renderVerificationDecision(
  overrides: Partial<VerificationQueueDecisionContext> = {}
): string {
  const decisionContext: VerificationQueueDecisionContext = {
    allowedDecisions: ["verified", "rejected"],
    organizationStatus: null,
    suspensionBlockers: null,
    unavailableReason: null,
    ...overrides
  }

  return renderToStaticMarkup(React.createElement(VerificationDecision, {
    decisionContext,
    recordId: "a2222222-2222-4222-8222-222222222222"
  }))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("organization admin decisions", () => {
  it("shows only the valid next decisions for every organization state", () => {
    const pending = renderDecision()
    const rejected = renderDecision({ verificationStatus: "rejected" })
    const suspended = renderDecision({ verificationStatus: "suspended" })

    expect(pending).toContain("Verify")
    expect(pending).toContain("Reject")
    expect(pending).not.toContain("Reinstate")
    expect(pending).not.toContain("Reopen review")
    expect(rejected).toContain("Reopen review")
    expect(rejected).not.toContain("Verify")
    expect(rejected).not.toContain("Suspend")
    expect(suspended).toContain("Reinstate")
    expect(suspended).not.toContain("Reopen review")
    expect(suspended).not.toContain("Suspend")
  })

  it("requires a bounded reason and explicit effect confirmation before suspension", () => {
    const markup = renderDecision({
      activeLoads: 2,
      verificationStatus: "verified"
    })

    expect(markup).toContain("Review suspension")
    expect(markup).toContain("Operational lock")
    expect(markup).toContain("2 active load postings will be removed from discovery without being erased")
    expect(markup).toContain('maxLength="500"')
    expect(markup).toContain("I understand this immediately locks North Pine")
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"[^>]*>Confirm suspension/)
  })

  it("names every protected-work blocker and prevents a suspension attempt", () => {
    const markup = renderDecision({
      suspensionBlockers: { assignments: 1, completions: 3, total: 6, trips: 2 },
      verificationStatus: "verified"
    })

    expect(markup).toContain("Suspension blocked")
    expect(markup).toContain("1 active assignment")
    expect(markup).toContain("2 active trips")
    expect(markup).toContain("3 unsettled completions")
    expect(markup).toContain("Finish or cancel that work and settle completions first")
  })

  it("prevents a pending organization from being rejected mid-haul", () => {
    const markup = renderDecision({
      suspensionBlockers: { assignments: 1, completions: 0, total: 2, trips: 1 }
    })

    expect(markup).toContain("Rejection blocked: 1 active assignment, 1 active trip")
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/)
    expect(markup).toContain("Verify")
  })
})

describe("verification queue decisions", () => {
  it("keeps both decisions for ordinary pending evidence", () => {
    const markup = renderVerificationDecision()

    expect(markup).toMatch(/>Verify<\/button>/)
    expect(markup).toMatch(/>Reject<\/button>/)
  })

  it("removes rejection and names protected work for a pending organization", () => {
    const markup = renderVerificationDecision({
      allowedDecisions: ["verified"],
      organizationStatus: "pending",
      suspensionBlockers: { assignments: 1, completions: 2, total: 4, trips: 1 }
    })

    expect(markup).toMatch(/>Verify<\/button>/)
    expect(markup).not.toMatch(/>Reject<\/button>/)
    expect(markup).toContain("Rejection unavailable: 1 active assignment, 1 active trip, 2 unsettled completions")
    expect(markup).toContain("Verification remains available")
  })

  it.each([
    {
      allowedDecisions: ["verified"] as const,
      copy: "already verified",
      label: "Resolve as verified",
      status: "verified" as const
    },
    {
      allowedDecisions: ["rejected"] as const,
      copy: "already rejected",
      label: "Resolve as rejected",
      status: "rejected" as const
    },
    {
      allowedDecisions: ["verified"] as const,
      copy: "restore operating access",
      label: "Reinstate &amp; verify",
      status: "suspended" as const
    }
  ])("shows only the accurate $status resolution", ({ allowedDecisions, copy, label, status }) => {
    const markup = renderVerificationDecision({
      allowedDecisions: [...allowedDecisions],
      organizationStatus: status,
      suspensionBlockers: { assignments: 0, completions: 0, total: 0, trips: 0 }
    })

    expect(markup).toContain(label)
    expect(markup).toContain(copy)
    expect((markup.match(/<button/g) ?? []).length).toBe(1)
  })

  it("explains an orphaned review without presenting a mutation", () => {
    const markup = renderVerificationDecision({
      allowedDecisions: [],
      unavailableReason: "organization_missing"
    })

    expect(markup).toContain("organization that no longer exists")
    expect(markup).not.toContain("<button")
  })
})
