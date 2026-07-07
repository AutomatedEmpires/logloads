import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "Trust",
  description: "How verification works on LogLoads: reviewed evidence, controlled release of access details, and human moderation."
}

export default function Page() {
  return <StoryPage page={storyPages["trust"]!} />
}
