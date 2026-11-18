import { ContentGrid, PageContainer, PageHeader } from "@logloads/ui/layout"
import { LoadingState } from "@logloads/ui/primitives"

/** The board's skeleton (#326): the same header as the page, so the heading does not move when the figures arrive. */
export default function LiquidityBoardLoading() {
  return (
    <div data-ds-page="admin-liquidity">
      <PageHeader description="Work and trucks in each basin. LogLoads staff only." title="Basin liquidity" />
      <PageContainer>
        <ContentGrid layout="single" main={<LoadingState kind="rows" label="Loading the liquidity board" rows={3} />} />
      </PageContainer>
    </div>
  )
}
