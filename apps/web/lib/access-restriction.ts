export type AccessRestrictionReason =
  | "organization_rejected"
  | "organization_suspended"
  | "removed"
  | "suspended"
  | "unavailable"

export interface AccessRestrictionMessage {
  body: string
  note: string
  title: string
}

export function accessRestrictionMessage(
  reason: AccessRestrictionReason,
  organizationName?: string | null
): AccessRestrictionMessage {
  const organizationLabel = organizationName ?? "This organization"

  if (reason === "organization_suspended") {
    return {
      body: `${organizationLabel} has been suspended by LogLoads. Its dashboards, private locations, Route Packs, documents, visibility, and new operating actions are locked while the suspension is active. Existing records and obligations remain intact.`,
      note: "Contact LogLoads support for the suspension reason and the steps required for reinstatement.",
      title: `${organizationLabel} is suspended.`
    }
  }

  if (reason === "organization_rejected") {
    return {
      body: `${organizationLabel} was not approved for LogLoads operations. Its dashboards, private locations, Route Packs, documents, visibility, and new operating actions are locked. Existing records remain intact.`,
      note: "Contact LogLoads support to correct the organization details and request a new review.",
      title: `${organizationLabel} is not approved.`
    }
  }

  if (reason === "suspended") {
    return {
      body: "A workspace owner or administrator paused this membership. LogLoads has blocked dashboards, private locations, Route Packs, documents, and new work while the pause is active.",
      note: "A workspace owner or administrator can restore membership. Driver availability stays unavailable until the driver deliberately marks themselves ready again.",
      title: "This workspace membership is suspended."
    }
  }

  if (reason === "removed") {
    return {
      body: "This account no longer has an active workspace seat. LogLoads has blocked dashboards, private locations, Route Packs, documents, and new work. Existing operating records remain intact for authorized workspace staff.",
      note: "A workspace owner or administrator can send a new invitation if access should be restored. Driver availability will remain unavailable until deliberately changed after rejoining.",
      title: "Workspace access has been removed."
    }
  }

  return {
    body: "This account is signed in, but it does not have an active, available LogLoads workspace. Private operating surfaces remain closed.",
    note: "Contact LogLoads support if you expected an active workspace here, or sign out to use another account.",
    title: "No active workspace is available."
  }
}
