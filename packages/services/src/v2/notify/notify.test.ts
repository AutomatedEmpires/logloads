import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { MARKETPLACE_EMAIL_TEMPLATE_CLASSES, type MarketplaceEmailFacts, type MarketplaceEmailFooter, type MarketplaceEmailTemplate } from "@logloads/contracts"

import {
  RECONFIRM_STOP_SENTENCE,
  cleanEmailName,
  derivedUuid,
  emailClass,
  emailSubjectWordingAllowed,
  emailSuppressionHash,
  notificationIdempotencyKey,
  parseTestRecipients,
  planEmailDelivery,
  readSuppressionToken,
  runNotificationPass,
  signSuppressionToken
} from "./index"

const ADDRESS = "hauler@example.com"
const KEY = "test-suppression-key-0123456789abcdef"
const OTHER_KEY = "other-suppression-key-0123456789abcdef"
const FOOTER: MarketplaceEmailFooter = {
  legalName: "LogLoads",
  postalAddress: "Test mailbox 100",
  reason: "You saved a search for jobs like this one.",
  unsubscribeUrl: "https://logloads.com/api/v2/notify/unsubscribe?token=abc"
}
const INQUIRY_URL = "https://logloads.com/v2/landing/inquiries?inquiry=22222222-cccc-4ccc-8ccc-cccccccccccc#conversation"
const READY = [
  { label: "Yes, we can use you.", url: "https://logloads.com/v2/act/token-one" },
  { label: "Yes. When can you start?", url: "https://logloads.com/v2/act/token-two" }
]

function facts(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}): MarketplaceEmailFacts {
  return {
    attempt: 1,
    footer: template === "job_alert" || template === "targeted_invitation" ? FOOTER : {
      ...FOOTER,
      reason: "You were invited to a business."
    },
    invitationSendCount: template === "team_invitation" ? 1 : null,
    landingName: template === "targeted_invitation" ? "Pine Landing" : null,
    organizationName: template === "team_invitation" ? "Cedar Contractors" : template === "inquiry_received" ? "New River Hauling" : null,
    promotion: null,
    template,
    ...(template === "inquiry_received" ? { inquiryUrl: INQUIRY_URL, jobTitle: "Fir sawlogs to Bend", readyReplies: READY } : {}),
    ...extra
  }
}

function plan(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}, options: { allow?: string[]; suppressed?: string[]; key?: string } = {}) {
  return planEmailDelivery({
    address: ADDRESS,
    allowlist: options.allow ?? [ADDRESS],
    facts: facts(template, extra),
    suppression: { hashes: options.suppressed ?? [], key: options.key ?? KEY }
  })
}

function sent(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}) {
  const planned = plan(template, extra)

  if (planned.action !== "send") throw new Error(`expected ${template} to send, got ${planned.reason}`)

  return planned.message
}

function blocked(template: MarketplaceEmailTemplate, extra: Partial<MarketplaceEmailFacts> = {}, options: { allow?: string[]; suppressed?: string[]; key?: string } = {}) {
  const planned = plan(template, extra, options)

  if (planned.action !== "suppress") throw new Error(`expected a suppressed ${template}`)

  return planned.reason
}

describe("email class", () => {
  it("treats job alerts and targeted invitations as commercial, and the others as transactional", () => {
    expect(emailClass("job_alert")).toBe("commercial")
    expect(emailClass("targeted_invitation")).toBe("commercial")
    expect(emailClass("inquiry_reply")).toBe("transactional")
    expect(emailClass("inquiry_received")).toBe("transactional")
    expect(emailClass("team_invitation")).toBe("transactional")
    expect(emailClass("reconfirm_reminder")).toBe("transactional")
    expect(MARKETPLACE_EMAIL_TEMPLATE_CLASSES.reconfirm_reminder).toBe("transactional")
  })
})

