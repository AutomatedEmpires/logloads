import { notFound, unstable_rethrow } from "next/navigation"

import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button } from "@logloads/ui/primitives"

import { LandingPlanCards } from "@/components/v2/landing/LandingPlanCards"
import { OrganizationSetupForm } from "@/components/v2/landing/OrganizationSetupForm"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { LANDINGS_PATH } from "@/lib/marketplace-v2/landing-workspace"
import { hasLandingSide } from "@/lib/marketplace-v2/navigation"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { getSessionActor } from "@/lib/session"

export const dynamic = "force-dynamic"

const TITLE = "Set up your landing business"

/** Who is looking: a visitor, an account without a landing business, or one acting for a landing business. */
async function setupContext(): Promise<{ kind: "visitor" } | { kind: "account" } | { kind: "landing"; name: string }> {
  try {
    const actor = await getSessionActor()

    if (!actor) {
      return { kind: "visitor" }
    }

    const organization = actor.activeOrganization

    if (!organization || actor.workspaceSelectionInvalid) {
      return { kind: "account" }
    }

    const access = await pilotMarketplaceV2.viewerAccess({ organizationId: organization.id, userId: actor.profile.id })
    return hasLandingSide(access.capabilities) ? { kind: "landing", name: access.organizationName } : { kind: "account" }
  } catch (error) {
    unstable_rethrow(error)
    return { kind: "account" }
  }
}

/**
 * `/v2/start/landing` (#127, UX B1–B2): set up a landing business and see the plans. Plan facts come from
 * packages/contracts only, and billing is not active: there is no plan choice and no checkout. Marketplace V2 is off
 * in production, so nothing here is a public pricing page.
 */
export default async function LandingSetupPage() {
  if (!marketplaceV2Enabled()) notFound()

  const context = await setupContext()

  return (
    <div data-ds-page="landing-setup">
      <PageHeader
        description="A landing business posts hauling jobs and recruits log trucks. Hauling businesses use LogLoads free."
        title={TITLE}
      />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <>
              <Section title="Your business">
                {context.kind === "visitor" ? (
                  <Button href={`/sign-in?next=${encodeURIComponent("/v2/start/landing")}`} label="Sign in to set up a business" variant="secondary" />
                ) : context.kind === "landing" ? (
                  <>
                    <p>You are acting for {context.name}, which already runs a landing desk.</p>
                    <Button href={LANDINGS_PATH} label="Manage landings" variant="secondary" />
                  </>
                ) : (
                  <OrganizationSetupForm />
                )}
              </Section>
              <LandingPlanCards />
            </>
          }
        />
      </PageContainer>
    </div>
  )
}
