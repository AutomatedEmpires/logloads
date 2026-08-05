import "server-only"

import { supportRequestPagePathSchema } from "@logloads/contracts"
import { redirect } from "next/navigation"

import { getAdminShellAccount } from "./admin-data"
import { services } from "./services"
import {
  canAccessCockpit,
  requireAuthenticatedActor,
  type Cockpit,
  type SessionActor
} from "./session"
import { supportRequestView, type SupportRequestView } from "./support-api"
import { getCockpitContext, shellAccountFor, type ShellAccount } from "./v3"

export interface SupportPageData {
  account: ShellAccount
  fromPath: string | null
  requests: SupportRequestView[]
  role: Cockpit
}

function roleFromPath(path: string): Cockpit | null {
  if (path === "/admin" || path.startsWith("/admin/")) return "admin"
  if (path === "/driver" || path.startsWith("/driver/")) return "driver"
  if (path === "/host" || path.startsWith("/host/")) return "host"
  if (path === "/fleet" || path.startsWith("/fleet/")) return "fleet"

  return null
}

function shellRoleFor(actor: SessionActor, fromPath: string | null): Cockpit | null {
  const requested = fromPath ? roleFromPath(fromPath) : null

  if (requested && canAccessCockpit(actor, requested)) {
    return requested
  }

  for (const role of ["admin", "driver", "host", "fleet"] as const) {
    if (canAccessCockpit(actor, role)) {
      return role
    }
  }

  return null
}

export async function getSupportPageData(rawFromPath: string | null): Promise<SupportPageData> {
  const actor = await requireAuthenticatedActor("/support")
  const parsedPath = rawFromPath ? supportRequestPagePathSchema.safeParse(rawFromPath) : null
  const fromPath = parsedPath?.success ? parsedPath.data : null
  const role = shellRoleFor(actor, fromPath)

  if (!role) {
    // This is an existing identity without a usable cockpit, not a new user.
    // Sending revoked or malformed accounts back through onboarding creates a
    // recovery loop and suggests that a second account can restore access.
    redirect("/access-restricted")
  }

  const account = role === "admin"
    ? await getAdminShellAccount()
    : shellAccountFor(await getCockpitContext(role))
  const requests = services
    .listSupportRequestsForReporter(actor.profile.id)
    .map(supportRequestView)

  return { account, fromPath, requests, role }
}
