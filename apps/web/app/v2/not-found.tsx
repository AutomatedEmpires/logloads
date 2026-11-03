import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

/**
 * A missing V2 job or page stays inside the V2 shell. Without this boundary `notFound()` falls through to
 * the root not-found page, whose legacy public header offers signed-in users the legacy workspace chooser.
 * Built from the design system (DS-04, #147).
 */
export default function MarketplaceV2NotFound() {
  return (
    <div data-ds-page="not-found">
      <PageHeader title="This page is not available" />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <EmptyState
                actions={<Button href="/v2/work" label="Find work" size="sm" variant="secondary" />}
                body="The job may have closed or been removed, or the link may be incomplete."
                title="Nothing to show at this address"
              />
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
