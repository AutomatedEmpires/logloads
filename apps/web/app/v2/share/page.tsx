import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { toPublicJobView } from "@logloads/contracts"
import { PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { SponsoredIndicator } from "@logloads/ui/marketplace"
import { Button } from "@logloads/ui/primitives"

import { AppLink } from "@/components/AppLink"
import { ShareListing } from "@/components/v2/ShareListing"
import { ShareLinkOpenedBeacon } from "@/lib/analytics/beacons"
import { clientAnalyticsEnabled } from "@/lib/analytics/client"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { jobPagePath, jobSharePath, jobShareUrl } from "@/lib/marketplace-v2/job-detail"
import { getV2SessionActor } from "@/lib/marketplace-v2/v2-session"

import { shareChannel, shareFacts, shareInterest, type ShareInterest } from "./facts"
import { loadShareJob } from "./load"
import styles from "./page.module.css"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export const dynamic = "force-dynamic"

/**
 * The signed-out job page a shared link opens (#287). The first screen is the public facts: freshness, pay, basis,
 * trailer, distance, length and trucks. Send interest goes through sign-up and returns to the job. The preview card
 * is `opengraph-image.tsx`. Coordinates, access notes and contact details are not rendered. A closed basin shows no
 * job facts once #324 records that state; a job view here has no basin field to read yet.
 */
async function openJob(jobId: string) {
  if (!marketplaceV2Enabled()) notFound()

  const job = await loadShareJob(jobId)

  if (!job) notFound()

  return job
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!marketplaceV2Enabled()) {
    return { robots: { follow: false, index: false }, title: "Not found" }
  }

  const { jobId } = await params
  const job = await loadShareJob(jobId)

  if (!job) {
    return { robots: { follow: false, index: false }, title: "Job not found" }
  }

  const facts = shareFacts(toPublicJobView(job), new Date().toISOString())
  const path = jobSharePath(job)
  const image = {
    alt: facts.cardFreshness,
    height: 630,
    url: `${path}/opengraph-image`,
    width: 1200
  }

  return {
    alternates: { canonical: path },
    description: facts.description,
    openGraph: {
      description: facts.description,
      images: [image],
      siteName: "LogLoads",
      title: facts.title,
      type: "website",
      url: path
    },
    robots: { follow: false, index: false },
    title: facts.title,
    twitter: {
      card: "summary_large_image",
      description: facts.description,
      images: [image.url],
      title: facts.title
    }
  }
}

function Interest({ action }: { action: ShareInterest }) {
  return (
    <div className={styles.actions}>
      {action.kind === "sign-up" ? null : <p className={styles.note}>{action.note}</p>}
      <Button href={action.href} label={action.label} size="lg" variant={action.kind === "closed" ? "secondary" : "primary"} />
      {action.kind === "sign-up" ? (
        <p className={styles.note}>
          {action.note}{" "}
          <AppLink className={styles.link} href={action.signInHref}>Sign in</AppLink>
        </p>
      ) : null}
    </div>
  )
}

function Fact({ children, label }: { children: string; label: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  )
}

export default async function SharePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { jobId } = await params
  const query = await searchParams
  const job = await openJob(jobId)
  const actor = await getV2SessionActor()
  const facts = shareFacts(toPublicJobView(job), new Date().toISOString())
  const signedIn = Boolean(actor)
  const isPoster = Boolean(actor && !actor.workspaceSelectionInvalid && actor.activeOrganization?.id === job.posterOrganizationId)
  const action = shareInterest({
    acceptingInterest: facts.acceptingInterest,
    isPoster,
    signedIn,
    workPath: jobPagePath(job)
  })

  return (
    <div data-ds-page="job-share">
      {clientAnalyticsEnabled() ? (
        <ShareLinkOpenedBeacon channel={shareChannel(query.channel)} jobId={job.id} signedIn={signedIn} />
      ) : null}
      <PageHeader breadcrumbs={[{ href: "/v2/work", label: "Find work" }, { label: facts.title }]} title={facts.title} />
      <PageContainer>
        <Section variant="flush">
          <div className={styles.lead}>
            {facts.sponsored ? <SponsoredIndicator /> : null}
            <p className={styles.freshness}>{facts.freshness}</p>
            <p className={styles.pay}>
              {facts.payAmount}
              {facts.payBasis ? <span className={styles.basis}> {facts.payBasis}</span> : null}
            </p>
          </div>
          <dl className={styles.facts}>
            <Fact label={facts.equipmentLabel}>{facts.equipment}</Fact>
            <Fact label="Distance">{facts.distanceDetail ?? facts.distance}</Fact>
            {facts.length ? <Fact label="Length">{facts.length}</Fact> : null}
            {facts.trucks ? <Fact label="Trucks">{facts.trucks}</Fact> : null}
            {facts.product ? <Fact label="Product">{facts.product}</Fact> : null}
            <Fact label="Area">{facts.area}</Fact>
            {facts.destination ? <Fact label="To">{facts.destination}</Fact> : null}
          </dl>
          <Interest action={action} />
          <ShareListing url={jobShareUrl(job)} />
        </Section>
      </PageContainer>
    </div>
  )
}
