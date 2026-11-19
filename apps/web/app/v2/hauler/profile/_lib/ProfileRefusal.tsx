import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

/**
 * A profile screen that cannot be shown for this viewer (no business selected, not a hauling business, or the read
 * failed): the reason and two ways on, with no form and no control. Shared by the profile and its directory listing.
 */
export function ProfileRefusal({ body, page, pageTitle, title }: { body: string; page: string; pageTitle: string; title: string }) {
  return (
    <div data-ds-page={page}>
      <PageHeader title={pageTitle} />
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
