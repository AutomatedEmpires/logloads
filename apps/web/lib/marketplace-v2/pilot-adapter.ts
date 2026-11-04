import "server-only"

import {
  filterMarketplaceJobs,
  sortMarketplaceJobs,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobFilters
} from "@logloads/contracts"
import { marketplaceJobStatus, pilotHaulerFleet, pilotHaulerProfile } from "@logloads/services"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { buildNetworkView } from "../network"
import { mutateState, readState } from "../services"
import { selectMarketplaceV2Port } from "./adapter"
import { pilotPosterVerification, toInterestView, toJobDetailView } from "./mapping"
import { MarketplaceOperationUnavailableError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * Marketplace V2 over the pilot's versioned `operating_state` document. Reads go through the public,
 * redacted network view; writes go through the services facade inside the compare-and-swap mutation
 * path. `normalized-adapter.ts` implements the same port over the normalized-v2 schema; `adapter.ts` chooses.
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

    return [toJobDetailView(networkLoad, load, pilotPosterVerification(poster, state.verificationRecords), marketplaceJobStatus(load, atIso))]
  })
}

function actor(viewer: MarketplaceV2Viewer) {
  return { actorUserId: viewer.userId, organizationId: viewer.organizationId }
}

function interestView(state: LogLoadsDatabaseState, interest: Parameters<typeof toInterestView>[1]): MarketplaceInterestView {
  return toInterestView(state, interest, (load) => marketplaceJobStatus(load))
}

export const operatingStateMarketplaceV2: MarketplaceV2Port = {
  supportsPublishing: false,
  // The pilot holds a business name and legal name only, and no service edits them (#125).
  supportsHaulerProfile: false,
  // The pilot's equipment is per-unit dispatch records (unit numbers, payload, drivers) and its availability is per
  // driver; V2 presets and self-reported counts are read from it but never written into it (#126).
  supportsHaulerFleet: false,

  async haulerFleet(viewer) {
    return readState((current) => pilotHaulerFleet(current.state, actor(viewer)))
  },

  async addHaulerEquipment() {
    throw new MarketplaceOperationUnavailableError("Adding equipment")
  },

  async setHaulerEquipmentCount() {
    throw new MarketplaceOperationUnavailableError("Changing equipment counts")
  },

  async reportHaulerAvailability() {
    throw new MarketplaceOperationUnavailableError("Reporting availability")
  },

  async confirmHaulerAvailability() {
    throw new MarketplaceOperationUnavailableError("Confirming availability")
  },

  async authoringLandings(viewer) {
    return readState((current) => current.marketplaceAuthoringLandings(actor(viewer)))
  },

  async expressInterest(viewer, input) {
    return mutateState((draft) => interestView(draft.state, draft.expressMarketplaceInterest(actor(viewer), input).interest))
  },

  async haulerEquipment(viewer) {
    return readState((current) => current.marketplaceHaulerEquipment(actor(viewer)))
  },

  async haulerProfile(viewer) {
    return readState((current) => {
      const organization = current.state.organizations.find((candidate) => candidate.id === viewer.organizationId)
      return pilotHaulerProfile(current.state, actor(viewer), pilotPosterVerification(organization, current.state.verificationRecords))
    })
  },

  async getJob(jobId) {
    // The pilot's public view already lists every non-draft job, accepting interest or not, so the viewer adds nothing.
    return readState((current) => publicJobs(current.state).find((job) => job.id === jobId) ?? null)
  },

  // Listing reports (UX-07, #130): the pilot store has no report record, so nothing is kept and nothing pretends to be.
  async reportListing() {
    throw new MarketplaceOperationUnavailableError("Reporting a listing")
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
    // Filtering and order are the contract's pure rules, so this adapter and the normalized one agree: distance is
    // measured only to each job's approximate public point, from a search origin snapped to the same 0.1° grid.
    return readState((current) => sortMarketplaceJobs(filterMarketplaceJobs(publicJobs(current.state), filters), filters))
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

  async saveHaulerProfile() {
    throw new MarketplaceOperationUnavailableError("Saving a hauling business profile")
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
  },

  // Inquiry conversations (UX-09, #132).

  async withdrawInterestWithReason(viewer, input) {
    await mutateState((draft) => draft.withdrawMarketplaceInterestWithReason(actor(viewer), input))
  },

  async landingInquiryJobs(viewer) {
    return readState((current) => {
      // Authority through the service: only a member who may respond to the landing's inquiries, and only its own.
      const jobIds = new Set(current.listMarketplaceInterestsForLanding(actor(viewer)).map((interest) => interest.loadPostingId))

      return [...jobIds].map((jobId) => {
        const load = current.state.loadPostings.find((candidate) => candidate.id === jobId)
        const landing = load ? current.state.landings.find((candidate) => candidate.id === load.pickupLandingId) : undefined

        // The pilot's equipment requirements are free-text tags, not the V2 equipment codes, so there is nothing to
        // compare an offered configuration with: `null`, never a guessed match.
        return { equipmentCodes: null, jobId, landing: landing ? { id: landing.id, name: landing.name } : null }
      })
    })
  }
}

/**
 * The V2 port every page and action uses. Its name predates the normalized adapter: it is the pilot adapter above,
 * unchanged, unless `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized` deliberately selects the normalized one outside
 * production (`adapter.ts`).
 */
export const pilotMarketplaceV2: MarketplaceV2Port = selectMarketplaceV2Port(operatingStateMarketplaceV2)
