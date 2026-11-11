import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { MarketplaceNotificationPreferenceView } from "@logloads/contracts"

import {
  ALERT_UNSUBSCRIBE_PURPOSE,
  ALERT_UNSUBSCRIBE_TTL_SECONDS,
  alertUnsubscribeExpiry,
  applyAlertUnsubscribe,
  jobAlertChannels,
  notificationPreferenceList,
  planJobSearchWrite,
  planPreferenceWrite,
  planSavedJobWrite,
  readAlertUnsubscribeToken,
  savedJobSaveChanges,
  signAlertUnsubscribeToken,
  type AlertUnsubscribeTarget
} from "./index"

const EMAIL = "hauler@example.com"
const SECRET = "test-unsubscribe-secret"
const USER = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const OTHER_USER = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER_ORG = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const NOW = new Date("2026-11-10T12:00:00.000Z")

const target: AlertUnsubscribeTarget = { category: "job_alert", channel: "email", organizationId: ORG, userId: USER }

function preference(overrides: Partial<MarketplaceNotificationPreferenceView> = {}): MarketplaceNotificationPreferenceView {
  return { category: "job_alert", channel: "email", enabled: true, updatedAt: "2026-11-01T00:00:00.000Z", ...overrides }
}

function signed(expiresAt = alertUnsubscribeExpiry(NOW)): string {
  return signAlertUnsubscribeToken(target, SECRET, expiresAt, NOW)
}

