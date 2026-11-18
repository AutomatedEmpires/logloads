import "server-only"

import { marketplaceV2AdapterKind, normalizedAdapterConfiguration, type MarketplaceV2AdapterKind } from "../adapter"
import { reportV2Error } from "../error-log"
import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MarketplaceRefusalError } from "../port"
import { getV2SessionActor, normalizedSessionPrincipal } from "../v2-session"
import { liquidityBoard, type BasinLiquidityCounts, type LiquidityBoard } from "./board"
import { normalizedLiquidity } from "./normalized"

/**
 * Who gets the liquidity board, and what they get (#326). LogLoads staff only.
 *
 * - `denied`: not staff, or not signed in. The page answers with its not-found page, so the route says nothing.
 * - `unavailable`: staff, on the pilot store, which keeps no basins.
 * - `failed`: the read failed; logged under `requestId` with no personal data (`error-log.ts`).
 * - `ready`: the board.
 *
 * On the normalized store the database is the gate: the read runs as the session's own person and `list_basins`
 * refuses anyone without an active `platform_admins` row (42501). An organization role never opens it. Identity comes
 * from the server session only; nothing from the request names the person.
 */
export type LiquidityBoardResult =
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "failed"; requestId: string | null }
  | { kind: "ready"; board: LiquidityBoard }

export interface LiquidityBoardDependencies {
  adapterKind: () => MarketplaceV2AdapterKind
  /** Pilot store only: whether the session's person is a pilot platform administrator. */
  pilotStaff: () => Promise<boolean>
  /** Normalized store only: the session's person as a database principal, or `null` when no one is signed in. */
  principal: () => Promise<MarketplacePrincipal | null>
  read: (principal: MarketplacePrincipal) => Promise<BasinLiquidityCounts[]>
  report: (error: unknown, operation: string) => { requestId: string | null }
}

let cached: { db: MarketplaceDb; key: string } | null = null

/** One small pool for this staff page, created on first use and replaced only when the configuration changes. */
function boardDb(): MarketplaceDb {
  const { databaseUrl } = normalizedAdapterConfiguration()

  if (cached?.key !== databaseUrl) {
    cached = { db: createPostgresMarketplaceDb({ max: 1, url: databaseUrl }), key: databaseUrl }
  }

  return cached.db
}

const DEFAULTS: LiquidityBoardDependencies = {
  adapterKind: () => marketplaceV2AdapterKind(),
  pilotStaff: async () => (await getV2SessionActor())?.isPlatformAdmin === true,
  principal: async () => {
    const session = await normalizedSessionPrincipal()

    return session ? { ...normalizedAdapterConfiguration().identity, subject: session.subject } : null
  },
  read: (principal) => normalizedLiquidity(boardDb()).board(principal),
  report: reportV2Error
}

export async function loadLiquidityBoard(dependencies: LiquidityBoardDependencies = DEFAULTS): Promise<LiquidityBoardResult> {
  if (dependencies.adapterKind() !== "normalized") {
    return (await dependencies.pilotStaff()) ? { kind: "unavailable" } : { kind: "denied" }
  }

  const principal = await dependencies.principal()

  if (!principal) return { kind: "denied" }

  try {
    return { board: liquidityBoard(await dependencies.read(principal)), kind: "ready" }
  } catch (error) {
    if (error instanceof MarketplaceRefusalError && error.code === "42501") return { kind: "denied" }

    return { kind: "failed", requestId: dependencies.report(error, "liquidity.board").requestId }
  }
}
