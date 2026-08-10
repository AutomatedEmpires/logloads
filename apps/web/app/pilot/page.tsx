import type { Metadata } from "next"

import { PilotShowroom } from "@/components/v3/PilotShowroom"

export const metadata: Metadata = {
  title: "Pilot Center — Tour the complete timber hauling workflow",
  description:
    "Tour every LogLoads Host, Fleet, and Driver surface, understand the full operating loop, and see what a credible pilot requires before real work."
}

export default function PilotCenterPage() {
  return <PilotShowroom />
}
