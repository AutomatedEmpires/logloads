import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PilotShowroom } from "@/components/v3/PilotShowroom"
import {
  getPilotRole,
  isPilotRole,
  pilotRoleSlugs,
  type PilotRole
} from "@/lib/pilot-showroom"

interface PilotRolePageProps {
  params: Promise<{ role: string }>
}

export const dynamicParams = false

export function generateStaticParams(): Array<{ role: PilotRole }> {
  return pilotRoleSlugs.map((role) => ({ role }))
}

export async function generateMetadata({
  params
}: PilotRolePageProps): Promise<Metadata> {
  const { role } = await params
  const spec = getPilotRole(role)

  if (!spec) {
    return { title: "Pilot role not found" }
  }

  return {
    title: spec.label + " product tour — Pilot Center",
    description: spec.summary
  }
}

export default async function PilotRolePage({ params }: PilotRolePageProps) {
  const { role } = await params

  if (!isPilotRole(role)) {
    notFound()
  }

  return <PilotShowroom role={role} />
}
