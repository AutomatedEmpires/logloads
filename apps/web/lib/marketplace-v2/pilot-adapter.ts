import "server-only"

import {
  filterMarketplaceJobs,
  sortMarketplaceJobs,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobFilters
} from "@logloads/contracts"
import { marketplaceJobStatus } from "@logloads/services"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { buildNetworkView } from "../network"
import { mutateState, readState } from "../services"
import { toInterestView, toJobDetailView } from "./mapping"
import { MarketplaceOperationUnavailableError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * Marketplace V2 over the pilot's versioned `operating_state` document. Reads go through the public,
 * redacted network view; writes go through the services facade inside the compare-and-swap mutation
 * path. Replace with a normalized-v2 adapter implementing the same port once that schema is validated.
 *
 * Native V2 job publishing and reconfirmation are deliberately NOT persisted here: forcing a V2 job
 * advertisement into the legacy load/slot/route-pack records would recreate the dispatch model, and a
 * second permanent JSON job model would compete with the normalized `job_postings` table. Those two
 * operations wait for the normalized adapter; the authoring screens validate and preview only.
 */

function publicJobs(state: LogLoadsDatabaseState, at = new Date()): MarketplaceJobDetailView[] {
  const view = buildNetworkView(state, { kind: "public" }, at)
  const atIso = at.toISOString()

  return view.loads.flatMap((networkLoad) => {
    const load = state.loadPostings.find((candidate) => candidate.id === networkLoad.id)

    if (!load || load.status === "draft") {
      return []
    }

    const poster = state.organizations.find((organization) => organization.id === load.companyId)

    return [toJobDetailView(networkLoad, load, poster?.verificationStatus === "verified", marketplaceJobStatus(load, atIso))]
  })
}

function actor(viewer: MarketplaceV2Viewer) {
  return { actorUserId: viewer.userId, organizationId: viewer.organizationId }
}

function interestView(state: LogLoadsDatabaseState, interest: Parameters<typeof toInterestView>[1]): MarketplaceInterestView {
  return toInterestView(state, interest, (load) => marketplaceJobStatus(load))
}

export const pilotMarketplaceV2: MarketplaceV2Port = {
  supportsPublishing: false,

  async authoringLandings(viewer) {
    return readState((current) => current.marketplaceAuthoringLandings(actor(viewer)))
  },

  async expressInterest(viewer, input) {
    return mutateState((draft) => interestView(draft.state, draft.expressMarketplaceInterest(actor(viewer), input).interest))
  },

  async haulerEquipment(viewer) {
    return readState((current) => current.marketplaceHaulerEquipment(actor(viewer)))
  },

  async getJob(jobId) {
    return readState((current) => publicJobs(current.state).find((job) => job.id === jobId) ?? null)
  },

  async interestForJob(viewer, jobId) {
    return readState((current) => {
      const interest = current.state.marketplaceInterests.find((candidate) =>
        candidate.loadPostingId === jobId && candidate.haulerOrganizationId === viewer.organizationId
      )

      if (!interest) {
        return null
      }

      // Authority check through the service (throws for a non-member or non-hauling workspace).
      current.listMarketplaceInterestsForHauler(actor(viewer))

      return interestView(current.state, interest)
    })
  },

  async listHaulerInterests(viewer) {
    return readState((current) =>
      current.listMarketplaceInterestsForHauler(actor(viewer)).map((interest) => interestView(current.state, interest)))
  },

  async listJobs(filters: MarketplaceJobFilters) {
    return readState((current) => sortMarketplaceJobs(filterMarketplaceJobs(publicJobs(current.state), filters)))
  },

  async listLandingInterests(viewer) {
    return readState((current) =>
      current.listMarketplaceInterestsForLanding(actor(viewer)).map((interest) => interestView(current.state, interest)))
  },

  async publishJob() {
    throw new MarketplaceOperationUnavailableError("Publishing a V2 job")
  },

  async reconfirmJob() {
    throw new MarketplaceOperationUnavailableError("Reconfirming a V2 job")
  },

  async postHaulerReply(viewer, input) {
    await mutateState((draft) => draft.postHaulerInterestReply(actor(viewer), input))
  },

  async respondToInterest(viewer, input) {
    await mutateState((draft) => draft.respondToMarketplaceInterest(actor(viewer), input))
  },

  async viewerAccess(viewer) {
    return readState((current) => {
      const access = current.marketplaceViewerAccess(actor(viewer))
      return { capabilities: access.capabilities, organizationName: access.organizationName }
    })
  },

  async withdrawInterest(viewer, interestId) {
    await mutateState((draft) => draft.withdrawMarketplaceInterest(actor(viewer), interestId))
  }
}
