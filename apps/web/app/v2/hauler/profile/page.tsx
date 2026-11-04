import { notFound } from "next/navigation"

import { haulerProfileFormValues, type HaulerProfileView, type MarketplaceHaulerEquipmentOption } from "@logloads/contracts"
import { publicHaulerProfile } from "@logloads/services"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState, StepIndicator, Tabs } from "@logloads/ui/primitives"

import styles from "@/components/v2/onboarding/Onboarding.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import profileStyles from "@/components/v2/profile/HaulerProfile.module.css"
import { HaulerProfileForm } from "@/components/v2/profile/HaulerProfileForm"
import { PublicHaulerProfile } from "@/components/v2/profile/PublicHaulerProfile"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  HAULER_SETUP_STEPS,
  haulerSetupKind,
  initialProfileFormState,
  PROFILE_PATH,
  PROFILE_SETUP_NEXT_PATH
} from "@/lib/marketplace-v2/hauler-profile-form"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { MARKETPLACE_PLACES, placeLabel } from "@/lib/marketplace-v2/places"
import { MarketplaceRefusalError } from "@/lib/marketplace-v2/port"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"
import { getSessionActor } from "@/lib/session"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PLACE_OPTIONS = MARKETPLACE_PLACES.map(placeLabel)

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function Refusal({ body, title }: { body: string; title: string }) {
  return (
    <div data-ds-page="hauler-profile">
      <PageHeader title="Business profile" />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <EmptyState
                actions={
                  <>
                    <Button href="/v2/work" label="Browse public jobs" size="sm" variant="secondary" />
                    <Button href="/v2/start" label="Set up a business" size="sm" variant="ghost" />
                  </>
                }
                body={body}
                title={title}
              />
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}

/**
 * `/v2/hauler/profile` (UX 02 §A3, §5.1; #125): the hauling business's own profile, with a "Seen by landing
 * operators" panel and a "Private" panel, and "Preview as a landing sees it", which renders the public profile from
 * the public view only (`publicHaulerProfile`), so no private field can reach it. With `?setup=1` it is setup step 2,
 * which can be skipped. The profile is free and never required: Find work works without it.
 */
export default async function HaulerProfilePage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const query = await searchParams
  const setup = one(query.setup) === "1"
  const preview = one(query.view) === "preview"
  const kind = haulerSetupKind(one(query.type))
  const setupQuery = setup ? `setup=1${kind ? `&type=${kind}` : ""}` : ""
  const resolved = await resolveV2Viewer(setupQuery ? `${PROFILE_PATH}?${setupQuery}` : PROFILE_PATH)

  if (!resolved.ok) {
    return <Refusal body={resolved.refusal} title="No business selected" />
  }

  const { access, viewer } = resolved

  if (!access.capabilities.includes("interest.express")) {
    return <Refusal body={withBusinessSwitchNote("This business has no hauling profile. Profiles here are for hauling businesses.")} title="Not a hauling business" />
  }

  let profile: HaulerProfileView

  try {
    profile = await pilotMarketplaceV2.haulerProfile(viewer)
  } catch (error) {
    const body = error instanceof MarketplaceRefusalError ? error.message : "Your business profile could not be loaded. Try again in a moment."
    return <Refusal body={withBusinessSwitchNote(body)} title="Profile not available" />
  }

  const equipment: MarketplaceHaulerEquipmentOption[] = await pilotMarketplaceV2.haulerEquipment(viewer).catch(() => [])
  const actor = await getSessionActor()
  const tabs = [
    { href: setupQuery ? `${PROFILE_PATH}?${setupQuery}` : PROFILE_PATH, id: "edit", label: "Edit" },
    { href: `${PROFILE_PATH}?${[setupQuery, "view=preview"].filter(Boolean).join("&")}`, id: "preview", label: "Preview as a landing sees it" }
  ]
  const description = setup
    ? kind === "solo"
      ? "What landing operators see about you, and what stays private. You can skip this and come back."
      : "What landing operators see about your business, and what stays private. You can skip this and come back."
    : "What landing operators see about your business, and what stays private. Free, and never needed to search for work."

  return (
    <div data-ds-page="hauler-profile">
      <PageHeader
        description={description}
        tabs={<Tabs activeId={preview ? "preview" : "edit"} items={tabs} label="Profile views" />}
        title={setup ? "Your business" : "Business profile"}
      />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <div className={styles.stack}>
                {setup ? <StepIndicator current={1} steps={[...HAULER_SETUP_STEPS]} /> : null}
                {preview ? (
                  <div className={profileStyles.previewNote}>
                    <PageNotice role="note">
                      This is your saved profile exactly as a landing operator sees it; changes you have not saved are not in it.
                      {profile.listed
                        ? " Every landing operator can see it."
                        : " Right now only landings you send interest to can see it."}
                    </PageNotice>
                    <PublicHaulerProfile profile={publicHaulerProfile(profile, equipment)} />
                  </div>
                ) : (
                  <HaulerProfileForm
                    accountEmail={actor?.profile.email ?? null}
                    canEditIdentity={profile.canEditIdentity}
                    canEditProfile={profile.canEditProfile}
                    initial={initialProfileFormState(haulerProfileFormValues(profile))}
                    places={PLACE_OPTIONS}
                    setup={setup}
                    skipHref={PROFILE_SETUP_NEXT_PATH}
                    supportsSaving={pilotMarketplaceV2.supportsHaulerProfile}
                    verified={profile.verification !== null}
                  />
                )}
              </div>
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
