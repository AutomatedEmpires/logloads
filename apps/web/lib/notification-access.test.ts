import { describe, expect, it } from "vitest"

import { notificationVisibleToActor } from "./notification-access"

const ADMIN_PROFILE_ID = "11111111-1111-4111-8111-111111111111"

describe("notification visibility", () => {
  it("revokes contact-inquiry PII when persistent platform authority is removed", () => {
    const inquiry = {
      relatedEntityType: "contact_inquiry",
      userId: ADMIN_PROFILE_ID
    }

    expect(
      notificationVisibleToActor(inquiry, {
        isPlatformAdmin: true,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(true)
    expect(
      notificationVisibleToActor(inquiry, {
        isPlatformAdmin: false,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(false)
  })

  it("keeps ordinary personal notifications visible only to their recipient", () => {
    const notification = {
      relatedEntityType: "assignment",
      userId: ADMIN_PROFILE_ID
    }

    expect(
      notificationVisibleToActor(notification, {
        isPlatformAdmin: false,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(true)
    expect(
      notificationVisibleToActor(notification, {
        isPlatformAdmin: true,
        profileId: "99999999-9999-4999-8999-999999999999"
      })
    ).toBe(false)
  })

  it("requires current field authority before serializing an operational notice", () => {
    const notification = {
      relatedEntityType: "operational_notice",
      userId: ADMIN_PROFILE_ID
    }

    expect(
      notificationVisibleToActor(notification, {
        isPlatformAdmin: false,
        operationalNoticeAuthorized: true,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(true)
    expect(
      notificationVisibleToActor(notification, {
        isPlatformAdmin: false,
        operationalNoticeAuthorized: false,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(false)
    expect(
      notificationVisibleToActor(notification, {
        isPlatformAdmin: false,
        profileId: ADMIN_PROFILE_ID
      })
    ).toBe(false)
  })
})
