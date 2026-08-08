import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  HostOpportunityAction,
  hostCapacityGapEmptyState
} from "@/components/v3/HostPages"

function renderAction(
  canPublish: boolean,
  activationComplete: boolean,
  context: React.ComponentProps<typeof HostOpportunityAction>["context"]
): string {
  vi.stubGlobal("React", React)

  return renderToStaticMarkup(
    React.createElement(HostOpportunityAction, { activationComplete, canPublish, context })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("host work actions", () => {
  it("offers publication from Command only when authorization and activation are ready", () => {
    const markup = renderAction(true, true, "command")

    expect(markup).toContain('href="/host/opportunities"')
    expect(markup).toContain("Publish work")
    expect(markup).not.toContain("Prepare work")
    expect(markup).not.toContain("Review work")
  })

  it("lets an authorized host prepare Command work while activation is incomplete", () => {
    const markup = renderAction(true, false, "command")

    expect(markup).toContain('href="/host/opportunities"')
    expect(markup).toContain("Prepare work")
    expect(markup).not.toContain("Publish work")
    expect(markup).not.toContain("Review work")
  })

  it("gives a non-publisher a truthful Command review action", () => {
    const markup = renderAction(false, true, "command")

    expect(markup).toContain('href="/host/opportunities"')
    expect(markup).toContain("Review work")
    expect(markup).not.toContain("Publish work")
  })

  it("routes a non-publisher from a landing to workspace access guidance", () => {
    const markup = renderAction(false, false, "landing")

    expect(markup).toContain('href="/host/settings"')
    expect(markup).toContain("Review workspace access")
    expect(markup).not.toContain("Publish from this landing")
  })

  it.each([true, false])(
    "keeps an authorized Landing action generic when activationComplete=%s",
    (activationComplete) => {
      const markup = renderAction(true, activationComplete, "landing")

      expect(markup).toContain('href="/host/opportunities"')
      expect(markup).toContain("Prepare work")
      expect(markup).not.toContain("Publish work")
      expect(markup).not.toContain("Publish from this landing")
    }
  )

  it.each([
    { activationComplete: true, expectedAction: "Publish work", forbiddenAction: "Prepare work", planned: 0 },
    { activationComplete: false, expectedAction: "Prepare work", forbiddenAction: "Publish work", planned: 0 },
    { activationComplete: true, expectedAction: "Publish work", forbiddenAction: "Prepare work", planned: 3 },
    { activationComplete: false, expectedAction: "Prepare work", forbiddenAction: "Publish work", planned: 3 }
  ])(
    "keeps the Command capacity state truthful when planned=$planned and activationComplete=$activationComplete",
    ({ activationComplete, expectedAction, forbiddenAction, planned }) => {
      const emptyState = hostCapacityGapEmptyState({
        activationComplete,
        canPublish: true,
        planned
      })

      expect(emptyState.actionHref).toBe("/host/opportunities")
      expect(emptyState.actionLabel).toBe(expectedAction)
      expect(emptyState.body).toContain(activationComplete ? "Publish the next block" : "publication remains locked")
      expect(`${emptyState.actionLabel} ${emptyState.body}`).not.toContain(forbiddenAction)
    }
  )

  it("keeps a non-publisher capacity gap in review mode", () => {
    const emptyState = hostCapacityGapEmptyState({
      activationComplete: true,
      canPublish: false,
      planned: 3
    })

    expect(emptyState.actionLabel).toBe("Review work")
    expect(emptyState.body).toContain("authorized publisher")
    expect(`${emptyState.actionLabel} ${emptyState.body}`).not.toContain("Publish work")
  })
})
