import { marketplaceDistanceMiles, type MarketplaceJobCardView, type MarketplacePublicJobView } from "@logloads/contracts"

import { resolvePublicAppUrl } from "../app-url"

/**
 * Pure rules of the job page (UX-07, #130): the public link it shares, the open jobs it suggests when a listing has
 * stopped accepting interest, and what its sticky interest bar offers. The page resolves the session and the port;
 * these only decide.
 */

/** A job page's path. The slug is the job's public id; nothing else (no query, no fragment) is part of it. */
export function jobPagePath(job: Pick<MarketplacePublicJobView, "slug">): string {
  return `/v2/work/${encodeURIComponent(job.slug)}`
}

/**
 * The public-safe link "Share" shows (spec §10.6): the deployment's public origin and the job's path only. It never
 * carries this request's query (`?sent=1`, an error), a draft, or anything the public page does not show itself.
 */
export function jobShareUrl(job: Pick<MarketplacePublicJobView, "slug">, origin: string = resolvePublicAppUrl()): string {
  return new URL(jobPagePath(job), origin).toString()
}

export interface SimilarJob {
  id: string
  title: string
  href: string
  posterName: string
  areaLabel: string
}

const SIMILAR_LIMIT = 3

function shared(a: readonly string[], b: readonly string[]): number {
  const wanted = new Set(a)
  return b.filter((code) => wanted.has(code)).length
}

/**
 * Up to three open jobs like one that stopped accepting interest (spec §5.3 "suggest alternatives"): the same product
 * first, then the most equipment in common, then the nearest approximate area, then the most recently confirmed.
 * Only jobs that accept interest, never the job itself. Distance uses public 0.1° points only (V2-DEC-01).
 */
export function similarJobs(
  job: Pick<MarketplacePublicJobView, "id" | "product" | "equipment" | "origin">,
  candidates: readonly MarketplaceJobCardView[],
  limit = SIMILAR_LIMIT
): SimilarJob[] {
  const product = job.product?.trim().toLowerCase() ?? null
  const point = job.origin.approximatePoint

  return candidates
    .filter((candidate) => candidate.id !== job.id && candidate.acceptingInterest)
    .map((candidate) => ({
      candidate,
      distance: point ? marketplaceDistanceMiles(point, candidate) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
      equipment: shared(job.equipment, candidate.equipment),
      fresh: Date.parse(candidate.lastConfirmedAt ?? candidate.lastModifiedAt) || 0,
      sameProduct: product !== null && candidate.product?.trim().toLowerCase() === product ? 1 : 0
    }))
    .sort((a, b) =>
      b.sameProduct - a.sameProduct ||
      b.equipment - a.equipment ||
      a.distance - b.distance ||
      b.fresh - a.fresh ||
      a.candidate.title.localeCompare(b.candidate.title))
    .slice(0, limit)
    .map(({ candidate }) => ({
      areaLabel: candidate.origin.label,
      href: jobPagePath(candidate),
      id: candidate.id,
      posterName: candidate.posterName,
      title: candidate.title
    }))
}

/** What the sticky interest bar offers, or null when the page offers no interest route (UX 02 §A7). */
export type InterestBarOffer =
  | { kind: "interest"; href: string; label: string; note: string }
  | { kind: "sign-in"; href: string; label: string; note: string }

export function interestBarOffer(input: {
  acceptingInterest: boolean
  /** The interest form is on this page for the viewer. */
  formOffered: boolean
  signedIn: boolean
  isPoster: boolean
  interestHref: string
  signInHref: string
}): InterestBarOffer | null {
  if (!input.acceptingInterest || input.isPoster) return null
  if (input.formOffered) return { href: input.interestHref, kind: "interest", label: "I'm interested", note: "Free · nonbinding" }
  if (!input.signedIn) return { href: input.signInHref, kind: "sign-in", label: "Sign in to express interest", note: "Free for haulers" }
  return null
}
