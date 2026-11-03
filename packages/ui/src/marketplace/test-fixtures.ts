/**
 * Test-only view models for the marketplace components. Neutral placeholder names; none of the design
 * reference's fictional businesses or verification strings (07_ADOPTION_REVIEW.md Gate 5).
 */
import type { MarketplaceInterestView, MarketplaceJobCardView, MarketplaceJobDetailView } from "@logloads/contracts"

export const NOW = "2026-11-02T15:00:00.000Z"

export function jobCard(overrides: Partial<MarketplaceJobCardView> = {}): MarketplaceJobCardView {
  return {
    acceptingInterest: true,
    destinationLabel: "Example mill · Riverton, OR",
    endsOn: "2026-11-30",
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: 28,
    expiresAt: null,
    haulDistance: { basis: "poster_route_estimate", miles: 54 },
    id: "11111111-1111-4111-8111-111111111111",
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: "22222222-aaaa-4aaa-8aaa-222222222222",
    posterVerification: null,
    product: "Saw logs",
    scheduleNote: null,
    slug: "example-saw-logs",
    sponsored: false,
    startsOn: "2026-11-10",
    status: "active",
    title: "Saw logs to the river mill",
    trucks: { perDay: 3, total: 6 },
    ...overrides
  }
}

export function jobDetail(overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  return {
    ...jobCard(),
    publicAccessRequirements: [],
    publicRoadNotes: "Gravel for the last 6 miles",
    ...overrides
  }
}

export function interestView(overrides: Partial<MarketplaceInterestView> = {}): MarketplaceInterestView {
  return {
    availableFrom: "2026-11-10",
    availableUntil: null,
    contactPreference: "in_app",
    createdAt: "2026-11-01T12:00:00.000Z",
    equipment: [{ configurationKey: "log-pole", count: 2, label: "Log truck + Pole trailer" }],
    haulerOrganization: { id: "33333333-bbbb-4bbb-8bbb-333333333333", name: "Example Hauling LLC", type: "hauler" },
    id: "44444444-cccc-4ccc-8ccc-444444444444",
    job: { acceptingInterest: true, id: "11111111-1111-4111-8111-111111111111", slug: "example-saw-logs", status: "active", title: "Saw logs to the river mill" },
    landingOrganization: { id: "22222222-aaaa-4aaa-8aaa-222222222222", name: "Example Timber Co" },
    message: "Two trucks ready from the 10th.",
    replies: [],
    status: "submitted",
    submittedBy: { name: "Sam Hauler", userId: "55555555-dddd-4ddd-8ddd-555555555555" },
    trucksOffered: 2,
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides
  }
}
