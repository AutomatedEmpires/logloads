import { describe, expect, it, vi } from "vitest"

import { MARKETPLACE_EMAIL_TEMPLATE_CLASSES, type MarketplaceEmailFacts, type MarketplaceEmailFooter, type MarketplaceEmailTemplate } from "@logloads/contracts"

import {
  RECONFIRM_STOP_SENTENCE,
  emailClass,
  emailSuppressionHash,
  parseTestRecipients,
  planEmailDelivery,
  readSuppressionToken,
  runNotificationPass,
  signSuppressionToken
} from "./index"

const ADDRESS = "hauler@example.com"
const FOOTER: MarketplaceEmailFooter = {
  legalName: "LogLoads",
  postalAddress: "Test mailbox 100",
  reason: "You saved a search for jobs like this one.",
  unsubscribeUrl: "https://logloads.com/api/v2/notify/unsubscribe?token=abc"
}

function facts(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}): MarketplaceEmailFacts {
  return {
    attempt: 1,
    footer: template === "job_alert" || template === "targeted_invitation" ? FOOTER : {
      ...FOOTER,
      reason: "You were invited to a business."
    },
    invitationSendCount: template === "team_invitation" ? 1 : null,
    landingName: template === "targeted_invitation" ? "Pine Landing" : null,
    organizationName: template === "team_invitation" ? "Cedar Contractors" : null,
    promotion: null,
    template,
    ...extra
  }
}

function plan(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}, options: { allow?: string[]; suppressed?: string[] } = {}) {
  return planEmailDelivery({
    address: ADDRESS,
    allowlist: options.allow ?? [ADDRESS],
    facts: facts(template, extra),
    suppressedHashes: options.suppressed ?? []
  })
}

function blocked(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}, options: { allow?: string[]; suppressed?: string[] } = {}) {
  const planned = plan(template, extra, options)

  if (planned.action !== "suppress") throw new Error(`expected a suppressed ${template}`)

  return planned.reason
}

describe("email class", () => {
  it("treats job alerts and targeted invitations as commercial, and the others as transactional", () => {
    expect(emailClass("job_alert")).toBe("commercial")
    expect(emailClass("targeted_invitation")).toBe("commercial")
    expect(emailClass("inquiry_reply")).toBe("transactional")
    expect(emailClass("team_invitation")).toBe("transactional")
    expect(emailClass("reconfirm_reminder")).toBe("transactional")
    expect(MARKETPLACE_EMAIL_TEMPLATE_CLASSES.reconfirm_reminder).toBe("transactional")
  })
})

