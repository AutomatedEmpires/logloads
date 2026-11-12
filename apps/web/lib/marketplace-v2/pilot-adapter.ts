import "server-only"

import {
  filterMarketplaceJobs,
  marketplaceFeatureCapabilities,
  marketplaceV2FeatureSupport,
  sortMarketplaceJobs,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobFilters
} from "@logloads/contracts"
import { marketplaceJobStatus, pilotHaulerFleet, pilotHaulerProfile, resolveMarketplaceActor } from "@logloads/services"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { buildNetworkView } from "../network"
import { mutateState, readState } from "../services"
import { selectMarketplaceV2Port } from "./adapter"
import { marketplaceInterestPage, marketplaceJobPage } from "./keyset-pages"
import { pilotPosterVerification, toInterestView, toJobDetailView } from "./mapping"
import {
  MARKETPLACE_V2_FEATURE_OPERATIONS,
  MarketplaceOperationUnavailableError,
  type MarketplaceV2Port,
  type MarketplaceV2Viewer
} from "./port"

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

/**
 * Discovery: filtering and order are the contract's pure rules, so this adapter and the normalized one agree. Distance
 * is measured only to each job's approximate public point, from a search origin snapped to the same 0.1° grid.
 */
function discoveredJobs(state: LogLoadsDatabaseState, filters: MarketplaceJobFilters): MarketplaceJobDetailView[] {
  return sortMarketplaceJobs(filterMarketplaceJobs(publicJobs(state), filters), filters)
}

function actor(viewer: MarketplaceV2Viewer) {
  return { actorUserId: viewer.userId, organizationId: viewer.organizationId }
}

function interestView(state: LogLoadsDatabaseState, interest: Parameters<typeof toInterestView>[1]): MarketplaceInterestView {
  return toInterestView(state, interest, (load) => marketplaceJobStatus(load))
}

// Port v3 (#244): what each refused operation is called, shared with the normalized adapter's refusals.
const { admin: ADMIN, alerts: ALERTS, billing: BILLING, boosts: BOOSTS, invites: INVITES, jobs: JOBS, notify: NOTIFY, team: TEAM, trucks: TRUCKS } =
  MARKETPLACE_V2_FEATURE_OPERATIONS

