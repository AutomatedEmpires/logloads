import { redirect } from "next/navigation"

import { AccessRestrictedPage } from "@/components/v3"
import { getSessionActor, restrictedAccessRecoveryPath } from "@/lib/session"
import { services } from "@/lib/services"

export const dynamic = "force-dynamic"

export const metadata = {
  robots: { follow: false, index: false },
  title: "Workspace access restricted"
}

export default async function Page() {
  const actor = await getSessionActor()

  if (!actor) {
    redirect("/sign-in")
  }

  const recoveryPath = restrictedAccessRecoveryPath(actor)

  if (recoveryPath) {
    redirect(recoveryPath)
  }

  const inactiveMemberships = services.state.organizationMemberships.filter(
    (membership) => membership.userId === actor.profile.id
  )
  const reason = inactiveMemberships.some(
    (membership) => membership.status === "suspended"
  )
    ? "suspended"
    : inactiveMemberships.some((membership) => membership.status === "removed")
      ? "removed"
      : "unavailable"

  return (
    <AccessRestrictedPage
      displayName={actor.profile.fullName}
      email={actor.profile.email}
      reason={reason}
    />
  )
}