describe("planEmailDelivery", () => {
  it("sends a commercial job alert only with the footer, and only to a test recipient", () => {
    const sent = plan("job_alert")

    expect(sent.action).toBe("send")
    if (sent.action !== "send") return
    expect(sent.message.subject).toBe("A job matches a search you saved")
    expect(sent.message.text).toContain("LogLoads")
    expect(sent.message.text).toContain("Test mailbox 100")
    expect(sent.message.text).toContain("You saved a search for jobs like this one.")
    expect(sent.message.text).toContain(FOOTER.unsubscribeUrl)
    expect(sent.message.listUnsubscribe).toBe(`<${FOOTER.unsubscribeUrl}>`)
    expect(sent.message.listUnsubscribePost).toBe("List-Unsubscribe=One-Click")
    expect(sent.message.subject).not.toMatch(/^\s*re\s*:/i)
    expect(sent.message.text).not.toMatch(/\b(?:urgent|hurry|act now)\b/i)

    expect(blocked("job_alert", { footer: null })).toBe("commercial-footer")
    expect(blocked("job_alert", { footer: { ...FOOTER, postalAddress: "LogLoads" } })).toBe("commercial-footer")
    expect(blocked("job_alert", {}, { allow: [] })).toBe("test-recipient")
    expect(blocked("job_alert", {}, { allow: ["other@example.com"] })).toBe("test-recipient")
  })

  it("matches the allowlist without regard to case, and hashes a suppressed address before comparing", () => {
    expect(parseTestRecipients(" Hauler@Example.com, , not-an-email ")).toEqual(["hauler@example.com"])
    expect(plan("inquiry_reply", {}, { allow: ["Hauler@Example.com"] }).action).toBe("send")
    expect(blocked("inquiry_reply", {}, { suppressed: [emailSuppressionHash("Hauler@Example.com")] })).toBe("suppressed")
    expect(emailSuppressionHash(ADDRESS)).toHaveLength(64)
    expect(plan("inquiry_reply", {}, { allow: [ADDRESS] }).action).toBe("send")
    const malformed = planEmailDelivery({
      address: "not an address",
      allowlist: ["not an address"],
      facts: facts("inquiry_reply"),
      suppressedHashes: []
    })

    expect(malformed.action === "suppress" && malformed.reason).toBe("address")
  })

  it("names LogLoads as the sender of a targeted invitation and stops every invitation on opt-out", () => {
    const sent = plan("targeted_invitation")

    expect(sent.action).toBe("send")
    if (sent.action !== "send") return
    expect(sent.message.text).toContain("LogLoads is sending this.")
    expect(sent.message.text).toContain("Pine Landing")
    expect(sent.message.text).toContain("Unsubscribing stops every invitation, not only this one.")
    expect(sent.message.subject).toBe("Pine Landing has a job on LogLoads")
  })

  it("caps reminders for one team invitation and keeps a do-not-email link on the first send", () => {
    const sent = plan("team_invitation")

    expect(sent.action).toBe("send")
    if (sent.action !== "send") return
    expect(sent.message.text).toContain("do not want email about it again")
    expect(sent.message.subject).toBe("Cedar Contractors invited you on LogLoads")
    expect(plan("team_invitation", { invitationSendCount: 5 }).action).toBe("send")
    expect(blocked("team_invitation", { invitationSendCount: 6 })).toBe("invitation-cap")
    expect(blocked("team_invitation", { invitationSendCount: null })).toBe("invitation-cap")
    expect(blocked("team_invitation", { footer: { ...FOOTER, unsubscribeUrl: "" } })).toBe("unsubscribe")
  })

  it("keeps a reconfirm reminder free of promotion and says what happens when reminders stop", () => {
    const sent = plan("reconfirm_reminder", { footer: { ...FOOTER, postalAddress: "", legalName: "", reason: "" } })

    expect(sent.action).toBe("send")
    if (sent.action !== "send") return
    expect(sent.message.text).toContain(RECONFIRM_STOP_SENTENCE)
    expect(sent.message.text).toContain("14 days")
    expect(blocked("reconfirm_reminder", { promotion: "a boost" })).toBe("promotion")
  })

  it("does not send a subject that pretends to be a reply or a deadline", () => {
    expect(blocked("team_invitation", { organizationName: "Re: Cedar" })).toBe("subject")
    expect(blocked("team_invitation", { organizationName: "Urgent Cedar" })).toBe("subject")
  })
})

describe("suppression token", () => {
  const secret = "test-suppression-secret"
  const now = new Date("2026-11-17T18:00:00.000Z")

  it("names the hash only, and a tampered or expired token does not", () => {
    const token = signSuppressionToken(ADDRESS, secret, new Date(now.getTime() + 86_400_000), now)

    const mac = token.split(".")[1] ?? ""
    const flipped = `${token.slice(0, token.length - mac.length)}${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`

    expect(token).not.toContain(ADDRESS)
    expect(readSuppressionToken(token, secret, now)).toBe(emailSuppressionHash(ADDRESS))
    expect(readSuppressionToken(flipped, secret, now)).toBeNull()
    expect(readSuppressionToken(token, secret, new Date(now.getTime() + 2 * 86_400_000))).toBeNull()
  })
})

describe("runNotificationPass", () => {
  it("delivers email and skips the truck matcher while that category is unsupported", async () => {
    const deliver = vi.fn(async () => undefined)
    const matchTruckAlerts = vi.fn(async () => undefined)

    await runNotificationPass({ deliver, matchTruckAlerts, truckAlertsSupported: false })

    expect(deliver).toHaveBeenCalledOnce()
    expect(matchTruckAlerts).not.toHaveBeenCalled()

    await runNotificationPass({ deliver, matchTruckAlerts, truckAlertsSupported: true })

    expect(matchTruckAlerts).toHaveBeenCalledOnce()
  })
})