export const operatingStateMarketplaceV2: MarketplaceV2Port = {
  supportsPublishing: false,
  // The pilot holds a business name and legal name only, and no service edits them (#125).
  supportsHaulerProfile: false,
  // The pilot's equipment is per-unit dispatch records (unit numbers, payload, drivers) and its availability is per
  // driver; V2 presets and self-reported counts are read from it but never written into it (#126).
  supportsHaulerFleet: false,
  // Port v3 (#244): the pilot store keeps none of the records these groups need (see the refusals at the end).
  supports: marketplaceV2FeatureSupport(),

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

  // #213: the pilot store has no service that adds a business to an existing account, so nothing is created here.
  async createHaulingBusiness() {
    throw new MarketplaceOperationUnavailableError("Setting up a hauling business")
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
    return readState((current) => discoveredJobs(current.state, filters))
  },

  // #280: one read of the document per page. The public view already carries every job's detail fields, and the
  // document holds every job, so the count is exact.
  async listJobPage(filters, page) {
    return readState((current) => marketplaceJobPage(discoveredJobs(current.state, filters), filters, page, { exact: true }))
  },

  async listLandingInterests(viewer) {
    return readState((current) =>
      current.listMarketplaceInterestsForLanding(actor(viewer)).map((interest) => interestView(current.state, interest)))
  },

  // #280: the same services and authority checks as the two lists above, in one read.
  async listInterestPage(viewer, side, page) {
    return readState((current) => {
      const interests = side === "hauler"
        ? current.listMarketplaceInterestsForHauler(actor(viewer))
        : current.listMarketplaceInterestsForLanding(actor(viewer))

      return marketplaceInterestPage(
        interests.map((interest) => interestView(current.state, interest)),
        { organizationId: viewer.organizationId, side },
        page,
        { exact: true }
      )
    })
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

  // Port v3 (#244): from the same translated membership as `viewerAccess`, which also refuses a non-member. The pilot
  // supports none of the groups these open (`supports`), so its pages offer none of their actions.
  async viewerFeatureCapabilities(viewer) {
    return readState((current) => marketplaceFeatureCapabilities(resolveMarketplaceActor(current.state, actor(viewer)).marketplace))
  },

  async withdrawInterest(viewer, interestId) {
    await mutateState((draft) => draft.withdrawMarketplaceInterest(actor(viewer), interestId))
  },

  // -------------------------------------------------------------------------------------------------------------
  // Landing workspace (#127, #133). Reads come from the pilot's own landings. Writes are not persisted here: the
  // pilot landing record needs a street address, an exact pin and a contact, its cap follows the retired pilot
  // billing model rather than the Blueprint plans, and pausing it would not unlist its jobs. So saving, status
  // changes and business setup wait for the normalized store, and the pages say so.
  // -------------------------------------------------------------------------------------------------------------

  async createLandingOrganization() {
    throw new MarketplaceOperationUnavailableError("Setting up a landing business")
  },

  async getOwnLanding(viewer, landingId) {
    return readState((current) => current.marketplaceOwnLandings(actor(viewer)).find((landing) => landing.id === landingId) ?? null)
  },

  async landingAllowance(viewer) {
    return readState((current) => current.marketplaceLandingAllowance(actor(viewer)))
  },

  async listOwnLandings(viewer) {
    return readState((current) => current.marketplaceOwnLandings(actor(viewer)))
  },

  async saveLanding() {
    throw new MarketplaceOperationUnavailableError("Saving a landing")
  },

  async setLandingStatus() {
    throw new MarketplaceOperationUnavailableError("Changing a landing's status")
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
  },
  // -------------------------------------------------------------------------------------------------------------
  // Port v3 (#244). Every method is refused here: the pilot store keeps none of these records, and writing them
  // into the legacy document would make a second, untested source of truth (AGENTS.md §2.4). Nothing is read or
  // written before the refusal.
  // -------------------------------------------------------------------------------------------------------------

  // jobs (#247): V2 jobs are not persisted in the pilot store (see above), so there is no own V2 job to manage.
  async duplicateJob() {
    throw new MarketplaceOperationUnavailableError(JOBS.duplicateJob)
  },

  async editJob() {
    throw new MarketplaceOperationUnavailableError(JOBS.editJob)
  },

  async getOwnJob() {
    throw new MarketplaceOperationUnavailableError(JOBS.getOwnJob)
  },

  async listOwnJobs() {
    throw new MarketplaceOperationUnavailableError(JOBS.listOwnJobs)
  },

  async resumeJob() {
    throw new MarketplaceOperationUnavailableError(JOBS.resumeJob)
  },

  async setJobStatus() {
    throw new MarketplaceOperationUnavailableError(JOBS.setJobStatus)
  },

  // billing (#248): the pilot's plan record follows the retired pilot billing model, not the Blueprint plans.
  async foundingOffer() {
    throw new MarketplaceOperationUnavailableError(BILLING.foundingOffer)
  },

  async planAllowance() {
    throw new MarketplaceOperationUnavailableError(BILLING.planAllowance)
  },

  // team (#249): the pilot has no seat invitations and no landing scope, so no team change is kept.
  async acceptTeamInvitation() {
    throw new MarketplaceOperationUnavailableError(TEAM.acceptTeamInvitation)
  },

  async declineTeamInvitation() {
    throw new MarketplaceOperationUnavailableError(TEAM.declineTeamInvitation)
  },

  async inviteTeamMember() {
    throw new MarketplaceOperationUnavailableError(TEAM.inviteTeamMember)
  },

  async receivedTeamInvitations() {
    throw new MarketplaceOperationUnavailableError(TEAM.receivedTeamInvitations)
  },

  async removeTeamMember() {
    throw new MarketplaceOperationUnavailableError(TEAM.removeTeamMember)
  },

  async resendTeamInvitation() {
    throw new MarketplaceOperationUnavailableError(TEAM.resendTeamInvitation)
  },

  async revokeTeamInvitation() {
    throw new MarketplaceOperationUnavailableError(TEAM.revokeTeamInvitation)
  },

  async setMemberLandingScope() {
    throw new MarketplaceOperationUnavailableError(TEAM.setMemberLandingScope)
  },

  async team() {
    throw new MarketplaceOperationUnavailableError(TEAM.team)
  },

  // invites (#250): the pilot has no opt-in targeted invitations or billing-cycle allowance.
  async invitationAudience() {
    throw new MarketplaceOperationUnavailableError(INVITES.invitationAudience)
  },

  async invitationRecipients() {
    throw new MarketplaceOperationUnavailableError(INVITES.invitationRecipients)
  },

  async receivedInvitations() {
    throw new MarketplaceOperationUnavailableError(INVITES.receivedInvitations)
  },

  async respondToInvitation() {
    throw new MarketplaceOperationUnavailableError(INVITES.respondToInvitation)
  },

  async sendTargetedInvitations() {
    throw new MarketplaceOperationUnavailableError(INVITES.sendTargetedInvitations)
  },

  async sentInvitations() {
    throw new MarketplaceOperationUnavailableError(INVITES.sentInvitations)
  },

  // trucks (#251): the pilot has no listed-business directory or saved truck searches.
  async deleteTruckSearch() {
    throw new MarketplaceOperationUnavailableError(TRUCKS.deleteTruckSearch)
  },

  async listTruckSearches() {
    throw new MarketplaceOperationUnavailableError(TRUCKS.listTruckSearches)
  },

  async saveTruckSearch() {
    throw new MarketplaceOperationUnavailableError(TRUCKS.saveTruckSearch)
  },

  async searchTrucks() {
    throw new MarketplaceOperationUnavailableError(TRUCKS.searchTrucks)
  },

  // alerts (#252): the pilot keeps no saved jobs, saved job searches or notification consent.
  async deleteJobSearch() {
    throw new MarketplaceOperationUnavailableError(ALERTS.deleteJobSearch)
  },

  async listJobSearches() {
    throw new MarketplaceOperationUnavailableError(ALERTS.listJobSearches)
  },

  async listSavedJobs() {
    throw new MarketplaceOperationUnavailableError(ALERTS.listSavedJobs)
  },

  async notificationPreferences() {
    throw new MarketplaceOperationUnavailableError(ALERTS.notificationPreferences)
  },

  async saveJob() {
    throw new MarketplaceOperationUnavailableError(ALERTS.saveJob)
  },

  async saveJobSearch() {
    throw new MarketplaceOperationUnavailableError(ALERTS.saveJobSearch)
  },

  async setNotificationPreference() {
    throw new MarketplaceOperationUnavailableError(ALERTS.setNotificationPreference)
  },

  async unsaveJob() {
    throw new MarketplaceOperationUnavailableError(ALERTS.unsaveJob)
  },

  // notify (#253): the pilot has no notification outbox.
  async listNotifications() {
    throw new MarketplaceOperationUnavailableError(NOTIFY.listNotifications)
  },

  async markNotificationsRead() {
    throw new MarketplaceOperationUnavailableError(NOTIFY.markNotificationsRead)
  },

  // boosts (#254): the pilot has no boost records.
  async boostAudience() {
    throw new MarketplaceOperationUnavailableError(BOOSTS.boostAudience)
  },

  async listJobBoosts() {
    throw new MarketplaceOperationUnavailableError(BOOSTS.listJobBoosts)
  },

  // admin (#255): pilot staff tools stay in the pilot admin console; V2 moderation needs the normalized store.
  async adminAccess() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminAccess)
  },

  async adminGrantFoundingHaulerBadge() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminGrantFoundingHaulerBadge)
  },

  async adminGrantFoundingPromotion() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminGrantFoundingPromotion)
  },

  async adminModerateJob() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminModerateJob)
  },

  async adminQueue() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminQueue)
  },

  async adminReadInquiryThread() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminReadInquiryThread)
  },

  async adminReadLandingPrivate() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminReadLandingPrivate)
  },

  async adminReleaseJobHold() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminReleaseJobHold)
  },

  async adminReports() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminReports)
  },

  async adminResolveReport() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminResolveReport)
  },

  async adminSetVerification() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminSetVerification)
  },

  async adminVerificationQueue() {
    throw new MarketplaceOperationUnavailableError(ADMIN.adminVerificationQueue)
  }
}

/**
 * The V2 port every page and action uses. Its name predates the normalized adapter: it is the pilot adapter above,
 * unchanged, unless `LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized` deliberately selects the normalized one outside
 * production (`adapter.ts`).
 */
export const pilotMarketplaceV2: MarketplaceV2Port = selectMarketplaceV2Port(operatingStateMarketplaceV2)
