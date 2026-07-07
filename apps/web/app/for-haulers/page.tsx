import type { Metadata } from "next"

import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export const metadata: Metadata = {
  title: "For haulers",
  description: "Find timber work that fits the truck you actually run. Route access, trip status, and delivery proof stay on the record."
}

export default function Page() {
  return <StoryPage page={storyPages["for-haulers"]!} />
}