describe("planEmailDelivery", () => {
  it("sends a commercial job alert only with the footer, and only to a test recipient", () => {
    const message = sent("job_alert")

    expect(message.subject).toBe("A job matches a search you saved")
    expect(message.text).toContain("LogLoads")
    expect(message.text).toContain("Test mailbox 100")
    expect(message.text).toContain("You saved a search for jobs like this one.")
    expect(message.text).toContain(FOOTER.unsubscribeUrl)
    expect(message.listUnsubscribe).toBe(`<${FOOTER.unsubscribeUrl}>`)
    expect(message.listUnsubscribePost).toBe("List-Unsubscribe=One-Click")
    expect(message.subject).not.toMatch(/^\s*re\s*:/i)
    expect(message.text).not.toMatch(/\b(?:urgent|hurry|act now)\b/i)

    expect(blocked("job_alert", { footer: null })).toBe("commercial-footer")
    expect(blocked("job_alert", { footer: { ...FOOTER, postalAddress: "LogLoads" } })).toBe("commercial-footer")
    expect(blocked("job_alert", {}, { allow: [] })).toBe("test-recipient")
    expect(blocked("job_alert", {}, { allow: ["other@example.com"] })).toBe("test-recipient")
  })

  it("matches the allowlist without regard to case, and checks the keyed hash of a suppressed address", () => {
    expect(parseTestRecipients(" Hauler@Example.com, , not-an-email ")).toEqual(["hauler@example.com"])
    expect(plan("inquiry_reply", {}, { allow: ["Hauler@Example.com"] }).action).toBe("send")
    expect(blocked("inquiry_reply", {}, { suppressed: [emailSuppressionHash("Hauler@Example.com", KEY)] })).toBe("suppressed")
    // A hash made with another key does not match: the list is keyed, so it cannot be matched against a plain address list.
    expect(plan("inquiry_reply", {}, { suppressed: [emailSuppressionHash(ADDRESS, OTHER_KEY)] }).action).toBe("send")
    expect(plan("inquiry_reply", {}, { allow: [ADDRESS] }).action).toBe("send")
    const malformed = planEmailDelivery({
      address: "not an address",
      allowlist: ["not an address"],
      facts: facts("inquiry_reply"),
      suppression: { hashes: [], key: KEY }
    })

    expect(malformed.action === "suppress" && malformed.reason).toBe("address")
  })

  it("sends nothing when the suppression list cannot be checked", () => {
    expect(blocked("inquiry_reply", {}, { key: "" })).toBe("suppression-key")
    expect(blocked("inquiry_reply", {}, { key: "too-short" })).toBe("suppression-key")
  })

  it("names LogLoads as the sender of a targeted invitation and stops every invitation on opt-out", () => {
    const message = sent("targeted_invitation")

    expect(message.text).toContain("LogLoads is sending this.")
    expect(message.text).toContain("Pine Landing")
    expect(message.text).toContain("Unsubscribing stops every invitation, not only this one.")
    expect(message.subject).toBe("Pine Landing has a job on LogLoads")
  })

  it("caps reminders for one team invitation and keeps a do-not-email link on the first send", () => {
    const message = sent("team_invitation")

    expect(message.text).toContain("do not want email about it again")
    expect(message.subject).toBe("Cedar Contractors invited you on LogLoads")
    expect(plan("team_invitation", { invitationSendCount: 5 }).action).toBe("send")
    expect(blocked("team_invitation", { invitationSendCount: 6 })).toBe("invitation-cap")
    expect(blocked("team_invitation", { invitationSendCount: null })).toBe("invitation-cap")
    expect(blocked("team_invitation", { footer: { ...FOOTER, unsubscribeUrl: "" } })).toBe("unsubscribe")
  })

  it("keeps a reconfirm reminder free of promotion and says what happens when reminders stop", () => {
    const message = sent("reconfirm_reminder", { footer: { ...FOOTER, postalAddress: "", legalName: "", reason: "" } })

    expect(message.text).toContain(RECONFIRM_STOP_SENTENCE)
    expect(message.text).toContain("14 days")
    expect(blocked("reconfirm_reminder", { promotion: "a boost" })).toBe("promotion")
  })

  it("does not send a subject that pretends to be a reply", () => {
    expect(blocked("team_invitation", { organizationName: "Re: Cedar" })).toBe("subject")
  })

  it("applies the urgency rule to the fixed wording, not to a business name", () => {
    expect(sent("team_invitation", { organizationName: "Hurry Creek Logging" }).subject).toBe("Hurry Creek Logging invited you on LogLoads")
    expect(sent("team_invitation", { organizationName: "Urgent Cedar" }).subject).toBe("Urgent Cedar invited you on LogLoads")
    expect(sent("targeted_invitation", { landingName: "Last Chance Landing" }).subject).toBe("Last Chance Landing has a job on LogLoads")
    expect(emailSubjectWordingAllowed("{name} invited you on LogLoads")).toBe(true)
    expect(emailSubjectWordingAllowed("Hurry: {name} invited you")).toBe(false)
    expect(emailSubjectWordingAllowed("Act now, {name} has a job")).toBe(false)
    expect(emailSubjectWordingAllowed("Re: {name} has a job")).toBe(false)
  })

  it("strips CR, LF and other control characters from names before they reach the subject", () => {
    const subject = sent("team_invitation", { organizationName: "Cedar\r\nContractors\u2028Inc\t" }).subject

    expect(subject).toBe("Cedar Contractors Inc invited you on LogLoads")
    expect(subject).not.toMatch(/[\r\n\t\u2028\u2029]/)
    expect(sent("targeted_invitation", { landingName: "Pine\nLanding" }).subject).toBe("Pine Landing has a job on LogLoads")
    expect(cleanEmailName("  \r\n ")).toBeNull()
    expect(cleanEmailName("A".repeat(200))).toHaveLength(80)
  })

  it("never puts a phone number, an email address or a web link in a subject or a body", () => {
    expect(cleanEmailName("Joe Trucking 541-555-0101")).toBeNull()
    expect(cleanEmailName("joe@example.com")).toBeNull()
    expect(cleanEmailName("www.example.com")).toBeNull()
    expect(sent("team_invitation", { organizationName: "Cedar (541) 555 0101" }).subject).toBe("You are invited to a business on LogLoads")

    const message = sent("inquiry_received", { jobTitle: "Call 541 555 0101 today", organizationName: "Joe 5415550101" })

    expect(message.subject).toBe("A hauler sent interest in your job on LogLoads")
    expect(message.text).not.toMatch(/541/)
  })
})

