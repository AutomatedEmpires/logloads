import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HostReadiness } from "@/components/v3/HostPages"

type ReadinessProps = React.ComponentProps<typeof HostReadiness>

function renderReadiness(overrides: Partial<ReadinessProps> = {}): string {
  vi.stubGlobal("React", React)

  const props: ReadinessProps = {
    billingProfileStatus: "none",
    canManageLandings: true,
    canPublish: true,
    facts: {
      activeLandingCount: 1,
      activeRouteCount: 1,
      hasDraft: true,
      hasLanding: true,
      hasRate: true,
      hasRoute: true,
      preparedWorkCount: 1,
      rateCount: 1,
      readyCount: 4
    },
    title: "Prepare your first timber movement",
    welcome: true,
    feeAgreementAccepted: true,
    welcomeSource: "created",
    workspaceName: "Summit Ridge Timber",
    ...overrides
  }

  return renderToStaticMarkup(React.createElement(HostReadiness, props))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Host first-run billing readiness", () => {
  it("keeps accepted fee terms with no card in Billing", () => {
    const markup = renderReadiness()

    expect(markup).toContain('href="/host/billing"')
    expect(markup).toContain("Review host billing")
    expect(markup).toContain(
      "The 2% host fee terms are accepted. Attach a working payment method in Billing before publishing live work."
    )
    expect(markup).toContain("Accepting the fee terms and attaching a card is the final step.")
    expect(markup).not.toContain("Open command center")
    expect(markup).not.toContain("Billing is ready for this workspace.")
  })

  it("routes to Command only when the fee terms and card are ready", () => {
    const markup = renderReadiness({ billingProfileStatus: "attached" })

    expect(markup).toContain('href="/host/command"')
    expect(markup).toContain("Open command center")
    expect(markup).toContain("Billing is ready for this workspace.")
    expect(markup).toContain(
      "The 2% host fee terms are accepted and a working payment method is attached."
    )
    expect(markup).not.toContain("Review host billing")
  })

  it("keeps a failed card out of the ready state", () => {
    const markup = renderReadiness({ billingProfileStatus: "failed" })

    expect(markup).toContain("the payment method failed")
    expect(markup).toContain("Replace it in Billing before publishing live work.")
    expect(markup).not.toContain("Open command center")
  })

  it("asks a host that has not accepted the fee terms to accept them before anything else", () => {
    const markup = renderReadiness({
      billingProfileStatus: "attached",
      feeAgreementAccepted: false
    })

    expect(markup).toContain(
      "Accept the 2% host fee terms in Billing and attach a card before publishing live work."
    )
    expect(markup).toContain('href="/host/billing"')
    expect(markup).not.toContain("Open command center")
  })

  it("describes an invitation as joining the existing workspace", () => {
    const markup = renderReadiness({ welcomeSource: "invited" })

    expect(markup).toContain("Workspace joined")
    expect(markup).toContain("Summit Ridge Timber is now your active host workspace.")
    expect(markup).not.toContain("Your host workspace is created")
  })

  it("keeps the joined workspace identity when billing is already ready", () => {
    const markup = renderReadiness({
      billingProfileStatus: "attached",
      welcomeSource: "invited"
    })

    expect(markup).toContain("Workspace joined")
    expect(markup).toContain("Summit Ridge Timber is now your active host workspace.")
    expect(markup).toContain("The agreement and payment method are ready.")
    expect(markup).not.toContain("Your host workspace is created")
  })

  it("uses neutral copy when the short-lived first-run source is unavailable", () => {
    const markup = renderReadiness({ welcomeSource: undefined })

    expect(markup).toContain("Workspace ready")
    expect(markup).toContain("This host workspace is ready for setup.")
    expect(markup).not.toContain("Workspace created")
    expect(markup).not.toContain("Workspace joined")
  })
})
