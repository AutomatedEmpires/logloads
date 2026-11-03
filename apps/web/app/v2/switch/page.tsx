import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

import { PageNotice } from "@/components/v2/PageNotice"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { v2MembershipChoices } from "@/lib/marketplace-v2/business-switcher"
import { switchV2BusinessAction } from "@/lib/marketplace-v2/switch-actions"
import { resolveV2Actor } from "@/lib/marketplace-v2/viewer"

import styles from "./page.module.css"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TITLE = "Switch business"
const DESCRIPTION = "Choose the business you are acting for. You only see businesses you are a member of."

/**
 * `/v2/switch` (#124), built from the design system (DS-04, #147): the account's real memberships only, each a row
 * with its kind and role. Choosing one posts to the server, which re-checks the membership before switching.
 */
export default async function SwitchBusinessPage({ searchParams }: { searchParams: SearchParams }) {
  const [resolved, params] = await Promise.all([resolveV2Actor("/v2/switch"), searchParams])

  if (!resolved.ok) {
    return (
      <div data-ds-page="switch-business">
        <PageHeader title={TITLE} />
        <PageContainer>
          <ContentGrid
            layout="single"
            main={
              <>
                <PageNotice>{resolved.refusal}</PageNotice>
                <Button className={styles.back} href="/v2/work" label="Browse public jobs" variant="secondary" />
              </>
            }
          />
        </PageContainer>
      </div>
    )
  }

  const choices = v2MembershipChoices(resolved.actor)

  return (
    <div data-ds-page="switch-business">
      <PageHeader description={DESCRIPTION} title={TITLE} />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <>
              {params.unavailable ? (
                <PageNotice role="alert" tone="critical">That business is not available to your account right now. Choose another one.</PageNotice>
              ) : null}
              {choices.length === 0 ? (
                <Section variant="flush">
                  <EmptyState
                    actions={<Button href="/v2/work" label="Browse public jobs" size="sm" variant="secondary" />}
                    body="Your sign-in is not linked to a LogLoads business yet. Setting up a business is not available in this preview yet."
                    title="No business to act for yet"
                  />
                </Section>
              ) : (
                <Section title="Your businesses" variant="flush">
                  <ul aria-label="Your businesses" className={styles.choices}>
                    {choices.map((choice) => (
                      <li className={styles.choice} key={choice.id}>
                        <div className={styles.choiceText}>
                          <span className={styles.choiceName}>{choice.name}</span>
                          <span className={styles.choiceMeta}>{choice.kind} · {choice.roleLabel}</span>
                        </div>
                        {choice.current ? (
                          <span className={styles.current}>Acting as this business</span>
                        ) : (
                          <form action={switchV2BusinessAction} className={styles.choiceForm}>
                            <input name="organizationId" type="hidden" value={choice.id} />
                            <PendingSubmitButton label={`Act as ${choice.name}`} size="sm" variant="secondary" />
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          }
        />
      </PageContainer>
    </div>
  )
}
