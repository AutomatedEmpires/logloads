import { notFound } from "next/navigation"

import type { HaulerAvailabilityReportView, HaulerProfileView, MarketplaceHaulerEquipmentOption } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader } from "@logloads/ui/layout"

import { directoryListingFacts } from "@/app/v2/hauler/profile/listing/_lib/facts"
import { ProfileRefusal } from "@/app/v2/hauler/profile/_lib/ProfileRefusal"
import { DirectoryListingNotice } from "@/components/v2/profile/DirectoryListingNotice"
import styles from "@/components/v2/profile/HaulerProfile.module.css"
import { saveHaulerListingAction, submitHaulerListingAction } from "@/lib/marketplace-v2/hauler-actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { initialListingState, LISTING_OUTCOME_PARAM, PROFILE_LISTING_PATH, PROFILE_PATH } from "@/lib/marketplace-v2/hauler-profile-form"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { MarketplaceRefusalError } from "@/lib/marketplace-v2/port"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

function Refusal({ body, title }: { body: string; title: string }) {
  return <ProfileRefusal body={body} page="hauler-listing" pageTitle="Directory listing" title={title} />
}

/**
 * `/v2/hauler/profile/listing` (#423, LL-UI05): the directory listing notice, Figma 04 Settings, approved on #336
 * (comment 6995131813). Not listed 361:4236 / 361:4523 / 361:4739, listed 361:4954 / 361:5163 / 361:5372, removed with
 * Undo 361:5581 / 361:5799 / 361:6009, offline 361:6219 / 361:6457 / 361:6682, not saved 361:6907 / 361:7131 /
 * 361:7347, dark 361:7563 (390 / 768 / 1440).
 *
 * Legal review §6.5: a just-in-time notice of exactly what landings see, who sees it, what is never shown, and that a
 * copy saved before removal cannot be taken back. Listing is the hauler's choice and off until they tap List my
 * profile; Remove my listing is one tap with Undo. Sending interest never needs a listing. Reached from the business
 * profile, which no longer carries a listing checkbox. Like every V2 page it is noindex (the V2 layout) and in no
 * sitemap; it sets no metadata of its own.
 */
export default async function HaulerListingPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const query = await searchParams
  const resolved = await resolveV2Viewer(PROFILE_LISTING_PATH)

  if (!resolved.ok) {
    return <Refusal body={resolved.refusal} title="No business selected" />
  }

  const { access, viewer } = resolved

  if (!access.capabilities.includes("interest.express")) {
    return <Refusal body={withBusinessSwitchNote("This business has no hauling profile. Directory listings are for hauling businesses.")} title="Not a hauling business" />
  }

  let profile: HaulerProfileView

  try {
    profile = await pilotMarketplaceV2.haulerProfile(viewer)
  } catch (error) {
    const body = error instanceof MarketplaceRefusalError ? error.message : "Your directory listing could not be loaded. Try again in a moment."
    return <Refusal body={withBusinessSwitchNote(body)} title="Listing not available" />
  }

  const [equipment, fleet] = await Promise.all([
    pilotMarketplaceV2.haulerEquipment(viewer).catch((): MarketplaceHaulerEquipmentOption[] | null => null),
    pilotMarketplaceV2.haulerFleet(viewer).then(
      (view): HaulerAvailabilityReportView[] => view.availability,
      (): HaulerAvailabilityReportView[] | null => null
    )
  ])
  const facts = directoryListingFacts({ availability: fleet, equipment, now: new Date(), profile })

  return (
    <div data-ds-page="hauler-listing">
      <PageHeader
        breadcrumbs={[{ href: PROFILE_PATH, label: "Business profile" }, { label: "Directory listing" }]}
        description={`Choose whether landings can find ${profile.businessName} in Find trucks.`}
        title="Directory listing"
      />
      <PageContainer width="narrow">
        <ContentGrid
          layout="single"
          main={
            <div className={styles.listingPanel}>
              <DirectoryListingNotice
                action={saveHaulerListingAction}
                backHref={PROFILE_PATH}
                businessName={profile.businessName}
                canEdit={profile.canEditProfile}
                facts={facts}
                formAction={submitHaulerListingAction}
                initial={initialListingState(profile.listed, one(query[LISTING_OUTCOME_PARAM]))}
                supportsSaving={pilotMarketplaceV2.supportsHaulerProfile}
              />
            </div>
          }
        />
      </PageContainer>
    </div>
  )
}
