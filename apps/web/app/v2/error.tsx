"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import { ContentGrid, PageActions, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, ErrorState } from "@logloads/ui/primitives"

import { v2ErrorBoundaryMessage } from "@/lib/marketplace-v2/error-codes"

/**
 * A V2 page or action that failed without its own answer (#279; design audit 1, C1). Without this boundary the error
 * fell through to the legacy root error page, outside the V2 shell. It stays inside the shell, says in plain words
 * that the problem is on LogLoads' side, and offers Try again (a fresh server render of the same page) and Find work.
 *
 * In production Next.js replaces a server error with a generic one and a `digest`, the id it logs the error under (and
 * Sentry records, `instrumentation.ts`); the screen shows the digest as the reference. The error's message is never
 * shown: in development it is the raw message.
 */
export default function MarketplaceV2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()

  function retry() {
    // A server component's error clears only on a new server render: refresh, then reset the boundary.
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <div data-ds-page="error">
      <PageHeader
        actions={
          <PageActions>
            <Button href="/v2/work" label="Go to Find work" variant="secondary" />
          </PageActions>
        }
        title="Something went wrong"
      />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <ErrorState body={v2ErrorBoundaryMessage(error.digest)} retry={retry} title="This page couldn't load" />
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
