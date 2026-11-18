import { notFound } from "next/navigation"

import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, ErrorState } from "@logloads/ui/primitives"

import { PageNotice } from "@/components/v2/PageNotice"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { loadLiquidityBoard } from "@/lib/marketplace-v2/liquidity/load"

import { LiquidityBoardTable } from "./board-table"
import styles from "./page.module.css"

const PATH = "/v2/admin/liquidity"

/**
 * `/v2/admin/liquidity` (#326): the per-basin liquidity board, for LogLoads staff deciding when a basin has enough
 * work and enough trucks to open. One row per basin (#324). An operator page built from the design system's layout
 * and state components and the stacked-table pattern of the hauler capacity board.
 *
 * Access is decided on the server by `loadLiquidityBoard`: anyone who is not staff, a landing or hauler account
 * included, gets the V2 not-found page. The page reads nothing from the URL and renders figures only.
 */
export default async function LiquidityBoardPage() {
  if (!marketplaceV2Enabled()) notFound()

  const result = await loadLiquidityBoard()

  if (result.kind === "denied") notFound()

  return (
    <div data-ds-page="admin-liquidity">
      <PageHeader description="Work and trucks in each basin. LogLoads staff only." title="Basin liquidity" />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section title="Basins" variant="open">
              {result.kind === "unavailable" ? (
                <PageNotice role="status">
                  <p>Basins are kept in the normalized marketplace store, which this preview is not using. The board has nothing to show until it is.</p>
                </PageNotice>
              ) : result.kind === "failed" ? (
                <div className={styles.board}>
                  <ErrorState
                    body={`Something went wrong on our side, so no figures are shown.${result.requestId ? ` Reference: ${result.requestId}.` : ""}`}
                    title="The board couldn't load"
                  />
                  <div>
                    <Button href={PATH} label="Try again" variant="secondary" />
                  </div>
                </div>
              ) : (
                <LiquidityBoardTable board={result.board} />
              )}
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
