import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "About",
  description: "LogLoads is built around landings, private roads, timber equipment, and the people who keep log trucks moving."
}

export default function Page() {
  return <StoryPage page={storyPages["about"]!} />
}