describe("the landing's new-inquiry email (flow C)", () => {
  it("names the hauling business and carries the one-tap replies and the inquiry link", () => {
    const message = sent("inquiry_received")

    expect(message.subject).toBe("New River Hauling sent interest in your job on LogLoads")
    expect(message.text).toContain("New River Hauling sent interest in your job: Fir sawlogs to Bend.")
    expect(message.text).toContain("Yes, we can use you.\nhttps://logloads.com/v2/act/token-one")
    expect(message.text).toContain("Yes. When can you start?\nhttps://logloads.com/v2/act/token-two")
    expect(message.text).toContain(`Open the inquiry:\n${INQUIRY_URL}`)
    expect(message.text.trim().endsWith(FOOTER.unsubscribeUrl)).toBe(true)
    // Transactional: no legal footer is needed, and none is printed.
    expect(message.text).not.toContain("Test mailbox 100")
  })

  it("is not sent without an https link to the inquiry, and drops a ready reply that is not https", () => {
    expect(blocked("inquiry_received", { inquiryUrl: null })).toBe("links")
    expect(blocked("inquiry_received", { inquiryUrl: "http://logloads.com/v2/landing/inquiries" })).toBe("links")
    expect(blocked("inquiry_received", { inquiryUrl: `${INQUIRY_URL}\nBcc: x` })).toBe("links")

    const message = sent("inquiry_received", { readyReplies: [{ label: "Yes, we can use you.", url: "http://logloads.com/v2/act/x" }] })

    expect(message.text).not.toContain("http://logloads.com/v2/act/x")
    expect(message.text).not.toContain("Reply with one tap")
    expect(message.text).toContain(INQUIRY_URL)
  })

  it("leaves out a job title that carries a contact detail, and works with no names at all", () => {
    const message = sent("inquiry_received", { jobTitle: null, organizationName: null })

    expect(message.subject).toBe("A hauler sent interest in your job on LogLoads")
    expect(message.text).toContain("A hauling business sent interest in your job.")
  })

  it("adds the inquiry link to a reply notice when one is given", () => {
    expect(sent("inquiry_reply", { inquiryUrl: INQUIRY_URL }).text).toContain(`Open the inquiry:\n${INQUIRY_URL}`)
    expect(sent("inquiry_reply").text).not.toContain("Open the inquiry")
  })
})

describe("suppression hash and token", () => {
  const now = new Date("2026-11-17T18:00:00.000Z")

  it("hashes the lower-cased address with a dedicated key, never as a plain digest", () => {
    const hash = emailSuppressionHash(" Hauler@Example.com ", KEY)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(emailSuppressionHash(ADDRESS, KEY))
    expect(hash).not.toBe(emailSuppressionHash(ADDRESS, OTHER_KEY))
    expect(hash).not.toBe(createHash("sha256").update(ADDRESS).digest("hex"))
    expect(() => emailSuppressionHash(ADDRESS, "short")).toThrow()
    expect(() => emailSuppressionHash(ADDRESS, ` ${KEY}`)).toThrow()
  })

  it("names the keyed hash only, and a tampered, expired or foreign-key token does not", () => {
    const token = signSuppressionToken(ADDRESS, KEY, new Date(now.getTime() + 86_400_000), now)

    const mac = token.split(".")[1] ?? ""
    const flipped = `${token.slice(0, token.length - mac.length)}${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`
    const payload = Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")

    expect(token).not.toContain(ADDRESS)
    expect(payload).not.toContain(createHash("sha256").update(ADDRESS).digest("hex"))
    expect(readSuppressionToken(token, KEY, now)).toBe(emailSuppressionHash(ADDRESS, KEY))
    expect(readSuppressionToken(token, OTHER_KEY, now)).toBeNull()
    expect(readSuppressionToken(flipped, KEY, now)).toBeNull()
    expect(readSuppressionToken(token, KEY, new Date(now.getTime() + 2 * 86_400_000))).toBeNull()
    expect(() => signSuppressionToken(ADDRESS, "short", new Date(now.getTime() + 86_400_000), now)).toThrow()
  })

  it("signs the same token for the same address, key and expiry, so a re-sent email has the same body", () => {
    const expires = new Date(now.getTime() + 31 * 86_400_000)

    expect(signSuppressionToken(ADDRESS, KEY, expires, now)).toBe(signSuppressionToken(ADDRESS, KEY, expires, new Date(now.getTime() + 60_000)))
  })
})

describe("stable ids for one notice", () => {
  it("keys every send of one notice the same way, and derives the same uuid for the same label", () => {
    expect(notificationIdempotencyKey("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("logloads-notice/11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(() => notificationIdempotencyKey("not-a-uuid")).toThrow()

    const one = derivedUuid(KEY, "notice:1:reply")

    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(derivedUuid(KEY, "notice:1:reply")).toBe(one)
    expect(derivedUuid(KEY, "notice:2:reply")).not.toBe(one)
    expect(derivedUuid(OTHER_KEY, "notice:1:reply")).not.toBe(one)
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