describe("saved jobs and job searches stay with the signed-in business", () => {
  it("treats saving a job that is already saved as a change of nothing", () => {
    expect(savedJobSaveChanges(false)).toBe(true)
    expect(savedJobSaveChanges(true)).toBe(false)
  })

  it("binds a save to the caller's business and never to a job id's owner", () => {
    expect(planSavedJobWrite(ORG, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa").organizationId).toBe(ORG)
    expect(planSavedJobWrite(OTHER_ORG, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa").organizationId).toBe(OTHER_ORG)
  })

  it("saves a job search only as kind jobs for the caller's business", () => {
    const planned = planJobSearchWrite(ORG, {
      alertsEnabled: true,
      criteria: { equipment: ["log_truck"], place: "Sweet Home", radiusMiles: 50, stateCode: "OR" },
      name: "Fir",
      searchId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })

    expect(planned).toMatchObject({ kind: "jobs", organizationId: ORG, searchId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    expect(planJobSearchWrite(OTHER_ORG, { alertsEnabled: false, criteria: planned.criteria, name: "Fir" }).organizationId).toBe(OTHER_ORG)
    expect(JSON.stringify(planned)).not.toContain(EMAIL)
  })
})

describe("notification preferences", () => {
  it("lists every category and channel, with ones the person never set left off", () => {
    const listed = notificationPreferenceList([preference({ updatedAt: "2026-11-02T00:00:00.000Z" })])

    expect(listed.map((row) => `${row.category}:${row.channel}:${row.enabled}`)).toEqual([
      "inquiry_reply:in_app:false",
      "inquiry_reply:email:false",
      "targeted_invitation:in_app:false",
      "targeted_invitation:email:false",
      "job_alert:in_app:false",
      "job_alert:email:true"
    ])
    expect(listed.find((row) => row.category === "job_alert" && row.channel === "email")?.updatedAt).toBe("2026-11-02T00:00:00.000Z")
    expect(listed.find((row) => row.category === "inquiry_reply")?.updatedAt).toBeNull()
    expect(listed).toHaveLength(6)
  })

  it("writes the caller's business, ignoring any other business on the input", () => {
    expect(planPreferenceWrite(ORG, { category: "inquiry_reply", channel: "in_app", enabled: true })).toEqual({
      category: "inquiry_reply",
      channel: "in_app",
      enabled: true,
      organizationId: ORG
    })
    expect(planPreferenceWrite(OTHER_ORG, { category: "job_alert", channel: "email", enabled: false }).organizationId).toBe(OTHER_ORG)
  })

  it("sends a job alert only on a channel the person turned on, and only while the search asks for alerts", () => {
    const both = [preference(), preference({ channel: "in_app" })]

    expect(jobAlertChannels({ alertsEnabled: true }, both)).toEqual({ email: true, inApp: true })
    expect(jobAlertChannels({ alertsEnabled: false }, both)).toEqual({ email: false, inApp: false })
    expect(jobAlertChannels({ alertsEnabled: true }, [preference({ channel: "in_app", enabled: false })])).toEqual({ email: false, inApp: false })
    expect(jobAlertChannels({ alertsEnabled: true }, [preference({ category: "targeted_invitation" })])).toEqual({ email: false, inApp: false })
    expect(jobAlertChannels({ alertsEnabled: true }, [])).toEqual({ email: false, inApp: false })
  })
})

describe("unsubscribe tokens", () => {
  it("signs a link with no email in it, and reads it back only for the same secret", () => {
    const token = signed()
    const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>

    expect(token).not.toContain("@")
    expect(token).not.toContain(EMAIL)
    expect(payload).not.toHaveProperty("email")
    expect(readAlertUnsubscribeToken(token, SECRET, NOW)).toEqual({ ok: true, target })
    expect(readAlertUnsubscribeToken(token, "another-unsubscribe-secret", NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(ALERT_UNSUBSCRIBE_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it("rejects a tampered token, including one that was resigned to carry an email", () => {
    const token = signed()
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`
    const past = Buffer.from(JSON.stringify({ c: "job_alert", e: 1, h: "email", o: ORG, u: USER, v: 1 }))
    const pastToken = `${past.toString("base64url")}.${createHmac("sha256", SECRET).update(ALERT_UNSUBSCRIBE_PURPOSE).update(past).digest("base64url")}`
    const flippedExpired = `${pastToken.slice(0, -1)}${pastToken.endsWith("a") ? "b" : "a"}`
    const body = Buffer.from(JSON.stringify({ c: "job_alert", e: 2_000_000_000, email: EMAIL, h: "email", o: ORG, u: USER, v: 1 }))
    const planted = `${body.toString("base64url")}.${createHmac("sha256", SECRET).update(ALERT_UNSUBSCRIBE_PURPOSE).update(body).digest("base64url")}`

    expect(readAlertUnsubscribeToken(tampered, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readAlertUnsubscribeToken(pastToken, SECRET, NOW)).toEqual({ ok: false, reason: "expired" })
    expect(readAlertUnsubscribeToken(flippedExpired, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readAlertUnsubscribeToken(planted, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readAlertUnsubscribeToken("not-a-token", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(readAlertUnsubscribeToken("", SECRET, NOW)).toEqual({ ok: false, reason: "invalid" })
  })

  it("rejects an expired token without treating it as a tamper", () => {
    const token = signed(new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000))
    const later = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000)

    expect(readAlertUnsubscribeToken(token, SECRET, new Date(NOW.getTime() + 24 * 60 * 60 * 1000))).toEqual({ ok: true, target })
    expect(readAlertUnsubscribeToken(token, SECRET, later)).toEqual({ ok: false, reason: "expired" })
  })

  it("applies a valid token without a signed-in viewer, and applies nothing when the token is bad", async () => {
    const disable = vi.fn()
    const ok = await applyAlertUnsubscribe(signed(), SECRET, NOW, disable)
    const tampered = await applyAlertUnsubscribe(`${signed().slice(0, -1)}x`, SECRET, NOW, disable)
    const expired = await applyAlertUnsubscribe(signed(new Date(NOW.getTime() + 1000)), SECRET, new Date(NOW.getTime() + 86_400_000), disable)

    expect(ok).toEqual({ outcome: "unsubscribed" })
    expect(Object.keys(ok)).toEqual(["outcome"])
    expect(JSON.stringify(ok)).not.toContain(EMAIL)
    expect(JSON.stringify(ok)).not.toContain(USER)
    expect(JSON.stringify(ok)).not.toContain(ORG)
    expect(disable).toHaveBeenCalledTimes(1)
    expect(disable).toHaveBeenCalledWith(target)
    expect(tampered).toEqual({ outcome: "invalid" })
    expect(expired).toEqual({ outcome: "expired" })
    expect(disable).toHaveBeenCalledTimes(1)
  })

  it("does not echo an email, a secret, or which person failed when the store write fails", async () => {
    const token = signAlertUnsubscribeToken(
      { ...target, organizationId: OTHER_ORG, userId: OTHER_USER },
      SECRET,
      alertUnsubscribeExpiry(NOW),
      NOW
    )

    const failure = applyAlertUnsubscribe(token, SECRET, NOW, () => {
      throw new Error(`mailbox ${EMAIL} for ${OTHER_USER} rejected ${SECRET}`)
    })

    await expect(failure).rejects.toThrow("The unsubscribe could not be completed. Try again in a moment.")
    await expect(failure).rejects.not.toThrow(EMAIL)
    await expect(failure).rejects.not.toThrow(SECRET)
    await expect(failure).rejects.not.toThrow(OTHER_USER)

    expect(() => signAlertUnsubscribeToken(target, "   ", alertUnsubscribeExpiry(NOW), NOW)).toThrow(
      "Unsubscribe links are not available right now."
    )
  })
})
