import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "For hosts",
  description: "Post the timber that has to move, decide who sees it, and run the live landing board as trucks commit, arrive, load, and roll."
}

export default function Page() {
  return <StoryPage page={storyPages["for-landings"]!} />
}
