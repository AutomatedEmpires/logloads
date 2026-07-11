import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { submitVerificationRecord } from "./verification"

const USER = "22222222-2222-4222-8222-222222222221"
const ORG = "33333333-3333-4333-8333-333333333331"

function personInput(evidence: string) {
  return {
    evidenceSummary: evidence,
    subjectId: USER,
    subjectType: "person" as const,
    submittedByUserId: USER,
    verificationType: "identity" as const
  }
}

describe("self-service verification submission", () => {
  it("creates a pending, self-reported record that lands in the admin queue", () => {
    const state = createInMemoryDatabase()
    const before = state.verificationRecords.length

    const record = submitVerificationRecord(state, personInput("CDL #A1234567, issued OR."))

    expect(record.status).toBe("pending")
    expect(record.source).toBe("self_reported")
    expect(record.reviewerUserId).toBeNull()
    expect(record.verifiedAt).toBeNull()
    expect(state.verificationRecords.length).toBe(before + 1)
  })

  it("writes an audit event for the submission", () => {
    const state = createInMemoryDatabase()

    const record = submitVerificationRecord(state, personInput("Phone 555-0100."))

    const event = state.auditEvents.find(
      (candidate) => candidate.entityId === record.id && candidate.action === "verification_submitted"
    )
    expect(event).toBeDefined()
    expect(event?.actorUserId).toBe(USER)
  })

  it("re-submission updates the same record instead of duplicating the queue", () => {
    const state = createInMemoryDatabase()

    const first = submitVerificationRecord(state, personInput("Old evidence."))
    const mineBefore = state.verificationRecords.filter(
      (r) => r.subjectType === "person" && r.subjectId === USER && r.verificationType === "identity"
    ).length

    const second = submitVerificationRecord(state, personInput("Updated license photo attached."))
    const mineAfter = state.verificationRecords.filter(
      (r) => r.subjectType === "person" && r.subjectId === USER && r.verificationType === "identity"
    ).length

    expect(second.id).toBe(first.id)
    expect(mineBefore).toBe(1)
    expect(mineAfter).toBe(1)
    expect(second.evidenceSummary).toBe("Updated license photo attached.")
    expect(second.status).toBe("pending")
    expect(second.expiresAt).toBeNull()
  })

  it("does not let a self-submission override an admin-verified record", () => {
    const state = createInMemoryDatabase()
    const record = submitVerificationRecord(state, personInput("Original evidence."))

    // Simulate an admin verifying it.
    const index = state.verificationRecords.findIndex((r) => r.id === record.id)
    state.verificationRecords[index] = {
      ...state.verificationRecords[index]!,
      reviewerUserId: USER,
      status: "verified",
      verifiedAt: "2026-07-01T00:00:00.000Z"
    }

    const result = submitVerificationRecord(state, personInput("Trying to reset it to pending."))

    expect(result.status).toBe("verified")
    expect(result.evidenceSummary).toBe("Original evidence.")
  })

  it("allows re-submission after a rejection", () => {
    const state = createInMemoryDatabase()
    const record = submitVerificationRecord(state, personInput("First try."))
    const index = state.verificationRecords.findIndex((r) => r.id === record.id)
    state.verificationRecords[index] = { ...state.verificationRecords[index]!, reviewerUserId: USER, status: "rejected" }

    const result = submitVerificationRecord(state, personInput("Better evidence this time."))

    expect(result.status).toBe("pending")
    expect(result.evidenceSummary).toBe("Better evidence this time.")
  })

  it("keeps distinct subject+type submissions as separate records", () => {
    const state = createInMemoryDatabase()

    submitVerificationRecord(state, personInput("Identity evidence."))
    submitVerificationRecord(state, {
      evidenceSummary: "MC-999999 active.",
      subjectId: ORG,
      subjectType: "organization",
      submittedByUserId: USER,
      verificationType: "carrier_identifier"
    })

    const personRecords = state.verificationRecords.filter((r) => r.subjectType === "person" && r.subjectId === USER)
    const orgRecords = state.verificationRecords.filter((r) => r.subjectType === "organization" && r.subjectId === ORG && r.verificationType === "carrier_identifier")
    expect(personRecords).toHaveLength(1)
    expect(orgRecords).toHaveLength(1)
  })

  it("rejects blank evidence", () => {
    const state = createInMemoryDatabase()

    expect(() => submitVerificationRecord(state, personInput("   "))).toThrow()
  })
})
