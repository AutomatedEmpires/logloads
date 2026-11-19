import { randomUUID } from "node:crypto"

import type { Metadata } from "next"
import { notFound } from "next/navigation"
// React in scope: the web tests compile JSX with the classic runtime (tsconfig `jsx: preserve`), as app/v2/act/screen.tsx does.
import React from "react"

import { MARKETPLACE_PRIVACY_REQUEST_ADDRESS, MARKETPLACE_PRIVACY_RESPONSE_DAYS } from "@logloads/contracts"
import { PageContainer, PageHeader } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

import styles from "@/components/v2/privacy/PrivacyRequest.module.css"
import { PrivacyRequestForm } from "@/components/v2/privacy/PrivacyRequestForm"
import { PRIVACY_REQUEST_COPY } from "@/components/v2/privacy/privacy-request-view"
import { V2_PRIVACY_REQUEST_PATH } from "@/lib/marketplace-v2/account-menu"
import { resolveV2Shell } from "@/lib/marketplace-v2/business-switcher"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { v2NavigationFor } from "@/lib/marketplace-v2/navigation"
import { privacyRequestStore } from "@/lib/marketplace-v2/privacy"
import { getV2SessionActor } from "@/lib/marketplace-v2/v2-session"

/** Kept out of search engines and link previews, on top of the V2 layout's own noindex. */
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Privacy request"
}

const SIGN_IN_HREF = `/sign-in?next=${encodeURIComponent(V2_PRIVACY_REQUEST_PATH)}`

/** The Settings / Account trail the frames draw. V2 has no Settings or Account screen yet, so the crumbs are words. */
const BREADCRUMBS = PRIVACY_REQUEST_COPY.breadcrumbs.map((label) => ({ label }))

function Header() {
  return <PageHeader breadcrumbs={BREADCRUMBS} description={PRIVACY_REQUEST_COPY.description} title={PRIVACY_REQUEST_COPY.title} />
}

/**
 * `/v2/privacy-request` (#424; legal review §6.6 item 1): the in-app request to see, copy, correct or delete one's
 * personal information, drawn on Figma 04 Settings (#336). It is about the signed-in person, so it needs no business.
 * The frames reach it from the Account screen, which V2 does not have yet; the account menu links it instead.
 *
 * A visitor is asked to sign in, or to email the support address. While no store keeps requests
 * (`privacyRequestStore()` is null until #415), the form says so before anything is typed, and a send answers with the
 * email address; nothing claims a request was received. The URL carries nothing: no query, no id, no address.
 */
export default async function PrivacyRequestPage() {
  if (!marketplaceV2Enabled()) notFound()

  const actor = await getV2SessionActor()

  if (!actor) {
    return (
      <div data-ds-page="privacy-request">
        <Header />
        <div className={styles.body}>
          <PageContainer>
            <div className={styles.column}>
              <EmptyState
                actions={<Button href={SIGN_IN_HREF} label="Sign in" size="lg" />}
                body={`A request in the app comes from your signed-in account, so we know it is yours. You can also email ${MARKETPLACE_PRIVACY_REQUEST_ADDRESS} from the address on your account, and we'll answer within ${MARKETPLACE_PRIVACY_RESPONSE_DAYS} days.`}
                title="Sign in to make a privacy request"
              />
            </div>
          </PageContainer>
        </div>
      </div>
    )
  }

  // The person's own first destination for Cancel and "Back to": Find work for a hauler, Overview for a landing.
  const { capabilities } = await resolveV2Shell()
  const first = v2NavigationFor(capabilities)[0]
  const home = first ? { href: first.href, label: first.label } : { href: "/v2/work", label: "Find work" }

  return (
    <div data-ds-page="privacy-request">
      <Header />
      <div className={styles.body}>
        <PageContainer>
          <div className={styles.column}>
            <PrivacyRequestForm
              accountEmail={actor.profile.email ?? null}
              available={privacyRequestStore() !== null}
              home={home}
              submissionId={randomUUID()}
            />
          </div>
        </PageContainer>
      </div>
    </div>
  )
}
