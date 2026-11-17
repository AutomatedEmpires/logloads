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
