import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "How it works",
  description: "One haul on LogLoads: post the work, match the truck, commit on recorded terms, haul with the Route Pack, confirm with proof."
}

export default function Page() {
  return <StoryPage page={storyPages["how-it-works"]!} />
}
