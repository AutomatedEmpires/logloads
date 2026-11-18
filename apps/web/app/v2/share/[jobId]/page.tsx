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

import {
  SHARE_CLOSED_BODY,
  SHARE_CLOSED_CARD_VERSION,
  SHARE_CLOSED_TITLE,
  shareChannel,
  shareFacts,
  shareInterest,
  type ShareInterest
} from "../facts"
import { shareRateLimit } from "../limit"
import { resolveShare } from "../load"
import styles from "./page.module.css"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export const dynamic = "force-dynamic"

/**
 * The signed-out job page a shared link opens (#287), at `/v2/share/[jobId]`. The first screen is the public facts:
 * freshness, pay, basis, trailer, distance, length and trucks. Send interest goes through sign-up and returns to the
 * job. The preview card is `opengraph-image.tsx`. Coordinates, access notes and contact details are not rendered.
 * A closed basin (#324) shows the area notice and no job facts.
 *
 * Each request is counted per caller before anything is read (#404, `limit.ts`). A caller over the limit gets a
 * short notice and no read. The page is rendered per request and is never stored. The card is `max-age=300`, and
 * its address carries a version, so an edited, removed or closed listing gets a new picture.
 */
const LIMITED_TITLE = "Too many requests"
const LIMITED_BODY = "Wait a minute, then open this link again."

/** The card's address for one state of the listing. A crawler that kept an older card asks for this one instead. */
function cardImage(path: string, version: string, alt: string) {
  return { alt, height: 630, url: `${path}/opengraph-image?v=${version}`, width: 1200 }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const hidden = { robots: { follow: false, index: false } } as const

  if (!marketplaceV2Enabled()) {
    return { ...hidden, title: "Not found" }
  }

  if (!(await shareRateLimit("page")).ok) {
    return { ...hidden, title: LIMITED_TITLE }
  }

  const { jobId } = await params
  const resolved = await resolveShare(jobId)

  if (resolved.kind === "missing") {
    return { ...hidden, title: "Job not found" }
  }

  if (resolved.kind === "closed") {
    const closedCard = cardImage(jobSharePath({ slug: jobId }), SHARE_CLOSED_CARD_VERSION, SHARE_CLOSED_TITLE)

    return {
      ...hidden,
      description: SHARE_CLOSED_BODY,
      openGraph: { description: SHARE_CLOSED_BODY, images: [closedCard], siteName: "LogLoads", title: SHARE_CLOSED_TITLE, type: "website" },
      title: SHARE_CLOSED_TITLE,
      twitter: { card: "summary_large_image", description: SHARE_CLOSED_BODY, images: [closedCard.url], title: SHARE_CLOSED_TITLE }
    }
  }

  const facts = shareFacts(toPublicJobView(resolved.job), new Date().toISOString())
  const path = jobSharePath(resolved.job)
  const image = cardImage(path, facts.cardVersion, facts.cardFreshness)

  return {
    ...hidden,
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
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const query = await searchParams

  if (!(await shareRateLimit("page")).ok) {
    return (
      <div data-ds-page="job-share">
        <PageHeader title={LIMITED_TITLE} />
        <PageContainer>
          <Section variant="flush">
            <div className={styles.actions}>
              <p className={styles.note}>{LIMITED_BODY}</p>
              <Button href={jobSharePath({ slug: jobId })} label="Open the link again" size="lg" variant="secondary" />
            </div>
          </Section>
        </PageContainer>
      </div>
    )
  }

  const resolved = await resolveShare(jobId)

  if (resolved.kind === "missing") notFound()

  const actor = await getV2SessionActor()
  const signedIn = Boolean(actor)
  const beacon = clientAnalyticsEnabled() ? (
    <ShareLinkOpenedBeacon
      channel={shareChannel(query.channel)}
      jobId={resolved.kind === "job" ? resolved.job.id : jobId}
      signedIn={signedIn}
    />
  ) : null

  if (resolved.kind === "closed") {
    return (
      <div data-ds-page="job-share">
        {beacon}
        <PageHeader title={SHARE_CLOSED_TITLE} />
        <PageContainer>
          <Section variant="flush">
            <p className={styles.note}>{SHARE_CLOSED_BODY}</p>
          </Section>
        </PageContainer>
      </div>
    )
  }

  const job = resolved.job
  const facts = shareFacts(toPublicJobView(job), new Date().toISOString())
  const isPoster = Boolean(actor && !actor.workspaceSelectionInvalid && actor.activeOrganization?.id === job.posterOrganizationId)
  const action = shareInterest({
    acceptingInterest: facts.acceptingInterest,
    isPoster,
    signedIn,
    workPath: jobPagePath(job)
  })

  return (
    <div data-ds-page="job-share">
      {beacon}
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
