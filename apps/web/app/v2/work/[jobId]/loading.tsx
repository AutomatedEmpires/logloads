import { ContentGrid, PageContainer } from "@logloads/ui/layout"
import { LoadingState } from "@logloads/ui/primitives"

/**
 * While a job page loads (#279; design audit 1, C1): the design system's job-detail skeleton, in the page's main and
 * aside columns, so opening a job from Find work shows the shape of a job rather than a list. Only the main column
 * announces itself; the aside's placeholder is hidden from assistive technology, so the wait is announced once.
 */
export default function JobDetailLoading() {
  return (
    <div data-ds-page="loading">
      <PageContainer>
        <ContentGrid
          aside={<LoadingState aria-hidden="true" kind="rows" label="Loading the interest form" rows={2} />}
          layout="main-aside"
          main={<LoadingState kind="detail" label="Loading the job" />}
        />
      </PageContainer>
    </div>
  )
}
