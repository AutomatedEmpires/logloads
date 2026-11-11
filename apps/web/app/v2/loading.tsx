import { ContentGrid, PageContainer } from "@logloads/ui/layout"
import { LoadingState } from "@logloads/ui/primitives"

/**
 * While a V2 page loads (#279; design audit 1, C1). Every V2 route is rendered per request and waits on several reads,
 * so a client navigation shows this inside the V2 shell (header and navigation stay) instead of no feedback at all.
 * It is the design system's skeleton: a status message for assistive technology, placeholder rows that never show
 * example data, and a shimmer only without reduced motion. The job page has its own detail skeleton.
 */
export default function MarketplaceV2Loading() {
  return (
    <div data-ds-page="loading">
      <PageContainer>
        <ContentGrid layout="single" main={<LoadingState kind="rows" label="Loading the page" rows={4} />} />
      </PageContainer>
    </div>
  )
}
