import { buildNetworkView, type NetworkLoadView } from "./network"
import { readState } from "./services"
import { PUBLIC_READ_TTL_MS, shortLivedCache } from "./short-lived-cache"

/**
 * The anonymous load board: the same redacted public projection for every
 * caller. Building it downloads the whole operating_state document, so it is
 * shared for a short window per instance rather than rebuilt per request
 * (HF-09, #187).
 *
 * One cache for every anonymous reader: `GET /api/loads` and the server-rendered
 * public pages (`/`, `/loads`, `/loads/[slug]` and the sitemap). Callers get the
 * shared array and must treat it as read-only.
 */
export const publicBoard = shortLivedCache<NetworkLoadView[]>(PUBLIC_READ_TTL_MS, () =>
  readState((current) => buildNetworkView(current.state, { kind: "public" }).loads)
)
