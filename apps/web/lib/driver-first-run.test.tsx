import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DriverFirstRunPanel } from "@/components/v3/DriverPages"

vi.mock("server-only", () => ({}))

type PanelProps = React.ComponentProps<typeof DriverFirstRunPanel>

const blockedNotice =
  "You cannot accept loads yet. No assigned rig has every required record approved and current."

function renderPanel(overrides: Partial<PanelProps> = {}): string {
  vi.stubGlobal("React", React)

  const props: PanelProps = {
    accountName: "Alex Driver",
    availability: null,
    continuationHref: null,
    credentialVault: {
      blockedNotice,
      headline: "You can't accept loads yet.",
      satisfied: false
    },
    driverName: "Alex Driver",
    equipmentLabel: null,
    verifications: [{ status: "pending" }],
    ...overrides
  }

  return renderToStaticMarkup(React.createElement(DriverFirstRunPanel, props))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DriverFirstRunPanel", () => {
  it("renders a durable, accessible setup handoff with the exact credential lock", () => {
    const markup = renderPanel({
      continuationHref: "/driver/loads/load-123?from=onboarding"
    })

    expect(markup).toContain('aria-labelledby="driver-first-run-title"')
    expect(markup).toContain('data-testid="driver-first-run"')
    expect(markup).toContain('aria-label="Driver setup checklist"')
    expect(markup).toContain("Account and profile created")
    expect(markup).toContain("Load acceptance locked")
    expect(markup).toContain(blockedNotice)
    expect(markup).toContain('data-credential-satisfied="false"')
    expect(markup).toContain('href="#driver-credential-vault"')
    expect(markup).toContain('action="/driver/first-run/continue"')
    expect(markup).not.toContain("load-123")
    expect(markup).not.toContain("Credential gate cleared")
  })

  it("claims a cleared credential gate only when the vault is satisfied", () => {
    const headline = "At least one assigned rig is cleared to request loads."
    const markup = renderPanel({
      availability: {
        id: "availability-1",
        notes: null,
        status: "available",
        windowLabel: "Aug 6, 6:00 AM - Aug 6, 6:00 PM UTC"
      },
      credentialVault: {
        blockedNotice: null,
        headline,
        satisfied: true
      },
      equipmentLabel: "Truck 14 with log trailer",
      verifications: [{ status: "verified" }]
    })

    expect(markup).toContain("Credential gate cleared")
    expect(markup).toContain(headline)
    expect(markup).toContain('data-credential-satisfied="true"')
    expect(markup).toContain('data-testid="driver-first-run-equipment"')
    expect(markup).toContain("Truck 14 with log trailer")
    expect(markup).not.toContain("Load acceptance locked")
  })

  it("distinguishes an existing account from a missing driver profile", () => {
    const markup = renderPanel({
      credentialVault: null,
      driverName: null,
      verifications: []
    })

    expect(markup).toContain("Account created")
    expect(markup).toContain("no driver profile on file")
    expect(markup).toContain("Load acceptance locked")
    expect(markup).toContain("No credential gate can be evaluated until a driver profile is on file.")
    expect(markup).not.toContain('data-testid="driver-first-run-continuation"')
    expect(markup).not.toContain("Credential gate cleared")
  })

  it("keeps mixed verification state open and surfaces the record needing attention", () => {
    const markup = renderPanel({
      verifications: [{ status: "verified" }, { status: "rejected" }]
    })
    const verificationItem = markup.match(
      /<li[^>]*data-state="([^"]+)"[^>]*data-testid="driver-first-run-verification"[^>]*>(.*?)<\/li>/
    )

    expect(verificationItem?.[1]).toBe("incomplete")
    expect(verificationItem?.[2]).toContain("1 verification record needs attention below.")
    expect(verificationItem?.[2]).not.toContain("Complete:")
  })

  it("labels a created unit as an equipment record, not exact-rig clearance", () => {
    const markup = renderPanel({ equipmentLabel: "Unit 1" })

    expect(markup).toContain("Equipment record:")
    expect(markup).toContain("Exact-rig requirements are evaluated separately below.")
    expect(markup).not.toContain("Complete: </span><strong>Equipment:</strong>")
  })
})
