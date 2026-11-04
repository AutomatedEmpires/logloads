import { redirect } from "next/navigation"

import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, FormActions } from "@logloads/ui/primitives"

import { ChoiceCardGroup } from "@/components/v2/onboarding/ChoiceCardGroup"
import styles from "@/components/v2/onboarding/Onboarding.module.css"
import { HAULER_START_PATH, LANDING_START_PATH } from "@/lib/marketplace-v2/hauler-profile-form"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** UX 02 §A1, in the spec's own words (§2.1). "Free, always" is the locked hauler promise. */
const PATHS = [
  { description: "I am looking for hauling work. Free, always.", title: "I have trucks", value: "hauler" },
  { description: "I post hauling jobs. Landing operators choose a paid plan.", title: "I need log trucks", value: "landing" }
] as const

/**
 * `/v2/start` (UX 02 §A1, #125): the two paths from spec §2.1. A GET form back to this page, so it works without
 * JavaScript; the server sends the choice on to that path's setup. Nothing is created here, and job search never
 * waits for it: "Browse public jobs" is always one tap away.
 */
export default async function StartPage({ searchParams }: { searchParams?: SearchParams }) {
  const path = (await searchParams)?.path

  if (path === "hauler") redirect(HAULER_START_PATH)
  if (path === "landing") redirect(LANDING_START_PATH)

  return (
    <div data-ds-page="start">
      <PageHeader description="Choose the side you are on. One sign-in can belong to a hauling business and a landing business." title="Set up your business" />
      <PageContainer width="narrow">
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <div className={styles.stack}>
                <form action="/v2/start" className={styles.form} method="get">
                  <ChoiceCardGroup defaultValue="hauler" legend="What brings you here?" name="path" options={PATHS} />
                  <FormActions
                    primary={<Button label="Continue" type="submit" />}
                    secondary={<Button href="/v2/work" label="Browse public jobs" variant="ghost" />}
                  />
                </form>
                <p className={styles.note}>
                  Work for a hauling company already on LogLoads? <a href={`${HAULER_START_PATH}?type=member`}>Join it with an invitation</a>.
                </p>
              </div>
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
