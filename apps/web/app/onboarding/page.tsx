import { redirect } from "next/navigation"

import { AuthenticatedEntryPage, OnboardingPage, type PendingInvitationOffer } from "@/components/v3"
import { decideExistingActorEntry, safeEntryNext } from "@/lib/entry-routing"
import { refreshState, services } from "@/lib/services"
import { getClerkIdentity, getSessionActor, isDevSessionEnabled } from "@/lib/session"

export const dynamic = "force-dynamic"

/**
 * Pending invitations are looked up only for a VERIFIED identity: the Clerk
 * email in production, or — on the credential-free local bench only — an
 * explicit ?as= address, so the join path stays demonstrable without a
 * provider. There is no anonymous lookup: an open email probe would let
 * anyone enumerate who has been invited where.
 */
async function pendingInvitationsFor(email: string | null): Promise<PendingInvitationOffer[]> {
  if (!email) {
    return []
  }

  await refreshState()

  return services.listPendingInvitationsForEmail(email).map((invitation) => ({
    email: invitation.invitedEmail,
    id: invitation.id,
    organizationName:
      services.state.organizations.find((organization) => organization.id === invitation.organizationId)
        ?.displayName ?? "a LogLoads workspace",
    roleLabel: String(invitation.invitedRole).replaceAll("_", " ")
  }))
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ as?: string; next?: string }>
}) {
  const [actor, params] = await Promise.all([getSessionActor(), searchParams])
  const next = safeEntryNext(params.next)

  if (actor) {
    const decision = decideExistingActorEntry(actor, { next })

    if (decision.kind !== "session") {
      redirect(decision.href)
    }

    return (
      <AuthenticatedEntryPage
        currentHome={decision.currentHome}
        displayName={actor.profile.fullName}
        email={actor.profile.email}
        mode="sign-up"
        restartHref={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}
      />
    )
  }

  const identity = await getClerkIdentity()
  const devPreviewEmail =
    !identity && (await isDevSessionEnabled()) && params.as?.includes("@") ? params.as : null
  const invitations = await pendingInvitationsFor(identity?.email ?? devPreviewEmail)

  return <OnboardingPage identityKnown={identity ?? undefined} invitations={invitations} next={next || undefined} />
}
