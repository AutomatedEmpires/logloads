import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "For fleets",
  description: "Put idle log trucks to work without losing dispatch control. Truck-first planning, partner work, and live exceptions on one board."
}

export default function Page() {
  return <StoryPage page={storyPages["for-fleets"]!} />
}
