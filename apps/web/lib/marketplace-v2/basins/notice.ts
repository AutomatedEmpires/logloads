import "server-only"

import { NOT_IN_YOUR_AREA_YET } from "@logloads/contracts"

import { marketplaceV2AdapterKind, normalizedAdapterConfiguration } from "../adapter"
import type { FindWorkSearch } from "../find-work"
import { createPostgresMarketplaceDb, type MarketplaceDb } from "../normalized-db"
import { normalizedBasins } from "./normalized"

let cached: { db: MarketplaceDb; key: string } | null = null

function noticeDb(): MarketplaceDb {
  const configuration = normalizedAdapterConfiguration()

  if (cached?.key !== configuration.databaseUrl) {
    cached = { db: createPostgresMarketplaceDb({ url: configuration.databaseUrl }), key: configuration.databaseUrl }
  }

  return cached.db
}

/**
 * The closed-area sentence for an empty Find Work search (#324). Null on the pilot store, and in production, so the
 * page keeps its ordinary empty state. When the normalized store is selected, it asks `public_area_notice` as anon.
 * A selected but unsafe connection fails closed, the same way the rest of that store does.
 */
export async function findWorkAreaNotice(search: FindWorkSearch): Promise<string | null> {
  if (marketplaceV2AdapterKind() !== "normalized") return null

  const found = search.place.status === "found" ? search.place.place : null
  const notice = await normalizedBasins(noticeDb()).areaNotice(found
    ? { lat: found.point.lat, lng: found.point.lng, stateCode: found.stateCode }
    : {})

  return notice === NOT_IN_YOUR_AREA_YET ? notice : null
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The closed-area sentence for one shared job (#287, #324). Null on the pilot store, for an id that is not a job
 * id, and when the job is missing or its basin is pilot or open. The exact sentence means the job is real and its
 * area is not open, so the share page can say that without showing the listing.
 */
export async function shareJobAreaNotice(jobId: string): Promise<string | null> {
  if (marketplaceV2AdapterKind() !== "normalized" || !JOB_ID.test(jobId)) return null

  const notice = await normalizedBasins(noticeDb()).areaNotice({ jobId })

  return notice === NOT_IN_YOUR_AREA_YET ? notice : null
}
