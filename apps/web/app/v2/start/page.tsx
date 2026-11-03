import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

import { NO_BUSINESS_PROFILE_REFUSAL } from "@/lib/marketplace-v2/viewer"

/**
 * `/v2/start` (#124): where a signed-in account with no business lands when V2 is enabled. Business setup is not
 * part of the preview, so this says so instead of opening the legacy onboarding cockpit. Built from the design
 * system (DS-04, #147).
 */
export default function StartPage() {
  return (
    <div data-ds-page="start">
      <PageHeader title="Set up your business" />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <EmptyState
                actions={<Button href="/v2/work" label="Browse public jobs" size="sm" variant="secondary" />}
                body={NO_BUSINESS_PROFILE_REFUSAL}
                title="No business linked yet"
              />
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
