import { auth, currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { PlatformAdminBootstrap } from "@/components/v3/PlatformAdminBootstrap"
import { PublicShell } from "@/components/v3/Shells"
import { platformAdminBootstrapAllowed } from "@/lib/platform-admin"
import { getSessionActor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = {
  robots: { follow: false, index: false },
  title: "Founder access"
}

export default async function Page() {
  const actor = await getSessionActor()

  if (actor?.isPlatformAdmin) {
    redirect("/admin")
  }

  if (!isClerkConfigured()) {
    redirect("/sign-in?next=%2Fadmin%2Fbootstrap")
  }

  const [session, user] = await Promise.all([auth(), currentUser()])

  if (!session.userId) {
    redirect("/sign-in?next=%2Fadmin%2Fbootstrap")
  }

  const primaryEmail = user?.primaryEmailAddress ?? null
  const primaryEmailVerified = Boolean(
    user &&
      user.id === session.userId &&
      primaryEmail &&
      user.primaryEmailAddressId === primaryEmail.id &&
      primaryEmail.verification?.status === "verified"
  )
  const eligible =
    !actor &&
    platformAdminBootstrapAllowed({
      clerkUserId: session.userId,
      primaryEmailVerified
    })

  return (
    <PublicShell authenticated>
      <main className="auth-page">
        <aside className="auth-story" aria-label="Founder access safeguards">
          <div>
            <p className="eyebrow">Controlled activation</p>
            <h2>One founder. One admin profile. One recorded claim.</h2>
            <ul>
              <li>Exact Clerk identity</li>
              <li>Verified primary email</li>
              <li>Short-lived claim window</li>
            </ul>
          </div>
        </aside>
        <section className="auth-panel">
          <p className="eyebrow">Founder access</p>
          <h1>Claim the platform command center.</h1>
          <p>
            This one-time action binds your current Clerk identity to the
            pre-existing LogLoads administrator. The persistent identity scope
            remains required after the temporary claim window is removed.
          </p>
          <PlatformAdminBootstrap
            eligible={eligible}
            primaryEmail={primaryEmailVerified ? primaryEmail?.emailAddress ?? null : null}
          />
        </section>
      </main>
    </PublicShell>
  )
}
