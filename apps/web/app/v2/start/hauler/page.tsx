import { notFound, redirect } from "next/navigation"

import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, FormActions, StepIndicator } from "@logloads/ui/primitives"

import { ChoiceCardGroup } from "@/components/v2/onboarding/ChoiceCardGroup"
import styles from "@/components/v2/onboarding/Onboarding.module.css"
import { StartBusinessForm } from "@/components/v2/onboarding/StartBusinessForm"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { HAULER_SETUP_STEPS, HAULER_START_PATH, haulerSetupKind, PROFILE_SETUP_PATH } from "@/lib/marketplace-v2/hauler-profile-form"
import { v2SessionCapabilities } from "@/lib/marketplace-v2/home"
import { hasHaulerSide } from "@/lib/marketplace-v2/navigation"
import { resolveV2Actor } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** UX 02 §A2: three options, one data model (a hauling organization). */
const BUSINESS_TYPES = [
  { description: "I own and run my own truck or trucks.", title: "Just me", value: "solo" },
  { description: "Several trucks, or office staff who help.", title: "A hauling company", value: "company" },
  { description: "Join with an invitation. No truck questions.", title: "I work for a hauling company", value: "member" }
] as const

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function Layout({ children, step, title, description }: { children: React.ReactNode; step: number | null; title: string; description: string }) {
  return (
    <div data-ds-page="start-hauler">
      <PageHeader breadcrumbs={[{ href: "/v2/start", label: "Set up your business" }, { label: title }]} description={description} title={title} />
      <PageContainer width="narrow">
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <div className={styles.stack}>
                {step !== null ? <StepIndicator current={step} steps={[...HAULER_SETUP_STEPS]} /> : null}
                {children}
              </div>
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}

/**
 * `/v2/start/hauler` (UX 02 §A2–A3, #125). The business type is a GET form back to this page, so it works without
 * JavaScript:
 *
 * - "I work for a hauling company" joins by invitation and asks nothing about trucks (Blueprint §93: nobody has to
 *   claim trucks they do not own).
 * - "Just me" and "A hauling company" change only the wording. An account already acting for a hauling business
 *   goes on to that business's profile; any other account gets "Your business", which says plainly that creating a
 *   business is not available in this preview.
 *
 * Every step after this one can be skipped, and Find work never waits for any of them.
 */
export default async function HaulerStartPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const type = one((await searchParams).type)

  if (type === "member") {
    return (
      <Layout description="Your employer adds you to their business on LogLoads. You never need to own a truck." step={null} title="Join a hauling company">
        <ol className={styles.steps}>
          <li>Ask an owner of the hauling company to invite you to their business on LogLoads, using the email you sign in with.</li>
          <li>Accept the invitation when it arrives.</li>
          <li>Choose the business from the business name at the top of the page, and you act for it.</li>
        </ol>
        <p className={styles.note}>Until then you can search for work: it never needs a business.</p>
        <FormActions primary={<Button href="/v2/work" label="Browse public jobs" />} secondary={<Button href="/v2/switch" label="See my businesses" variant="ghost" />} />
      </Layout>
    )
  }

  const kind = haulerSetupKind(type)

  if (!kind) {
    return (
      <Layout description="Free, always. This only changes the wording of the next steps." step={0} title="Your hauling business">
        <form action={HAULER_START_PATH} className={styles.form} method="get">
          <ChoiceCardGroup defaultValue="solo" legend="Who hauls?" name="type" options={BUSINESS_TYPES} />
          <FormActions primary={<Button label="Continue" type="submit" />} secondary={<Button href="/v2/start" label="Back" variant="ghost" />} />
        </form>
      </Layout>
    )
  }

  const resolved = await resolveV2Actor(`${HAULER_START_PATH}?type=${kind}`)

  if (resolved.ok) {
    const capabilities = await v2SessionCapabilities(resolved.actor)

    if (capabilities && hasHaulerSide(capabilities)) {
      redirect(`${PROFILE_SETUP_PATH}&type=${kind}`)
    }
  }

  return (
    <Layout
      description={kind === "solo" ? "The basics landing operators see about you." : "The basics landing operators see about your company."}
      step={1}
      title="Your business"
    >
      <StartBusinessForm solo={kind === "solo"} />
    </Layout>
  )
}
