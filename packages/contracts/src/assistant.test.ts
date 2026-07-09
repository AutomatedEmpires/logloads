import { describe, expect, it } from "vitest"

import {
  answerOperatorQuestion,
  suggestedPrompts,
  type AssistantGrounding
} from "./assistant"

function grounding(overrides: Partial<AssistantGrounding> = {}): AssistantGrounding {
  return {
    availability: [{ equipmentLabel: "Kenworth + pole", statusLabel: "Available", windowLabel: "Mon–Fri" }],
    hasTruck: true,
    loads: [
      {
        blockers: [],
        fitLabel: "Strong fit",
        lane: "Oakridge to Cascade Mill",
        loadId: "load-1",
        payLabel: "$1,850 per load",
        reasons: ["Truck type fits saw logs work."],
        recommended: true,
        remaining: 2,
        requestable: true,
        scheduleLabel: "Jul 9",
        statusLabel: "Open",
        title: "Oak saw-log morning run"
      },
      {
        blockers: ["Requires log truck and log trailer; truck is listed as chip truck."],
        fitLabel: "Not compatible",
        lane: "River Pulp",
        loadId: "load-2",
        payLabel: "$62 per ton",
        reasons: [],
        recommended: false,
        remaining: 1,
        requestable: false,
        scheduleLabel: "Jul 9",
        statusLabel: "Open",
        title: "Oak chip shuttle"
      }
    ],
    metrics: { activeAssignments: 1, criticalNotices: 1, openLoads: 4, trucksAvailable: 3 },
    notices: [{ body: "Blue River Rd washout — use the north approach.", severity: "critical", title: "Road closure" }],
    orgName: "North Pine Logging",
    reputation: { avgRating: 4.7, label: "4.7 · 12 reviews", ratedCount: 12 },
    recommendations: [
      {
        label: "Top pick",
        lane: "Oakridge to Cascade Mill",
        loadId: "load-1",
        payLabel: "$1,850 per load",
        reasons: ["Truck type fits saw logs work.", "Open capacity right now"],
        scheduleLabel: "Jul 9",
        title: "Oak saw-log morning run"
      }
    ],
    role: "driver",
    trips: [{ driverName: "Hank Reed", loadTitle: "Oak saw-log morning run", statusLabel: "Assigned" }],
    viewerName: "Hank Reed",
    ...overrides
  }
}

describe("operator assistant engine", () => {
  it("recommends top matches with reasons and load citations", () => {
    const result = answerOperatorQuestion(grounding(), "what should I haul next?")

    expect(result.intent).toBe("recommendations")
    expect(result.answer).toContain("Oak saw-log morning run")
    expect(result.answer).toContain("Top pick")
    expect(result.citations.some((c) => c.href === "/driver/loads/load-1")).toBe(true)
  })

  it("explains why a load is blocked using the compatibility failure", () => {
    const result = answerOperatorQuestion(grounding(), "why can't I request the chip shuttle?")

    expect(result.intent).toBe("blocked")
    expect(result.answer).toContain("Oak chip shuttle")
    expect(result.answer).toMatch(/log truck/)
  })

  it("summarizes active trips", () => {
    const result = answerOperatorQuestion(grounding(), "what's the status of my trips?")

    expect(result.intent).toBe("trips")
    expect(result.answer).toContain("Oak saw-log morning run")
    expect(result.answer).toContain("Assigned")
  })

  it("surfaces critical alerts first", () => {
    const result = answerOperatorQuestion(grounding(), "any alerts I should know about?")

    expect(result.intent).toBe("alerts")
    expect(result.answer).toContain("Road closure")
    expect(result.answer).toContain("Urgent")
  })

  it("gives a metrics snapshot as the default", () => {
    const result = answerOperatorQuestion(grounding(), "give me an overview")

    expect(result.intent).toBe("overview")
    expect(result.answer).toContain("4 open loads")
  })

  it("guides an unequipped driver to add a truck instead of pretending to match", () => {
    const result = answerOperatorQuestion(
      grounding({ hasTruck: false, recommendations: [], loads: [] }),
      "what should I haul?"
    )

    expect(result.answer).toMatch(/truck/i)
    expect(result.citations.some((c) => c.href === "/driver/equipment")).toBe(true)
  })

  it("never emits a numeric match score", () => {
    for (const question of ["what should I haul?", "why is this blocked?", "overview", "alerts", "my trips"]) {
      const result = answerOperatorQuestion(grounding(), question)
      expect(result.answer).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/)
    }
  })

  it("answers a reputation question from the viewer's own rating", () => {
    const result = answerOperatorQuestion(grounding(), "how's my reputation?")

    expect(result.intent).toBe("reputation")
    expect(result.answer).toContain("4.7 · 12 reviews")
    expect(result.citations.some((c) => c.href === "/driver/profile")).toBe(true)
  })

  it("routes a haul-phrased question to recommendations, not trips", () => {
    const result = answerOperatorQuestion(grounding(), "what can I haul today?")

    expect(result.intent).toBe("recommendations")
  })

  it("gives a host a sensible availability answer instead of zero-truck copy", () => {
    const hostGrounding = grounding({
      availability: [],
      metrics: { activeAssignments: 0, criticalNotices: 0, openLoads: 3, trucksAvailable: 0 },
      role: "host"
    })
    const result = answerOperatorQuestion(hostGrounding, "who's available to haul?")

    expect(result.intent).toBe("availability")
    expect(result.answer).not.toMatch(/0 trucks/)
    expect(result.answer.toLowerCase()).toContain("live board")
  })

  it("offers role-appropriate suggested prompts", () => {
    expect(suggestedPrompts(grounding())).toContain("What should I haul next?")
    expect(suggestedPrompts(grounding({ role: "host" }))).toContain("How many loads are open?")
  })

  it("routes citations to the fleet cockpit for a fleet viewer", () => {
    const result = answerOperatorQuestion(grounding({ role: "fleet" }), "best loads for my trucks")

    expect(result.citations.some((c) => c.href.startsWith("/fleet/"))).toBe(true)
  })
})
