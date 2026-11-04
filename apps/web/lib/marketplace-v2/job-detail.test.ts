import { describe, expect, it } from "vitest"

import type { MarketplaceJobCardView } from "@logloads/contracts"

import { interestBarOffer, jobPagePath, jobShareUrl, similarJobs } from "./job-detail"

const JOB_ID = "11111111-1111-4111-8111-111111111111"

function card(overrides: Partial<MarketplaceJobCardView> = {}): MarketplaceJobCardView {
  return {
    acceptingInterest: true,
    destinationLabel: null,
    endsOn: null,
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    id: "21212121-2121-4121-8121-212121212121",
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: "77777777-7777-4777-8777-777777777777",
    posterVerification: null,
    product: "Saw logs",
    scheduleNote: null,
    slug: "21212121-2121-4121-8121-212121212121",
    sponsored: false,
    startsOn: null,
    status: "active",
    title: "Another job",
    trucks: { perDay: null, total: 2 },
    ...overrides
  }
}

describe("the share link (spec §10.6)", () => {
  it("is the public origin and the job's path, with nothing from the request", () => {
    expect(jobShareUrl({ slug: JOB_ID }, "https://logloads.example")).toBe(`https://logloads.example/v2/work/${JOB_ID}`)
    expect(jobShareUrl({ slug: JOB_ID }, "https://logloads.example/some/path?sent=1#interest")).toBe(`https://logloads.example/v2/work/${JOB_ID}`)
  })

  it("encodes the slug, so a slug can never add a query or a path", () => {
    expect(jobPagePath({ slug: "a/b?sent=1#x" })).toBe("/v2/work/a%2Fb%3Fsent%3D1%23x")
  })
})

describe("similar open jobs (spec §5.3)", () => {
  const stopped = { equipment: ["log_truck", "pole_trailer"], id: JOB_ID, origin: card().origin, product: "Saw logs" }

  it("offers only other jobs that accept interest, same product first, then shared equipment, then nearest", () => {
    const far = card({ id: "33333333-3333-4333-8333-333333333333", origin: { approximatePoint: { lat: 46.1, lng: -122.4 }, label: "Far, WA", stateCode: "WA" }, slug: "far", title: "Far saw logs" })
    const near = card({ id: "44444444-4444-4444-8444-444444444444", slug: "near", title: "Near saw logs" })
    const pulp = card({ id: "55555555-5555-4555-8555-555555555555", product: "Pulpwood", slug: "pulp", title: "Pulp, same trucks" })
    const both = card({ equipment: ["log_truck", "pole_trailer"], id: "66666666-6666-4666-8666-666666666666", origin: far.origin, slug: "both", title: "Saw logs, same trucks" })
    const closed = card({ acceptingInterest: false, id: "88888888-8888-4888-8888-888888888888", status: "closed", title: "Closed" })
    const itself = card({ id: JOB_ID, title: "Itself" })

    expect(similarJobs(stopped, [far, near, pulp, both, closed, itself], 5).map((job) => job.title)).toEqual([
      "Saw logs, same trucks",
      "Near saw logs",
      "Far saw logs",
      "Pulp, same trucks"
    ])
  })

  it("keeps three, each with its public link, poster and area", () => {
    const many = Array.from({ length: 5 }, (_, index) => card({ id: `9999999${index}-9999-4999-8999-999999999999`, slug: `job-${index}`, title: `Job ${index}` }))
    const similar = similarJobs(stopped, many)

    expect(similar).toHaveLength(3)
    expect(similar[0]).toEqual({ areaLabel: "Riverton, OR", href: "/v2/work/job-0", id: many[0]!.id, posterName: "Example Timber Co", title: "Job 0" })
    expect(JSON.stringify(similar)).not.toContain("77777777-7777-4777-8777-777777777777")
  })
})

describe("the sticky interest bar's offer (UX 02 §A7)", () => {
  const base = { acceptingInterest: true, formOffered: false, interestHref: "#interest", isPoster: false, signInHref: "/sign-in?next=x", signedIn: false }

  it("leads to the interest form when it is offered, and to sign-in for a visitor", () => {
    expect(interestBarOffer({ ...base, formOffered: true, signedIn: true })).toEqual({
      href: "#interest",
      kind: "interest",
      label: "I'm interested",
      note: "Free · nonbinding"
    })
    expect(interestBarOffer(base)).toMatchObject({ href: "/sign-in?next=x", kind: "sign-in", label: "Sign in to express interest" })
  })

  it("offers nothing on a job that takes no interest, on the poster's own job, or when there is nothing to do", () => {
    expect(interestBarOffer({ ...base, acceptingInterest: false, formOffered: true })).toBeNull()
    expect(interestBarOffer({ ...base, isPoster: true, signedIn: true })).toBeNull()
    // Signed in, but interest already sent or not a hauling business: the aside says so; the bar adds nothing.
    expect(interestBarOffer({ ...base, signedIn: true })).toBeNull()
  })
})
