import { redirect } from "next/navigation"

import { OnboardingPage, type PendingInvitationOffer } from "@/components/v3"
import { safeInternalPath } from "@/lib/safe-redirect"
import { refreshState, services } from "@/lib/services"
import { getClerkIdentity, getSessionActor, homePathFor, isDevSessionEnabled } from "@/lib/session"

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
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  const params = await searchParams
  const identity = await getClerkIdentity()
  const devPreviewEmail =
    !identity && (await isDevSessionEnabled()) && params.as?.includes("@") ? params.as : null
  const invitations = await pendingInvitationsFor(identity?.email ?? devPreviewEmail)
  const next = safeInternalPath(params.next, "") || undefined

  return <OnboardingPage identityKnown={identity ?? undefined} invitations={invitations} next={next} />
}
