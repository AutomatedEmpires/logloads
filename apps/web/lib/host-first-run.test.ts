import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { HostReadiness } from "@/components/v3/HostPages"

type ReadinessProps = React.ComponentProps<typeof HostReadiness>

function renderReadiness(overrides: Partial<ReadinessProps> = {}): string {
  vi.stubGlobal("React", React)

  const props: ReadinessProps = {
    activationState: "unenrolled",
    billingModel: null,
    billingProfileStatus: "none",
    canManageLandings: true,
    canPublish: true,
    currentPercentageAgreementActive: false,
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
    welcomeSource: "created",
    workspaceName: "Summit Ridge Timber",
    ...overrides
  }

  return renderToStaticMarkup(React.createElement(HostReadiness, props))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * The completed-load percentage fee is retired. A host's first run must never
 * send it to Billing to accept an agreement or attach a card before publishing:
 * neither is needed, and the acceptance would be refused.
 */
describe("Host first-run publication readiness", () => {
  it("routes a new host with no agreement and no card straight to Command", () => {
    const markup = renderReadiness()

    expect(markup).toContain('href="/host/command"')
    expect(markup).toContain("Open command center")
    expect(markup).toContain("Live publication is open for this workspace.")
    expect(markup).toContain(
      "Publishing needs no agreement or card. The completed-load percentage fee is retired, and posting work is free."
    )
    expect(markup).not.toContain("Review host billing")
  })

  it.each([
    { activationState: "percentage_active", billingModel: "percentage_v1", billingProfileStatus: "none" },
    { activationState: "percentage_active", billingModel: "percentage_v1", billingProfileStatus: "failed" },
    { activationState: "legacy", billingModel: "legacy_percentage", billingProfileStatus: "attached" },
    { activationState: "suspended", billingModel: "subscription_v1", billingProfileStatus: "attached" }
  ] as const)(
    "never asks a $activationState host with a $billingProfileStatus card to accept or attach anything",
    (overrides) => {
      const markup = renderReadiness(overrides)

      expect(markup).toContain("Live publication is open for this workspace.")
      expect(markup).not.toMatch(/accept the current|attach a working payment method|5%/i)
      expect(markup).not.toContain("Review host billing")
    }
  )

  it("holds publication only when a subscription account cannot be resolved", () => {
    const markup = renderReadiness({ activationState: "active", billingModel: null })

    expect(markup).toContain('href="/host/billing"')
    expect(markup).toContain("Review host billing")
    expect(markup).toContain(
      "This workspace&#x27;s billing record could not be verified, so live publication is held."
    )
    expect(markup).toContain("Held")
    expect(markup).not.toContain("Open command center")
    expect(markup).not.toMatch(/accept the current|5%/i)
  })

  it("describes an invitation as joining the existing workspace", () => {
    const markup = renderReadiness({ welcomeSource: "invited" })

    expect(markup).toContain("Workspace joined")
    expect(markup).toContain("Summit Ridge Timber is now your active host workspace.")
    expect(markup).toContain("Finish the operating record to put your first movement live.")
    expect(markup).not.toContain("Your host workspace is created")
  })

  it("keeps the joined workspace identity while publication is held", () => {
    const markup = renderReadiness({
      activationState: "active",
      billingModel: null,
      welcomeSource: "invited"
    })

    expect(markup).toContain("Workspace joined")
    expect(markup).toContain("Summit Ridge Timber is now your active host workspace.")
    expect(markup).toContain("live publication stays off until LogLoads support verifies the billing record.")
    expect(markup).not.toContain("Your host workspace is created")
  })

  it("uses neutral copy when the short-lived first-run source is unavailable", () => {
    const markup = renderReadiness({ welcomeSource: undefined })

    expect(markup).toContain("Workspace ready")
    expect(markup).toContain("This host workspace is ready.")
    expect(markup).not.toContain("Workspace created")
    expect(markup).not.toContain("Workspace joined")
  })
})
