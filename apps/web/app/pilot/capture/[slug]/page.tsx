import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PilotCaptureViewer } from "@/components/v3/PilotShowroom"
import {
  getPilotSurface,
  pilotRoles,
  pilotSurfaceSlugs
} from "@/lib/pilot-showroom"

interface PilotCapturePageProps {
  params: Promise<{ slug: string }>
}

export const dynamicParams = false

export function generateStaticParams(): Array<{ slug: string }> {
  return pilotSurfaceSlugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params
}: PilotCapturePageProps): Promise<Metadata> {
  const { slug } = await params
  const selection = getPilotSurface(slug)

  if (!selection) return { title: "Pilot capture not found" }

  const spec = pilotRoles[selection.role]

  return {
    title: `${spec.label} ${selection.surface.title} capture — Pilot Center`,
    description: `${selection.surface.description} Synthetic product capture; not a live workspace.`,
    robots: { follow: true, index: false }
  }
}

export default async function PilotCapturePage({ params }: PilotCapturePageProps) {
  const { slug } = await params
  const selection = getPilotSurface(slug)

  if (!selection) notFound()

  return (
    <PilotCaptureViewer
      role={selection.role}
      surface={selection.surface}
    />
  )
}
